import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
  uuid,
  pgEnum,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table for Replit Auth
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const jobStatusEnum = pgEnum('job_status', ['QUEUED', 'PROCESSING', 'READY', 'FAILED']);

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  taskId: text("task_id").unique().notNull(),
  status: jobStatusEnum("status").notNull().default('QUEUED'),
  errorReason: text("error_reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const videos = pgTable("videos", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  taskId: text("task_id").unique().notNull(),
  prompt: text("prompt").notNull(),
  title: text("title"),
  thumbnail: text("thumbnail"),
  thumbnailUrl: text("thumbnail_url"),
  providerVideoUrl: text("provider_video_url"),
  resolution: text("resolution"),
  fallbackFlag: boolean("fallback_flag").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Insert schemas
export const insertJobSchema = createInsertSchema(jobs).omit({
  id: true,
  createdAt: true,
});

export const insertVideoSchema = createInsertSchema(videos).omit({
  id: true,
  createdAt: true,
});

export const createJobSchema = z.object({
  prompt: z.string().min(1, "Prompt is required"),
  aspectRatio: z.string().default("9:16"),
  seeds: z.number().min(10000).max(99999).nullable().optional(),
});

// Types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobs.$inferSelect;
export type InsertVideo = z.infer<typeof insertVideoSchema>;
export type Video = typeof videos.$inferSelect;
export type CreateJobRequest = z.infer<typeof createJobSchema>;
