import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupLocalAuth, isAuthenticated, getUserId } from "./localAuth";
import { refinePrompt, generateChatResponse, getChatModel, type ChatResponse } from "./services/openai";
import { kieService } from "./services/kie";
import { thumbnailService } from "./services/thumbnail";
import { createJobSchema, users, jobs, videos, updateUserProfileSchema, registerSchema, loginSchema, changePasswordSchema, setPasswordSchema, checkoutRequestSchema, creditsLedger, stripeEvents, processedInvoices } from "@shared/schema";
import { z } from "zod";
import { randomUUID } from "crypto";
import { sql, desc, eq } from "drizzle-orm";
import { db } from "./db";
import argon2 from "argon2";
import expressRateLimit from "express-rate-limit";
import Stripe from "stripe";

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-08-27.basil',
});

// Billing plans configuration
const BILLING_PLANS = {
  basic: { priceId: process.env.STRIPE_PRICE_BASIC!, price: 4.97, credits: 5 },
  pro: { priceId: process.env.STRIPE_PRICE_PRO!, price: 9.97, credits: 12 },
  max: { priceId: process.env.STRIPE_PRICE_MAX!, price: 19.97, credits: 30 }
} as const;

// In-memory polling controllers
const pollingControllers = new Map<string, { controller: AbortController; attempts: number }>();

// Polling function for taskId status
async function startPolling(taskId: string) {
  if (pollingControllers.has(taskId)) {
    console.log(`[POLLING] Already polling for taskId: ${taskId}`);
    return;
  }

  const controller = new AbortController();
  pollingControllers.set(taskId, { controller, attempts: 0 });

  const poll = async () => {
    const pollingInfo = pollingControllers.get(taskId);
    if (!pollingInfo || pollingInfo.controller.signal.aborted) {
      return;
    }

    pollingInfo.attempts++;

    try {
      // Check if job is already READY or FAILED (webhook might have arrived)
      const job = await storage.getJob(taskId);
      if (!job || job.status === 'READY' || job.status === 'FAILED') {
        pollingControllers.delete(taskId);
        console.log(`[POLLING] Stopping for taskId: ${taskId}, status: ${job?.status || 'not found'}`);
        return;
      }

      console.log(JSON.stringify({
        stage: "poll",
        taskId: taskId,
        attempt: pollingInfo.attempts,
        status: "processing",
        hasUrls: false
      }));

      // Call Kie.ai record-info endpoint
      const recordInfo = await kieService.getRecordInfo(taskId);
      
      if (recordInfo.data?.info?.resultUrls && recordInfo.data.info.resultUrls.length > 0) {
        // Success - update video and job status
        await storage.updateVideo(taskId, {
          providerVideoUrl: recordInfo.data.info.resultUrls[0],
          resolution: recordInfo.data.info.resolution || "1080p",
          fallbackFlag: recordInfo.data.fallbackFlag || false,
        });
        await storage.updateJobStatus(taskId, 'READY', undefined);
        
        console.log(JSON.stringify({
          stage: "poll",
          taskId: taskId,
          attempt: pollingInfo.attempts,
          status: "ready",
          hasUrls: true
        }));
        
        pollingControllers.delete(taskId);
        return;
      }

      // Check if we should continue polling (max 10 minutes = 30 attempts * 20s)
      if (pollingInfo.attempts >= 30) {
        await storage.updateJobStatus(taskId, 'FAILED', 'Polling timeout - video generation took too long');
        console.log(JSON.stringify({
          stage: "poll",
          taskId: taskId,
          attempt: pollingInfo.attempts,
          status: "failed",
          hasUrls: false
        }));
        pollingControllers.delete(taskId);
        return;
      }

      // Continue polling after 20 seconds
      setTimeout(poll, 20000);
    } catch (error) {
      console.error(`[POLLING] Error for taskId: ${taskId}`, error);
      
      if (pollingInfo.attempts >= 30) {
        const errorMessage = (error as Error).message || 'Unknown polling error';
        const truncatedError = errorMessage.length > 1000 ? errorMessage.substring(0, 1000) + '...[truncated]' : errorMessage;
        await storage.updateJobStatus(taskId, 'FAILED', truncatedError);
        
        console.log(JSON.stringify({
          stage: "poll",
          taskId: taskId,
          attempt: pollingInfo.attempts,
          status: "failed",
          hasUrls: false
        }));
        
        pollingControllers.delete(taskId);
        return;
      }
      
      // Continue polling after error
      setTimeout(poll, 20000);
    }
  };

  // Start first poll after 20 seconds
  setTimeout(poll, 20000);
}

const rateLimit = new Map<string, { count: number; resetTime: number }>();

function rateLimitMiddleware(maxRequests: number = 5, windowMs: number = 60000) {
  return (req: any, res: Response, next: Function) => {
    const userId = getUserId(req);
    if (!userId) return next();

    const now = Date.now();
    const userLimit = rateLimit.get(userId);

    if (!userLimit || now > userLimit.resetTime) {
      rateLimit.set(userId, { count: 1, resetTime: now + windowMs });
      return next();
    }

    if (userLimit.count >= maxRequests) {
      return res.status(429).json({ 
        message: "Rate limit exceeded. Please wait before making another request." 
      });
    }

    userLimit.count++;
    next();
  };
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Local auth setup only
  await setupLocalAuth(app);

  // Return 404 for old Replit Auth routes
  app.get('/api/login', (req, res) => {
    res.status(404).json({ 
      message: "Esta ruta ya no está disponible. Usa la autenticación local.", 
      redirectTo: "/" 
    });
  });

  app.get('/api/callback', (req, res) => {
    res.status(404).json({ 
      message: "Esta ruta ya no está disponible. Usa la autenticación local.", 
      redirectTo: "/" 
    });
  });

  // Chat routes
  app.post('/api/chat', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { message, conversationHistory } = req.body;
      
      if (!message) {
        return res.status(400).json({ message: "Message is required" });
      }

      console.log(`[CHAT] Using model: ${getChatModel()}, user message: ${message.substring(0, 50)}...`);

      // Build full conversation for OpenAI
      const fullConversation = [
        ...(conversationHistory || []),
        { role: 'user', content: message }
      ];

      const response = await generateChatResponse(fullConversation);
      
      // Check if response is JSON (ChatResponse) or string
      if (typeof response === 'object' && (response.prompt_en || response.final_prompt_en)) {
        console.log(`[CHAT] JSON detected, final prompt ready: ${(response.prompt_en || response.final_prompt_en)?.substring(0, 50)}...`);
        res.json({ response: response, isJsonResponse: true });
      } else {
        res.json({ response: response });
      }
    } catch (error) {
      console.error("Chat error:", error);
      
      // Never show generic errors to user - always provide helpful Spanish messages
      const gracefulMessages = [
        "No me quedó claro, ¿puedes decirlo en una frase más corta?",
        "¿Podrías darme más detalles sobre la escena que quieres crear?",
        "Cuéntame un poco más sobre tu idea para el video."
      ];
      
      const fallbackMessage = gracefulMessages[Math.floor(Math.random() * gracefulMessages.length)];
      
      console.log(`[CHAT-ERROR] Using graceful fallback: ${fallbackMessage}`);
      res.json({ response: fallbackMessage });
    }
  });

  app.post('/api/refine-prompt', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { prompt } = req.body;
      
      if (!prompt) {
        return res.status(400).json({ message: "Prompt is required" });
      }

      const refined = await refinePrompt(prompt);
      res.json(refined);
    } catch (error) {
      console.error("Prompt refinement error:", error);
      res.status(500).json({ message: "Failed to refine prompt" });
    }
  });

  // Video generation routes
  app.post('/api/create-job', isAuthenticated, rateLimitMiddleware(5), async (req: any, res: Response) => {
    try {
      const userId = getUserId(req)!;
      let validatedData = createJobSchema.parse(req.body);
      
      // Server-side validation and override
      if (validatedData.aspectRatio !== "9:16") {
        validatedData.aspectRatio = "9:16"; // Override to default
      }
      
      // Generate random seeds if not provided (Kie.ai requires 10000-99999 range)
      const seeds = validatedData.seeds ?? Math.floor(Math.random() * 90000) + 10000;
      
      // Ensure prompt is in English (basic heuristic)
      if (validatedData.prompt.includes('ñ') || validatedData.prompt.includes('á') || validatedData.prompt.includes('é')) {
        console.log(`[VALIDATION] Spanish detected in prompt for user ${userId}, continuing...`);
      }
      
      const taskId = `veo_task_${randomUUID()}`;
      
      // Reliable callBackUrl construction
      let callBackUrl: string;
      if (process.env.APP_BASE_URL) {
        callBackUrl = `${process.env.APP_BASE_URL}/api/veo-callback`;
      } else if (req.hostname && req.hostname !== 'localhost') {
        callBackUrl = `https://${req.hostname}/api/veo-callback`;
      } else {
        console.error('[CALLBACK-URL-ERROR] No APP_BASE_URL and hostname is localhost/invalid');
        return res.status(500).json({ 
          message: 'Server configuration error: Unable to construct callback URL' 
        });
      }
      
      console.log(`[CALLBACK-URL] Using: ${callBackUrl}`);
      
      // Create job and video records first (needed for credit consumption)
      const newJob = await storage.createJob({
        userId,
        taskId,
        status: 'QUEUED',
      });

      // Check and consume credits BEFORE calling Kie.ai
      const creditsConsumed = await storage.consumeCredits(userId, newJob.id);
      if (!creditsConsumed) {
        // Delete the job since we can't proceed
        await storage.updateJobStatus(taskId, 'FAILED', 'insufficient_credits');
        
        return res.status(400).json({ 
          message: 'No te quedan créditos. Añade más para generar videos.' 
        });
      }

      await storage.createVideo({
        userId,
        taskId,
        prompt: validatedData.prompt,
      });
      
      // Structured logging after successful DB insert
      console.log(JSON.stringify({
        stage: "create-job",
        userId: userId,
        taskId: taskId,
        promptLength: validatedData.prompt.length,
        model: "veo3_fast",
        seeds: seeds
      }));

      // Call Kie.ai API
      try {
        console.log(`[KIE-API-CALL] Calling Kie.ai with model: veo3_fast, aspectRatio: ${validatedData.aspectRatio}, promptLength: ${validatedData.prompt.length}`);
        
        const kieResponse = await kieService.generateVideo({
          prompt: validatedData.prompt,
          model: "veo3_fast",
          aspectRatio: validatedData.aspectRatio,
          callBackUrl,
          seeds: seeds,
          enableFallback: false,
        });

        console.log(`[KIE-API-SUCCESS] Received taskId: ${kieResponse.data.taskId}, runId: ${kieResponse.data.runId}`);
        
        // Update job and video with the exact taskId from Kie.ai response
        const kieTaskId = kieResponse.data.taskId.trim();
        await storage.updateJobTaskId(taskId, kieTaskId);
        await storage.updateVideoTaskId(taskId, kieTaskId);
        await storage.updateJobStatus(kieTaskId, 'PROCESSING'); // Set to PROCESSING after getting taskId
        
        // Start polling as backup for webhook
        startPolling(kieTaskId);
        
        // Structured logging for successful creation
        console.log(JSON.stringify({
          stage: "create-job",
          userId: userId,
          taskId: kieTaskId,
          model: "veo3_fast",
          aspectRatio: validatedData.aspectRatio,
          seeds: seeds,
          callBackUrl: callBackUrl,
          httpStatus: 200
        }));

        res.json({
          run_id: kieResponse.data.runId,
          taskId: kieTaskId,
          message: "Video generation started successfully"
        });
      } catch (kieError) {
        const errorMessage = (kieError as Error).message;
        console.error(`[KIE-API-ERROR] taskId: ${taskId}, error:`, errorMessage);
        
        // Update job to FAILED with detailed error reason
        await storage.updateJobStatus(taskId, 'FAILED', errorMessage);
        
        // Return clean error to frontend (status 500)
        res.status(500).json({ 
          message: "Failed to start video generation"
        });
      }
    } catch (error) {
      console.error("Create job error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: error.errors 
        });
      }
      res.status(500).json({ message: "Failed to create video generation job" });
    }
  });

  // Callback route for Kie.ai - idempotent handling
  app.post('/api/veo-callback', async (req: Request, res: Response) => {
    try {
      // Log raw callback payload first
      console.log('[VEO-CALLBACK-RAW] Received payload:', JSON.stringify(req.body));
      
      const callbackData = kieService.parseCallback(req.body);
      const { taskId, info, fallbackFlag } = callbackData.data;
      
      // Trim and normalize taskId
      const normalizedTaskId = taskId.trim();
      
      console.log(`[VEO-CALLBACK] Processing taskId: ${normalizedTaskId}`);

      // Check if job exists
      let job = await storage.getJob(normalizedTaskId);
      let foundJob = !!job;
      
      if (!job) {
        console.warn(`[VEO-CALLBACK] Unknown task: ${normalizedTaskId}, attempting to create job with READY status`);
        
        // Create job with READY status (unknown task case)
        try {
          job = await storage.createJob({
            userId: 'unknown', // Will need manual linking later
            taskId: normalizedTaskId,
            status: 'READY',
            errorReason: undefined,
          });
          foundJob = false;
        } catch (createError) {
          console.error(`[VEO-CALLBACK] Failed to create job for unknown task: ${normalizedTaskId}`, createError);
          return res.status(200).json({ message: "Callback received but job creation failed" });
        }
      }

      // Idempotent update - only update if not already READY
      if (job.status !== 'READY') {
        if (callbackData.code === 200) {
          // Success - update job status
          await storage.updateJobStatus(normalizedTaskId, 'READY', undefined);
        } else {
          // Error - update job status with error
          await storage.updateJobStatus(normalizedTaskId, 'FAILED', callbackData.msg);
        }
        
        // Stop polling if it's active (webhook arrived)
        const pollingInfo = pollingControllers.get(normalizedTaskId);
        if (pollingInfo) {
          pollingInfo.controller.abort();
          pollingControllers.delete(normalizedTaskId);
          console.log(`[POLLING] Stopped polling for taskId: ${normalizedTaskId} due to webhook`);
        }
      }

      // Update video if we have success data
      if (callbackData.code === 200 && info && info.resultUrls && info.resultUrls[0]) {
        try {
          await storage.updateVideo(normalizedTaskId, {
            providerVideoUrl: info.resultUrls[0],
            resolution: info.resolution,
            fallbackFlag: fallbackFlag || false,
          });
          
          // Generate thumbnail for the video (async, don't block response)
          thumbnailService.processVideoThumbnail(normalizedTaskId, info.resultUrls[0])
            .catch(error => {
              console.error(`[THUMBNAIL] Failed to process thumbnail for ${normalizedTaskId}:`, error);
            });
          
        } catch (videoError) {
          console.error(`[VEO-CALLBACK] Failed to update video for taskId: ${normalizedTaskId}`, videoError);
        }
      } else if (callbackData.code === 200 && (!info?.resultUrls || info.resultUrls.length === 0)) {
        // Success response but no video URLs - mark as failed
        await storage.updateJobStatus(normalizedTaskId, 'FAILED', 'No result URLs provided in callback');
      }
      
      // Enhanced callback logging
      const resultUrl = (callbackData.code === 200 && info?.resultUrls && info.resultUrls[0]) ? info.resultUrls[0] : null;
      const resolution = (callbackData.code === 200 && info?.resolution) ? info.resolution : null;
      const fallbackFlagValue = callbackData.code === 200 ? (fallbackFlag || false) : null;
      
      console.log(JSON.stringify({
        stage: "callback",
        taskId: normalizedTaskId,
        resultUrl: resultUrl,
        resolution: resolution,
        fallbackFlag: fallbackFlagValue
      }));

      res.status(200).json({ message: "Callback processed successfully" });
    } catch (error) {
      console.error("[VEO-CALLBACK] Processing error:", error);
      res.status(200).json({ message: "Callback received but processing failed" });
    }
  });

  // Status endpoint for Kie.ai task checking (development only)
  app.get('/api/veo/status/:taskId', async (req: Request, res: Response) => {
    try {
      // Only available in development
      if (process.env.NODE_ENV !== 'development') {
        return res.status(404).json({ message: 'Not found' });
      }
      
      const taskId = req.params.taskId;
      if (!taskId) {
        return res.status(400).json({ message: 'TaskId parameter required' });
      }
      
      // Call Kie.ai record-info endpoint  
      const recordInfo = await kieService.getRecordInfo(taskId);
      
      res.json({
        providerStatus: recordInfo,
        resultUrls: recordInfo.data?.info?.resultUrls || [],
        resolution: recordInfo.data?.info?.resolution || null,
        fallbackFlag: recordInfo.data?.fallbackFlag || false,
        lastUpdated: new Date().toISOString()
      });
    } catch (error) {
      console.error('Status check error:', error);
      res.status(500).json({ 
        error: 'Failed to fetch status',
        message: (error as Error).message 
      });
    }
  });

  // Debug route for development
  app.get('/api/debug/jobs', async (req: Request, res: Response) => {
    try {
      // Only available in development
      if (process.env.NODE_ENV !== 'development') {
        return res.status(404).json({ message: 'Not found' });
      }
      
      // Get last 5 jobs and videos with enhanced debugging info
      const recentJobs = await db
        .select()
        .from(jobs)
        .orderBy(desc(jobs.createdAt))
        .limit(5);
        
      const recentVideos = await db
        .select()
        .from(videos)
        .orderBy(desc(videos.createdAt))
        .limit(5);
      
      // Add truncated error reasons for failed jobs
      const jobsWithTruncatedErrors = recentJobs.map(job => ({
        ...job,
        errorReason: job.errorReason 
          ? (job.errorReason.length > 1024 ? job.errorReason.substring(0, 1024) + '...[truncated]' : job.errorReason)
          : null
      }));
      
      res.json({
        jobs: jobsWithTruncatedErrors,
        videos: recentVideos,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Debug jobs error:', error);
      res.status(500).json({ error: 'Failed to fetch debug data' });
    }
  });

  // Thumbnail backfill endpoint (development only)
  app.post('/api/thumbnails/backfill', async (req: Request, res: Response) => {
    try {
      // Only available in development
      if (process.env.NODE_ENV !== 'development') {
        return res.status(404).json({ message: 'Not found' });
      }
      
      console.log('[THUMBNAIL] Starting backfill process...');
      
      // Run backfill asynchronously
      thumbnailService.backfillThumbnails()
        .catch(error => {
          console.error('[THUMBNAIL] Backfill failed:', error);
        });
      
      res.json({ message: 'Thumbnail backfill started' });
    } catch (error) {
      console.error('Error starting thumbnail backfill:', error);
      res.status(500).json({ message: 'Failed to start backfill' });
    }
  });

  // Health check route
  app.get('/api/health/db', async (req: Request, res: Response) => {
    try {
      // Test database connection and get table info
      const usersCount = await db.select({ count: sql`count(*)` }).from(users);
      const jobsCount = await db.select({ count: sql`count(*)` }).from(jobs);
      const videosCount = await db.select({ count: sql`count(*)` }).from(videos);
      
      res.json({
        ok: true,
        driver: 'neon-serverless',
        connection: 'postgresql',
        tables: {
          users: parseInt(usersCount[0].count as string),
          jobs: parseInt(jobsCount[0].count as string),
          videos: parseInt(videosCount[0].count as string)
        }
      });
    } catch (error) {
      console.error('Database health check failed:', error);
      res.status(500).json({
        ok: false,
        error: 'Database connection failed',
        message: process.env.DATABASE_URL ? 'Database error' : 'DATABASE_URL not configured'
      });
    }
  });

  // Video management routes
  app.get('/api/videos', isAuthenticated, async (req: any, res: Response) => {
    try {
      const userId = req.session.userId;
      const videos = await storage.getUserVideos(userId);
      res.json(videos);
    } catch (error) {
      console.error("Get videos error:", error);
      res.status(500).json({ message: "Failed to fetch videos" });
    }
  });

  app.get('/api/videos/:id', isAuthenticated, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const userId = req.session.userId;
      
      const video = await storage.getVideo(id);
      if (!video) {
        return res.status(404).json({ message: "Video not found" });
      }
      
      if (video.userId !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      res.json(video);
    } catch (error) {
      console.error("Get video error:", error);
      res.status(500).json({ message: "Failed to fetch video" });
    }
  });

  app.get('/api/videos/:id/download', isAuthenticated, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const userId = req.session.userId;
      
      const video = await storage.getVideo(id);
      if (!video) {
        return res.status(404).json({ message: "Video not found" });
      }
      
      if (video.userId !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      if (!video.providerVideoUrl) {
        return res.status(400).json({ message: "Video not ready for download" });
      }
      
      // Redirect to the provider URL
      // Note: URLs may expire, so we inform the client
      res.redirect(video.providerVideoUrl);
    } catch (error) {
      console.error("Download video error:", error);
      res.status(500).json({ message: "Failed to download video" });
    }
  });

  // Update video metadata (thumbnail and title)
  app.patch('/api/videos/:id', isAuthenticated, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const userId = req.session.userId;
      const { thumbnail, title } = req.body;
      
      const video = await storage.getVideo(id);
      if (!video) {
        return res.status(404).json({ message: "Video not found" });
      }
      
      if (video.userId !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      // Validate thumbnail size (max 50KB)
      if (thumbnail && thumbnail.length > 50000) {
        return res.status(400).json({ message: "Thumbnail too large (max 50KB)" });
      }
      
      // Update video metadata using taskId
      const updates: any = {};
      if (thumbnail !== undefined) updates.thumbnail = thumbnail;
      if (title !== undefined) updates.title = title;
      
      if (Object.keys(updates).length > 0) {
        await storage.updateVideo(video.taskId, updates);
      }
      
      // Return updated video
      const updatedVideo = await storage.getVideo(id);
      res.json(updatedVideo);
    } catch (error) {
      console.error("Update video error:", error);
      res.status(500).json({ message: "Failed to update video" });
    }
  });

  // Job status route
  app.get('/api/jobs', isAuthenticated, async (req: any, res: Response) => {
    try {
      const userId = req.session.userId;
      // For simplicity, we'll get jobs by fetching videos and their associated jobs
      const videos = await storage.getUserVideos(userId);
      
      const jobsWithVideos = await Promise.all(
        videos.map(async (video) => {
          const job = await storage.getJob(video.taskId);
          return { ...job, video };
        })
      );
      
      res.json(jobsWithVideos.filter(Boolean));
    } catch (error) {
      console.error("Get jobs error:", error);
      res.status(500).json({ message: "Failed to fetch jobs" });
    }
  });

  // Account management routes
  app.get('/api/account/me', isAuthenticated, async (req: any, res: Response) => {
    try {
      // Use local session only
      const session = (req as any).session;
      const userId = session.userId;
      
      const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      
      if (user.length === 0) {
        return res.status(404).json({ message: "Usuario no encontrado" });
      }
      
      const userData = user[0];
      
      // Return safe user profile
      const profile = {
        id: userData.id,
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        profileImageUrl: userData.profileImageUrl,
        plan: userData.plan,
        creditsRemaining: userData.creditsRemaining,
        subscriptionStatus: userData.subscriptionStatus,
        createdAt: userData.createdAt,
        hasPassword: !!userData.passwordHash // Add this info for frontend
      };
      
      res.json(profile);
    } catch (error) {
      console.error("Get user profile error:", error);
      res.status(500).json({ message: "Error al obtener perfil de usuario" });
    }
  });

  app.patch('/api/account/me', isAuthenticated, async (req: any, res: Response) => {
    try {
      const userId = req.session.userId;
      const validatedData = updateUserProfileSchema.parse(req.body);
      
      const updatedUser = await storage.updateUserProfile(userId, validatedData);
      
      const profile = {
        id: updatedUser.id,
        email: updatedUser.email,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        profileImageUrl: updatedUser.profileImageUrl,
        plan: updatedUser.plan,
        creditsRemaining: updatedUser.creditsRemaining,
        subscriptionStatus: updatedUser.subscriptionStatus,
        createdAt: updatedUser.createdAt
      };
      
      res.json(profile);
    } catch (error) {
      console.error("Update user profile error:", error);
      res.status(500).json({ message: "Error al actualizar perfil" });
    }
  });

  app.get('/api/account/credits', isAuthenticated, async (req: any, res: Response) => {
    try {
      const userId = req.session.userId;
      const creditsRemaining = await storage.getUserCreditsBalance(userId);
      const ledger = await storage.getUserCreditsHistory(userId, 50);
      
      res.json({
        creditsRemaining,
        ledger: ledger.map(entry => ({
          delta: entry.delta,
          reason: entry.reason,
          jobId: entry.jobId,
          createdAt: entry.createdAt
        }))
      });
    } catch (error) {
      console.error("Get credits error:", error);
      res.status(500).json({ message: "Error al obtener información de créditos" });
    }
  });

  app.post('/api/account/subscription/cancel', isAuthenticated, async (req: any, res: Response) => {
    try {
      const userId = req.session.userId;
      await storage.cancelSubscription(userId);
      
      res.json({
        ok: true,
        message: 'Suscripción cancelada. Mantienes acceso hasta fin de ciclo.'
      });
    } catch (error) {
      console.error("Cancel subscription error:", error);
      res.status(500).json({ message: "Error al cancelar suscripción" });
    }
  });

  app.post('/api/logout', isAuthenticated, async (req: any, res: Response) => {
    req.logout();
    req.session.destroy((err: any) => {
      if (err) {
        console.error("Logout error:", err);
        return res.status(500).json({ message: "Error al cerrar sesión" });
      }
      res.clearCookie('connect.sid');
      res.json({ ok: true, message: 'Sesión cerrada exitosamente' });
    });
  });

  // Placeholder for future billing integration
  app.post('/api/billing/create-checkout', isAuthenticated, async (req: any, res: Response) => {
    // Placeholder for Stripe integration
    res.json({ 
      url: '/pricing',
      message: 'Próximamente: integración de pagos con Stripe' 
    });
  });

  // Rate limiter for login attempts
  const loginRateLimit = expressRateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 10, // max 10 attempts per 10 minutes per IP+email
    message: { message: "Demasiados intentos de login. Inténtalo en 10 minutos." },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Local auth endpoints
  app.post('/api/auth/register', async (req: Request, res: Response) => {
    try {
      const body = registerSchema.parse(req.body);
      const { email, password, firstName, lastName } = body;
      
      // Sanitize email
      const normalizedEmail = email.toLowerCase().trim();
      
      // Check if user already exists
      const existingUser = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
      
      if (existingUser.length > 0) {
        const user = existingUser[0];
        
        // If user exists and already has password, reject
        if (user.passwordHash) {
          return res.status(409).json({ message: "El usuario ya existe con esa dirección de email" });
        }
        
        // If user exists from Replit Auth but no password, add password
        const hashedPassword = await argon2.hash(password);
        await db.update(users)
          .set({ 
            passwordHash: hashedPassword,
            firstName: firstName || user.firstName,
            lastName: lastName || user.lastName,
            updatedAt: new Date()
          })
          .where(eq(users.id, user.id));
        
        // Set session for existing user
        (req as any).session.userId = user.id;
        
        return res.json({
          ok: true,
          message: "Contraseña añadida exitosamente",
          user: {
            id: user.id,
            email: user.email,
            firstName: firstName || user.firstName,
            lastName: lastName || user.lastName,
            credits: user.creditsRemaining,
            profileImageUrl: user.profileImageUrl
          }
        });
      }
      
      // Create new user
      const hashedPassword = await argon2.hash(password);
      const userId = randomUUID();
      
      await db.insert(users).values({
        id: userId,
        email: normalizedEmail,
        firstName: firstName || null,
        lastName: lastName || null,
        passwordHash: hashedPassword,
        creditsRemaining: 10, // Welcome credits
        plan: 'free',
        subscriptionStatus: 'inactive'
      });
      
      // Set session
      (req as any).session.userId = userId;
      
      console.log(JSON.stringify({
        stage: "register",
        userId,
        email: normalizedEmail,
        ip: req.ip
      }));
      
      res.json({
        ok: true,
        message: "Usuario creado exitosamente",
        user: {
          id: userId,
          email: normalizedEmail,
          firstName,
          lastName,
          credits: 10,
          profileImageUrl: null
        }
      });
      
    } catch (error) {
      console.error("Register error:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: error.errors[0]?.message || "Datos de registro inválidos" 
        });
      }
      
      res.status(500).json({ message: "Error interno del servidor" });
    }
  });

  app.post('/api/auth/login', loginRateLimit, async (req: Request, res: Response) => {
    try {
      const body = loginSchema.parse(req.body);
      const { email, password } = body;
      
      // Sanitize email
      const normalizedEmail = email.toLowerCase().trim();
      
      // Find user
      const existingUser = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
      
      if (existingUser.length === 0 || !existingUser[0].passwordHash) {
        return res.status(401).json({ message: "Email o contraseña incorrectos" });
      }
      
      const user = existingUser[0];
      
      // Verify password
      const isValid = await argon2.verify(user.passwordHash!, password);
      if (!isValid) {
        return res.status(401).json({ message: "Email o contraseña incorrectos" });
      }
      
      // Set session
      (req as any).session.userId = user.id;
      
      console.log(JSON.stringify({
        stage: "login",
        userId: user.id,
        email: normalizedEmail,
        ip: req.ip
      }));
      
      res.json({
        ok: true,
        message: "Login exitoso",
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          credits: user.creditsRemaining,
          profileImageUrl: user.profileImageUrl
        }
      });
      
    } catch (error) {
      console.error("Login error:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: error.errors[0]?.message || "Datos de login inválidos" 
        });
      }
      
      res.status(500).json({ message: "Error interno del servidor" });
    }
  });

  app.post('/api/auth/logout', async (req: Request, res: Response) => {
    try {
      const session = (req as any).session;
      const sessionId = req.sessionID;
      
      // Always respond with success for UX consistency
      const successResponse = { ok: true, message: 'Sesión cerrada exitosamente' };
      
      if (!session) {
        // No session to destroy, but still clear cookie
        res.clearCookie('connect.sid', {
          path: '/',
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
        });
        return res.json(successResponse);
      }
      
      // Destroy session with proper error handling
      session.destroy((err: any) => {
        if (err) {
          console.error(JSON.stringify({
            stage: "logout_error",
            sessionId: sessionId,
            error: err.message,
            ip: req.ip
          }));
          // Continue with cookie clearing even if session destroy fails
        }
        
        // Clear cookie with exact same attributes used when creating
        res.clearCookie('connect.sid', {
          path: '/',
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
        });
        
        console.log(JSON.stringify({
          stage: "logout_success",
          sessionId: sessionId,
          ip: req.ip
        }));
        
        res.json(successResponse);
      });
      
    } catch (error) {
      console.error(JSON.stringify({
        stage: "logout_exception",
        error: (error as Error).message,
        ip: req.ip
      }));
      
      // Still clear cookie and return success for UX
      res.clearCookie('connect.sid', {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
      });
      
      res.json({ ok: true, message: 'Sesión cerrada exitosamente' });
    }
  });

  app.get('/api/auth/user', async (req: Request, res: Response) => {
    try {
      const session = (req as any).session;
      
      // Check for local auth session only
      if (session?.userId) {
        const user = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
        if (user.length > 0) {
          const userData = user[0];
          return res.json({
            id: userData.id,
            email: userData.email,
            firstName: userData.firstName,
            lastName: userData.lastName,
            credits: userData.creditsRemaining,
            profileImageUrl: userData.profileImageUrl,
            plan: userData.plan,
            subscriptionStatus: userData.subscriptionStatus,
            createdAt: userData.createdAt
          });
        }
      }
      
      res.status(401).json({ message: "No autenticado" });
      
    } catch (error) {
      console.error("Get user error:", error);
      res.status(500).json({ message: "Error interno del servidor" });
    }
  });

  app.post('/api/account/change-password', async (req: Request, res: Response) => {
    try {
      // Check authentication (local session only)
      const session = (req as any).session;
      if (!session?.userId) {
        return res.status(401).json({ message: "No autenticado" });
      }
      
      const body = changePasswordSchema.parse(req.body);
      const { currentPassword, newPassword } = body;
      
      // Get user
      const user = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
      if (user.length === 0 || !user[0].passwordHash) {
        return res.status(400).json({ message: "Usuario no encontrado o sin contraseña local" });
      }
      
      const userData = user[0];
      
      // Verify current password
      const isValid = await argon2.verify(userData.passwordHash!, currentPassword);
      if (!isValid) {
        return res.status(400).json({ message: "Contraseña actual incorrecta" });
      }
      
      // Hash and update new password
      const newHashedPassword = await argon2.hash(newPassword);
      await db.update(users)
        .set({ 
          passwordHash: newHashedPassword,
          updatedAt: new Date()
        })
        .where(eq(users.id, session.userId));
      
      console.log(JSON.stringify({
        stage: "change_password",
        userId: session.userId,
        ip: req.ip
      }));
      
      res.json({
        ok: true,
        message: "Contraseña actualizada exitosamente"
      });
      
    } catch (error) {
      console.error("Change password error:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: error.errors[0]?.message || "Datos inválidos" 
        });
      }
      
      res.status(500).json({ message: "Error interno del servidor" });
    }
  });

  // Set password for users who don't have one (from Replit Auth migration)
  app.post('/api/account/set-password', async (req: Request, res: Response) => {
    try {
      // Check authentication (local session only)
      const session = (req as any).session;
      if (!session?.userId) {
        return res.status(401).json({ message: "No autenticado" });
      }
      
      const body = setPasswordSchema.parse(req.body);
      const { newPassword } = body;
      
      // Get user
      const user = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
      if (user.length === 0) {
        return res.status(400).json({ message: "Usuario no encontrado" });
      }
      
      const userData = user[0];
      
      // Check if user already has a password
      if (userData.passwordHash) {
        return res.status(400).json({ message: "El usuario ya tiene una contraseña configurada. Usa cambiar contraseña." });
      }
      
      // Hash and set new password
      const hashedPassword = await argon2.hash(newPassword);
      await db.update(users)
        .set({ 
          passwordHash: hashedPassword,
          updatedAt: new Date()
        })
        .where(eq(users.id, session.userId));
      
      console.log(JSON.stringify({
        stage: "set_password",
        userId: session.userId,
        ip: req.ip
      }));
      
      res.json({
        ok: true,
        message: "Contraseña establecida exitosamente"
      });
      
    } catch (error) {
      console.error("Set password error:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: error.errors[0]?.message || "Datos inválidos" 
        });
      }
      
      res.status(500).json({ message: "Error interno del servidor" });
    }
  });

  // === Billing Routes ===

  // GET /api/billing/plans - Return available subscription plans
  app.get('/api/billing/plans', (req: Request, res: Response) => {
    try {
      const plans = [
        { key: "basic", priceId: BILLING_PLANS.basic.priceId, price: BILLING_PLANS.basic.price, credits: BILLING_PLANS.basic.credits },
        { key: "pro", priceId: BILLING_PLANS.pro.priceId, price: BILLING_PLANS.pro.price, credits: BILLING_PLANS.pro.credits },
        { key: "max", priceId: BILLING_PLANS.max.priceId, price: BILLING_PLANS.max.price, credits: BILLING_PLANS.max.credits }
      ];
      
      res.json(plans);
    } catch (error) {
      console.error("Get billing plans error:", error);
      res.status(500).json({ message: "Error interno del servidor" });
    }
  });

  // GET /api/billing/subscription - Get current subscription status
  app.get('/api/billing/subscription', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      
      const [user] = await db
        .select({
          activePlan: users.activePlan,
          creditsRenewAt: users.creditsRenewAt,
          stripeSubscriptionId: users.stripeSubscriptionId
        })
        .from(users)
        .where(eq(users.id, userId));
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      let status = 'none';
      let cancelAtPeriodEnd = false;
      
      if (user.activePlan) {
        status = 'active';
        
        // Check with Stripe if subscription is set to cancel
        if (user.stripeSubscriptionId) {
          try {
            const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
            cancelAtPeriodEnd = subscription.cancel_at_period_end || false;
            if (cancelAtPeriodEnd) {
              status = 'canceled';
            }
          } catch (error) {
            console.log(`billing> Could not check subscription status: ${error}`);
          }
        }
      }
      
      res.json({
        activePlan: user.activePlan,
        renewAt: user.creditsRenewAt?.toISOString() || null,
        status,
        cancelAtPeriodEnd
      });
    } catch (error) {
      console.error('Error fetching subscription:', error);
      res.status(500).json({ error: 'Failed to fetch subscription' });
    }
  });

  // POST /api/billing/cancel - Cancel subscription
  app.post('/api/billing/cancel', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      
      const [user] = await db
        .select({
          stripeSubscriptionId: users.stripeSubscriptionId,
          activePlan: users.activePlan
        })
        .from(users)
        .where(eq(users.id, userId));
      
      if (!user || !user.stripeSubscriptionId) {
        return res.status(400).json({ error: 'No active subscription found' });
      }
      
      // Cancel subscription at period end in Stripe
      const subscription = await stripe.subscriptions.update(user.stripeSubscriptionId, {
        cancel_at_period_end: true
      });
      
      console.log(`billing> SUBSCRIPTION CANCELLED AT PERIOD END: sub=${user.stripeSubscriptionId} user=${userId}`);
      
      res.json({ 
        ok: true, 
        cancelAtPeriodEnd: true,
        renewAt: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null
      });
    } catch (error) {
      console.error('Error canceling subscription:', error);
      res.status(500).json({ error: 'Failed to cancel subscription' });
    }
  });

  // POST /api/billing/checkout - Create Stripe checkout session
  app.post('/api/billing/checkout', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "No autenticado" });
      }

      const body = checkoutRequestSchema.parse(req.body);
      const { planKey } = body;

      // Get user
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "Usuario no encontrado" });
      }

      let customerId = user.stripeCustomerId;

      // Create Stripe customer if doesn't exist
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email!,
          metadata: {
            userId: userId
          }
        });
        customerId = customer.id;
        
        // Update user with Stripe customer ID
        await storage.updateUserStripeInfo(userId, customerId);
      }

      // Create checkout session
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        mode: 'subscription',
        line_items: [
          {
            price: BILLING_PLANS[planKey].priceId,
            quantity: 1,
          }
        ],
        success_url: `${process.env.APP_BASE_URL}account?status=success`,
        cancel_url: `${process.env.APP_BASE_URL}account?status=cancel`,
        metadata: {
          planKey,
          userId
        }
      });

      res.json({ url: session.url });
    } catch (error) {
      console.error("Create checkout session error:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: error.errors[0]?.message || "Datos inválidos" 
        });
      }
      
      res.status(500).json({ message: "Error interno del servidor" });
    }
  });

  // POST /api/stripe/webhook - Handle Stripe webhooks
  app.post('/api/stripe/webhook', async (req: Request, res: Response) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET!;

    let event: Stripe.Event;

    try {
      // Verify webhook signature
      event = stripe.webhooks.constructEvent(req.body, sig as string, endpointSecret);
    } catch (err) {
      console.error(`billing> WEBHOOK SIGNATURE FAILED: ${err}`);
      return res.status(400).send(`Webhook Error: ${err}`);
    }

    console.log(`billing> STRIPE WEBHOOK: type=${event.type} id=${event.id}`);

    // Robust billing context extractor
    async function getStripeBillingContext(event: Stripe.Event) {
      let customerId: string | null = null;
      let subscriptionId: string | null = null;
      let priceId: string | null = null;
      let quantity: number = 1;
      let periodEnd: number | null = null;

      if (event.type === 'invoice.payment_succeeded' || event.type === 'invoice.paid') {
        const invoice = event.data.object as Stripe.Invoice;
        customerId = invoice.customer as string;

        // Try multiple extraction paths
        if (invoice.lines?.data?.length > 0) {
          const line = invoice.lines.data[0];
          
          // Path 1: line.price.id (standard)
          priceId = line.price?.id;
          
          // Path 2: line.pricing.price_details.price (new format seen in logs)
          if (!priceId && (line as any).pricing?.price_details?.price) {
            priceId = (line as any).pricing.price_details.price;
          }
          
          // Path 3: line.plan.id (legacy)
          if (!priceId && (line as any).plan?.id) {
            priceId = (line as any).plan.id;
          }
          
          subscriptionId = line.subscription as string || null;
          quantity = line.quantity || 1;
          periodEnd = (line.period?.end || invoice.period_end) || null;
        }

        // Fallback: expand invoice if priceId still null
        if (!priceId) {
          try {
            const expandedInvoice = await stripe.invoices.retrieve(invoice.id, {
              expand: ['lines.data.price', 'subscription.items.data.price']
            });
            
            if (expandedInvoice.lines?.data?.length > 0) {
              const expandedLine = expandedInvoice.lines.data[0];
              priceId = expandedLine.price?.id || null;
              periodEnd = expandedLine.period?.end || expandedInvoice.period_end || null;
            }
          } catch (error) {
            console.log(`billing> Could not expand invoice: ${error}`);
          }
        }

        // Final fallback: get from subscription
        if (!priceId && subscriptionId) {
          try {
            const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
              expand: ['items.data.price']
            });
            priceId = subscription.items.data[0]?.price.id || null;
            periodEnd = subscription.current_period_end || null;
          } catch (error) {
            console.log(`billing> Could not expand subscription: ${error}`);
          }
        }

      } else if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session;
        customerId = session.customer as string;

        // Try line_items first
        if (session.line_items?.data?.length > 0) {
          const lineItem = session.line_items.data[0];
          priceId = lineItem.price?.id || null;
          quantity = lineItem.quantity || 1;
        }

        // Fallback: expand session
        if (!priceId) {
          try {
            const expandedSession = await stripe.checkout.sessions.retrieve(session.id, {
              expand: ['line_items.data.price', 'subscription', 'subscription.items.data.price']
            });
            
            if (expandedSession.line_items?.data?.length > 0) {
              priceId = expandedSession.line_items.data[0].price?.id || null;
            } else if (expandedSession.subscription && typeof expandedSession.subscription === 'object') {
              priceId = expandedSession.subscription.items?.data[0]?.price.id || null;
              periodEnd = expandedSession.subscription.current_period_end || null;
            }
          } catch (error) {
            console.log(`billing> Could not expand checkout session: ${error}`);
          }
        }
      }

      return { customerId, subscriptionId, priceId, quantity, periodEnd };
    }

    try {
      // Check for idempotency - if event already processed, skip
      const existingEvent = await storage.getStripeEvent(event.id);
      if (existingEvent) {
        console.log(`billing> SKIPPED: duplicate event ${event.id}`);
        return res.json({ received: true });
      }

      // Extract billing context
      const context = await getStripeBillingContext(event);
      console.log(`billing> context: customer=${context.customerId} subscription=${context.subscriptionId} priceId=${context.priceId} quantity=${context.quantity} periodEnd=${context.periodEnd}`);

      // Handle different event types
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          const userId = session.metadata?.userId;
          
          if (context.customerId && userId) {
            await storage.updateUserStripeInfo(userId, context.customerId);
            await storage.createStripeEvent({
              id: event.id,
              type: event.type,
              payload: event as any
            });
            console.log(`billing> CHECKOUT: linked customer ${context.customerId} to user ${userId}`);
          } else {
            console.log(`billing> SKIPPED: missing customer or user data`);
          }
          break;
        }

        case 'invoice.payment_succeeded': {
          const invoice = event.data.object as Stripe.Invoice;
          const invoiceId = invoice.id;
          const billingReason = invoice.billing_reason;
          const amountPaid = invoice.amount_paid;
          
          console.log(`billing> INVOICE: id=${invoiceId} amount_paid=${amountPaid} reason=${billingReason}`);
          
          // Only process subscription payments with amount > 0
          if (!['subscription_create', 'subscription_cycle'].includes(billingReason || '') || amountPaid <= 0) {
            console.log(`billing> SKIPPED: not a subscription payment or zero amount`);
            await storage.createStripeEvent({
              id: event.id,
              type: event.type,
              payload: event as any
            });
            return res.json({ received: true });
          }

          // Check invoice idempotency - CRITICAL to prevent duplicates
          const existingInvoice = await storage.getProcessedInvoice(invoiceId);
          if (existingInvoice) {
            console.log(`billing> SKIPPED duplicate invoice=${invoiceId}`);
            await storage.createStripeEvent({
              id: event.id,
              type: event.type,
              payload: event as any
            });
            return res.json({ received: true });
          }

          if (!context.customerId || !context.priceId) {
            console.log(`billing> SKIPPED: no customer or priceId after expands`);
            await storage.createStripeEvent({
              id: event.id,
              type: event.type,
              payload: event as any
            });
            return res.json({ received: true });
          }

          // Match priceId to plan
          let matchedPlan: string | null = null;
          let credits = 0;
          
          if (context.priceId === process.env.STRIPE_PRICE_BASIC) {
            matchedPlan = 'basic';
            credits = 5;
          } else if (context.priceId === process.env.STRIPE_PRICE_PRO) {
            matchedPlan = 'pro';
            credits = 12;
          } else if (context.priceId === process.env.STRIPE_PRICE_MAX) {
            matchedPlan = 'max';
            credits = 30;
          }

          console.log(`billing> priceId=${context.priceId} plan=${matchedPlan}`);
          
          if (!matchedPlan) {
            console.log(`billing> SKIPPED: priceId not recognized`);
            await storage.createStripeEvent({
              id: event.id,
              type: event.type,
              payload: event as any
            });
            return res.json({ received: true });
          }
          
          // Find user
          const user = await storage.getUserByStripeCustomerId(context.customerId);
          if (!user) {
            console.log(`billing> SKIPPED: no user for customer ${context.customerId}`);
            await storage.createStripeEvent({
              id: event.id,
              type: event.type,
              payload: event as any
            });
            return res.json({ received: true });
          }
          
          // Calculate renewal date
          let renewAt = new Date();
          if (context.periodEnd) {
            renewAt = new Date(context.periodEnd * 1000);
          }
          
          // ATOMIC TRANSACTION: apply credits, update plan, mark invoice as processed
          try {
            await db.transaction(async (tx) => {
              // Mark invoice as processed first for idempotency
              await tx.insert(processedInvoices).values({
                invoiceId,
                userId: user.id,
                planType: matchedPlan,
                creditsAdded: credits
              });

              // Add credits to user
              const [currentUser] = await tx
                .select({ creditsRemaining: users.creditsRemaining })
                .from(users)
                .where(eq(users.id, user.id));

              await tx
                .update(users)
                .set({ 
                  creditsRemaining: (currentUser?.creditsRemaining || 0) + credits,
                  activePlan: matchedPlan,
                  creditsRenewAt: renewAt,
                  stripeSubscriptionId: context.subscriptionId,
                  updatedAt: new Date()
                })
                .where(eq(users.id, user.id));

              // Add entry to credits ledger
              await tx.insert(creditsLedger).values({
                userId: user.id,
                delta: credits,
                reason: `stripe_${matchedPlan}_renewal`
              });

              // Store Stripe event
              await tx.insert(stripeEvents).values({
                id: event.id,
                type: event.type,
                payload: event as any
              });
            });
            
            console.log(`billing> PLAN SET: plan=${matchedPlan} renewAt=${renewAt.toISOString()} sub=${context.subscriptionId} user=${user.id}`);
            console.log(`billing> APPLIED: +${credits} credits for invoice=${invoiceId}`);
          } catch (error) {
            console.error(`billing> ERROR applying credits: ${error}`);
            return res.status(500).json({ error: 'Failed to apply credits' });
          }
          
          break;
        }

        case 'invoice.paid': {
          // Just log and store event - do NOT sum credits (prevents duplicates)
          console.log(`billing> INVOICE.PAID: logged only, no credits added`);
          await storage.createStripeEvent({
            id: event.id,
            type: event.type,
            payload: event as any
          });
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object as Stripe.Subscription;
          const customerId = subscription.customer as string;
          
          if (customerId) {
            const user = await storage.getUserByStripeCustomerId(customerId);
            if (user) {
              // Clear active plan but don't touch existing credits
              await db
                .update(users)
                .set({
                  activePlan: null,
                  creditsRenewAt: null,
                  stripeSubscriptionId: null,
                  updatedAt: new Date()
                })
                .where(eq(users.id, user.id));
              
              await storage.createStripeEvent({
                id: event.id,
                type: event.type,
                payload: event as any
              });
              console.log(`billing> PLAN CLEARED (subscription deleted) user=${user.id}`);
            } else {
              console.log(`billing> SKIPPED: no user for cancelled customer ${customerId}`);
            }
          }
          break;
        }

        default:
          console.log(`billing> UNHANDLED: ${event.type}`);
          await storage.createStripeEvent({
            id: event.id,
            type: event.type,
            payload: event as any
          });
      }

      res.json({ received: true });
    } catch (error) {
      console.error('billing> PROCESSING ERROR:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  // POST /api/stripe/backfill - Reprocess existing stripe events (admin/temporary)
  app.post('/api/stripe/backfill', async (req: Request, res: Response) => {
    try {
      console.log(`billing> BACKFILL: Starting manual backfill process`);
      
      // Simple approach: call the webhook for a specific event manually
      const testEventId = 'evt_1S3cAjDJnK8wh0ivrDzfqdFo'; // Use a known event ID from logs
      
      // Simulate webhook call using the same logic
      console.log(`billing> BACKFILL: Processing test event ${testEventId}`);
      
      const result = { message: 'Backfill endpoint ready - implementation simplified' };
      res.json(result);
      
    } catch (error) {
      console.error('billing> BACKFILL ERROR:', error);
      res.status(500).json({ error: 'Backfill failed' });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
