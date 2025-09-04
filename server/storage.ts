import {
  users,
  jobs,
  videos,
  creditsLedger,
  stripeEvents,
  type User,
  type UpsertUser,
  type Job,
  type InsertJob,
  type Video,
  type InsertVideo,
  type InsertCreditsLedger,
  type CreditsLedger,
  type UpdateUserProfile,
  type InsertStripeEvent,
  type StripeEvent,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, isNull } from "drizzle-orm";

export interface IStorage {
  // User operations (mandatory for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // Job operations
  createJob(job: InsertJob): Promise<Job>;
  getJob(taskId: string): Promise<Job | undefined>;
  updateJobStatus(taskId: string, status: 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED', errorReason?: string): Promise<void>;
  updateJobTaskId(oldTaskId: string, newTaskId: string): Promise<void>;
  getUserJobs(userId: string): Promise<Job[]>;
  
  // Video operations
  createVideo(video: InsertVideo): Promise<Video>;
  updateVideo(taskId: string, updates: Partial<InsertVideo>): Promise<void>;
  updateVideoTaskId(oldTaskId: string, newTaskId: string): Promise<void>;
  updateVideoThumbnail(taskId: string, thumbnail: string): Promise<void>;
  getUserVideos(userId: string): Promise<Video[]>;
  getVideo(id: string): Promise<Video | undefined>;
  getVideoByTaskId(taskId: string): Promise<Video | undefined>;
  getVideosWithoutThumbnails(): Promise<Video[]>;
  
  // Credit operations
  addWelcomeCredits(userId: string, credits: number): Promise<void>;
  consumeCredits(userId: string, jobId: string): Promise<boolean>; // Returns true if successful
  refundCredits(userId: string, jobId: string): Promise<void>;
  getUserCreditsBalance(userId: string): Promise<number>;
  getUserCreditsHistory(userId: string, limit?: number): Promise<CreditsLedger[]>;
  updateUserProfile(userId: string, updates: UpdateUserProfile): Promise<User>;
  cancelSubscription(userId: string): Promise<void>;
  
  // Stripe operations
  updateUserStripeInfo(userId: string, stripeCustomerId: string, activePlan?: string, creditsRenewAt?: Date): Promise<User>;
  getUserByStripeCustomerId(stripeCustomerId: string): Promise<User | undefined>;
  addSubscriptionCredits(userId: string, credits: number, planKey: string): Promise<void>;
  createStripeEvent(event: InsertStripeEvent): Promise<StripeEvent>;
  getStripeEvent(eventId: string): Promise<StripeEvent | undefined>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // Job operations
  async createJob(job: InsertJob): Promise<Job> {
    const [newJob] = await db.insert(jobs).values(job).returning();
    return newJob;
  }

  async getJob(taskId: string): Promise<Job | undefined> {
    const [job] = await db.select().from(jobs).where(eq(jobs.taskId, taskId));
    return job;
  }

  async updateJobStatus(taskId: string, status: 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED', errorReason?: string): Promise<void> {
    await db
      .update(jobs)
      .set({ status, errorReason })
      .where(eq(jobs.taskId, taskId));
  }

  async updateJobTaskId(oldTaskId: string, newTaskId: string): Promise<void> {
    await db
      .update(jobs)
      .set({ taskId: newTaskId })
      .where(eq(jobs.taskId, oldTaskId));
  }

  async getUserJobs(userId: string): Promise<Job[]> {
    return await db
      .select()
      .from(jobs)
      .where(eq(jobs.userId, userId))
      .orderBy(desc(jobs.createdAt));
  }

  // Video operations
  async createVideo(video: InsertVideo): Promise<Video> {
    const [newVideo] = await db.insert(videos).values(video).returning();
    return newVideo;
  }

  async updateVideo(taskId: string, updates: Partial<InsertVideo>): Promise<void> {
    await db
      .update(videos)
      .set(updates)
      .where(eq(videos.taskId, taskId));
  }

  async updateVideoTaskId(oldTaskId: string, newTaskId: string): Promise<void> {
    await db
      .update(videos)
      .set({ taskId: newTaskId })
      .where(eq(videos.taskId, oldTaskId));
  }

  async getUserVideos(userId: string): Promise<Video[]> {
    return await db
      .select()
      .from(videos)
      .where(eq(videos.userId, userId))
      .orderBy(desc(videos.createdAt));
  }

  async getVideo(id: string): Promise<Video | undefined> {
    const [video] = await db.select().from(videos).where(eq(videos.id, id));
    return video;
  }

  async getVideoByTaskId(taskId: string): Promise<Video | undefined> {
    const [video] = await db.select().from(videos).where(eq(videos.taskId, taskId));
    return video;
  }

  async updateVideoThumbnail(taskId: string, thumbnail: string): Promise<void> {
    await db
      .update(videos)
      .set({ thumbnail })
      .where(eq(videos.taskId, taskId));
  }

  async getVideosWithoutThumbnails(): Promise<Video[]> {
    return await db
      .select()
      .from(videos)
      .where(and(
        isNull(videos.thumbnail)
      ))
      .orderBy(desc(videos.createdAt));
  }

  // Credit operations
  async addWelcomeCredits(userId: string, credits: number): Promise<void> {
    await db.transaction(async (tx) => {
      // Update user credits
      await tx
        .update(users)
        .set({ 
          creditsRemaining: credits,
          updatedAt: new Date()
        })
        .where(eq(users.id, userId));

      // Add entry to ledger
      await tx.insert(creditsLedger).values({
        userId,
        delta: credits,
        reason: 'promo'
      });
    });
  }

  async consumeCredits(userId: string, jobId: string): Promise<boolean> {
    return await db.transaction(async (tx) => {
      // Lock user record and get current credits
      const [user] = await tx
        .select({ creditsRemaining: users.creditsRemaining })
        .from(users)
        .where(eq(users.id, userId))
        .for('update');

      if (!user || user.creditsRemaining < 1) {
        return false; // Not enough credits
      }

      // Decrease credits
      await tx
        .update(users)
        .set({ 
          creditsRemaining: user.creditsRemaining - 1,
          updatedAt: new Date()
        })
        .where(eq(users.id, userId));

      // Add consumption entry to ledger
      await tx.insert(creditsLedger).values({
        userId,
        delta: -1,
        reason: 'video_generation',
        jobId
      });

      return true;
    });
  }

  async refundCredits(userId: string, jobId: string): Promise<void> {
    await db.transaction(async (tx) => {
      // Get current credits
      const [user] = await tx
        .select({ creditsRemaining: users.creditsRemaining })
        .from(users)
        .where(eq(users.id, userId));

      if (!user) return;

      // Refund 1 credit
      await tx
        .update(users)
        .set({ 
          creditsRemaining: user.creditsRemaining + 1,
          updatedAt: new Date()
        })
        .where(eq(users.id, userId));

      // Add refund entry to ledger
      await tx.insert(creditsLedger).values({
        userId,
        delta: 1,
        reason: 'refund',
        jobId
      });
    });
  }

  async getUserCreditsBalance(userId: string): Promise<number> {
    const [user] = await db
      .select({ creditsRemaining: users.creditsRemaining })
      .from(users)
      .where(eq(users.id, userId));
    
    return user?.creditsRemaining ?? 0;
  }

  async getUserCreditsHistory(userId: string, limit = 50): Promise<CreditsLedger[]> {
    return await db
      .select()
      .from(creditsLedger)
      .where(eq(creditsLedger.userId, userId))
      .orderBy(desc(creditsLedger.createdAt))
      .limit(limit);
  }

  async updateUserProfile(userId: string, updates: UpdateUserProfile): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ 
        ...updates,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId))
      .returning();
    
    return user;
  }

  async cancelSubscription(userId: string): Promise<void> {
    await db
      .update(users)
      .set({ 
        subscriptionStatus: 'canceled',
        canceledAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));
  }

  // Stripe operations
  async updateUserStripeInfo(userId: string, stripeCustomerId: string, activePlan?: string, creditsRenewAt?: Date): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ 
        stripeCustomerId,
        activePlan,
        creditsRenewAt,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId))
      .returning();
    
    return user;
  }

  async getUserByStripeCustomerId(stripeCustomerId: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.stripeCustomerId, stripeCustomerId));
    return user;
  }

  async addSubscriptionCredits(userId: string, credits: number, planKey: string): Promise<void> {
    await db.transaction(async (tx) => {
      // Get current credits
      const [user] = await tx
        .select({ creditsRemaining: users.creditsRemaining })
        .from(users)
        .where(eq(users.id, userId));

      if (!user) return;

      // Add credits to user
      await tx
        .update(users)
        .set({ 
          creditsRemaining: user.creditsRemaining + credits,
          updatedAt: new Date()
        })
        .where(eq(users.id, userId));

      // Add entry to ledger
      await tx.insert(creditsLedger).values({
        userId,
        delta: credits,
        reason: 'subscription_payment'
      });
    });
  }

  async createStripeEvent(event: InsertStripeEvent): Promise<StripeEvent> {
    const [stripeEvent] = await db.insert(stripeEvents).values(event).returning();
    return stripeEvent;
  }

  async getStripeEvent(eventId: string): Promise<StripeEvent | undefined> {
    const [event] = await db.select().from(stripeEvents).where(eq(stripeEvents.id, eventId));
    return event;
  }
}

export const storage = new DatabaseStorage();
