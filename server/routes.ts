import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { refinePrompt, generateChatResponse, getChatModel, type ChatResponse } from "./services/openai";
import { kieService } from "./services/kie";
import { thumbnailService } from "./services/thumbnail";
import { createJobSchema, users, jobs, videos, updateUserProfileSchema } from "@shared/schema";
import { z } from "zod";
import { randomUUID } from "crypto";
import { sql, desc } from "drizzle-orm";
import { db } from "./db";

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
    const userId = req.user?.claims?.sub;
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
  // Auth middleware
  await setupAuth(app);

  // Auth routes
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
      
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
      const userId = req.user.claims.sub;
      
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "Usuario no encontrado" });
      }
      
      // Return safe user profile
      const profile = {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
        plan: user.plan,
        creditsRemaining: user.creditsRemaining,
        subscriptionStatus: user.subscriptionStatus,
        createdAt: user.createdAt
      };
      
      res.json(profile);
    } catch (error) {
      console.error("Get user profile error:", error);
      res.status(500).json({ message: "Error al obtener perfil de usuario" });
    }
  });

  app.patch('/api/account/me', isAuthenticated, async (req: any, res: Response) => {
    try {
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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

  const httpServer = createServer(app);
  return httpServer;
}
