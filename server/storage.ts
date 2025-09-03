import {
  users,
  jobs,
  videos,
  type User,
  type UpsertUser,
  type Job,
  type InsertJob,
  type Video,
  type InsertVideo,
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
}

export const storage = new DatabaseStorage();
