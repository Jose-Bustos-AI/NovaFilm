import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { refinePrompt, generateChatResponse } from "./services/openai";
import { kieService } from "./services/kie";
import { createJobSchema } from "@shared/schema";
import { z } from "zod";
import { randomUUID } from "crypto";

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
      const { message, messages } = req.body;
      
      if (!message && !messages) {
        return res.status(400).json({ message: "Message or messages array required" });
      }

      let response: string;
      
      if (messages) {
        response = await generateChatResponse(messages);
      } else {
        // Single message - assume it's for prompt refinement
        const refined = await refinePrompt(message);
        response = `I'll create an optimized prompt for you:\n\n**Refined Prompt:** "${refined.prompt}"\n\n**Settings:** ${refined.aspectRatio} aspect ratio, ${refined.model} model`;
      }

      res.json({ response });
    } catch (error) {
      console.error("Chat error:", error);
      res.status(500).json({ message: "Failed to process chat message" });
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
      const validatedData = createJobSchema.parse(req.body);
      
      const taskId = `veo_task_${randomUUID()}`;
      const callBackUrl = `${process.env.APP_BASE_URL || `https://${req.hostname}`}/api/veo-callback`;

      // Create job and video records
      await storage.createJob({
        userId,
        taskId,
        status: 'QUEUED',
      });

      await storage.createVideo({
        userId,
        taskId,
        prompt: validatedData.prompt,
      });

      // Call Kie.ai API
      try {
        const kieResponse = await kieService.generateVideo({
          prompt: validatedData.prompt,
          model: "veo3_fast",
          aspectRatio: validatedData.aspectRatio,
          callBackUrl,
          seeds: validatedData.seeds,
          enableFallback: false,
        });

        await storage.updateJobStatus(taskId, 'PROCESSING');

        res.json({
          run_id: kieResponse.data.runId,
          taskId: kieResponse.data.taskId,
          message: "Video generation started successfully"
        });
      } catch (kieError) {
        console.error("Kie.ai API error:", kieError);
        await storage.updateJobStatus(taskId, 'FAILED', (kieError as Error).message);
        res.status(500).json({ 
          message: "Failed to start video generation",
          error: (kieError as Error).message 
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

  // Callback route for Kie.ai
  app.post('/api/veo-callback', async (req: Request, res: Response) => {
    try {
      const callbackData = kieService.parseCallback(req.body);
      const { taskId, info, fallbackFlag } = callbackData.data;

      // Check if job exists
      const job = await storage.getJob(taskId);
      if (!job) {
        console.warn(`Received callback for unknown task: ${taskId}`);
        return res.status(200).json({ message: "Callback received" });
      }

      if (callbackData.code === 200) {
        // Success - update job and video
        await storage.updateJobStatus(taskId, 'READY');
        await storage.updateVideo(taskId, {
          providerVideoUrl: info.resultUrls[0],
          resolution: info.resolution,
          fallbackFlag,
        });
      } else {
        // Error - update job status
        await storage.updateJobStatus(taskId, 'FAILED', callbackData.msg);
      }

      res.status(200).json({ message: "Callback processed successfully" });
    } catch (error) {
      console.error("Callback processing error:", error);
      res.status(200).json({ message: "Callback received but processing failed" });
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

  const httpServer = createServer(app);
  return httpServer;
}
