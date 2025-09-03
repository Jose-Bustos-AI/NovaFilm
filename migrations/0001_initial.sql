-- Create sessions table for Replit Auth
CREATE TABLE IF NOT EXISTS "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);

-- Create index for session expiration
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "sessions" ("expire");

-- Create job status enum
DO $$ BEGIN
 CREATE TYPE "job_status" AS ENUM('QUEUED', 'PROCESSING', 'READY', 'FAILED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- Create users table
CREATE TABLE IF NOT EXISTS "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);

-- Create jobs table
CREATE TABLE IF NOT EXISTS "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" varchar NOT NULL,
	"task_id" text NOT NULL,
	"status" "job_status" DEFAULT 'QUEUED' NOT NULL,
	"error_reason" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "jobs_task_id_unique" UNIQUE("task_id")
);

-- Create videos table
CREATE TABLE IF NOT EXISTS "videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" varchar NOT NULL,
	"task_id" text NOT NULL,
	"prompt" text NOT NULL,
	"provider_video_url" text,
	"resolution" text,
	"fallback_flag" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "videos_task_id_unique" UNIQUE("task_id")
);

-- Add foreign key constraints
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "videos" ADD CONSTRAINT "videos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
