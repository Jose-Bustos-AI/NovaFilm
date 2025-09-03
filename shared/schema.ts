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
  integer,
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

// User storage table for Replit Auth + Local Auth
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  passwordHash: text("password_hash"), // For local auth - nullable for backward compatibility
  plan: text("plan").default('free'),
  creditsRemaining: integer("credits_remaining").notNull().default(0),
  subscriptionStatus: text("subscription_status").default('inactive'), // 'inactive' | 'trialing' | 'active' | 'canceled'
  stripeCustomerId: text("stripe_customer_id"),
  canceledAt: timestamp("canceled_at"),
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

// Credits ledger for tracking credit transactions
export const creditsLedger = pgTable("credits_ledger", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  delta: integer("delta").notNull(), // +N for addition, -1 for consumption
  reason: text("reason").notNull(), // 'video_generation' | 'manual_grant' | 'promo' | 'refund'
  jobId: uuid("job_id").references(() => jobs.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_credits_ledger_user_id").on(table.userId),
  index("idx_credits_ledger_created_at").on(table.createdAt),
]);

// Insert schemas
export const insertJobSchema = createInsertSchema(jobs).omit({
  id: true,
  createdAt: true,
});

export const insertVideoSchema = createInsertSchema(videos).omit({
  id: true,
  createdAt: true,
});

export const insertCreditsLedgerSchema = createInsertSchema(creditsLedger).omit({
  id: true,
  createdAt: true,
});

export const createJobSchema = z.object({
  prompt: z.string().min(1, "Prompt is required"),
  aspectRatio: z.string().default("9:16"),
  seeds: z.number().min(10000).max(99999).nullable().optional(),
});

export const updateUserProfileSchema = z.object({
  firstName: z.string().min(1).max(50).optional(),
  lastName: z.string().min(1).max(50).optional(),
  profileImageUrl: z.string().url().optional().or(z.literal('')),
});

// Local auth schemas
export const registerSchema = z.object({
  email: z.string().email("Email válido requerido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  firstName: z.string().min(1).max(50).optional(),
  lastName: z.string().min(1).max(50).optional(),
});

export const loginSchema = z.object({
  email: z.string().email("Email válido requerido"),
  password: z.string().min(1, "Contraseña requerida"),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Contraseña actual requerida"),
  newPassword: z.string().min(8, "La nueva contraseña debe tener al menos 8 caracteres"),
});

export const setPasswordSchema = z.object({
  newPassword: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
});

// Types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobs.$inferSelect;
export type InsertVideo = z.infer<typeof insertVideoSchema>;
export type Video = typeof videos.$inferSelect;
export type CreateJobRequest = z.infer<typeof createJobSchema>;
export type InsertCreditsLedger = z.infer<typeof insertCreditsLedgerSchema>;
export type CreditsLedger = typeof creditsLedger.$inferSelect;
export type UpdateUserProfile = z.infer<typeof updateUserProfileSchema>;
export type RegisterRequest = z.infer<typeof registerSchema>;
export type LoginRequest = z.infer<typeof loginSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordSchema>;
export type SetPasswordRequest = z.infer<typeof setPasswordSchema>;
