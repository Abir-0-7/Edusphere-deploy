CREATE TABLE IF NOT EXISTS "course_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"exercise_id" text NOT NULL,
	"kind" text NOT NULL,
	"request" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "course_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"state" jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_course_enrollment_release" UNIQUE("user_id","release_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "course_releases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"course_id" uuid NOT NULL,
	"user_id" uuid,
	"version" text NOT NULL,
	"status" text NOT NULL,
	"visibility" text NOT NULL,
	"content" jsonb NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_course_release_version" UNIQUE("course_id","version")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "courses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"user_id" uuid,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courses_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "learner_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"goal_kind" text NOT NULL,
	"goal" varchar(200) NOT NULL,
	"familiarity" text NOT NULL,
	"weekly_minutes" integer NOT NULL,
	"deadline" text,
	"language" text NOT NULL,
	"accessibility" jsonb NOT NULL,
	"role_variant" text DEFAULT 'auto' NOT NULL,
	"explanation_depth" text DEFAULT 'standard' NOT NULL,
	"pace" text DEFAULT 'standard' NOT NULL,
	"diagnostic" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "learner_recommendation_snapshots" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"snapshot" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "learner_track_plan_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"track_id" text NOT NULL,
	"required_course_slugs" jsonb NOT NULL,
	"required_objective_ids" jsonb NOT NULL,
	"objective_mapping" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_learner_track_plan_user_revision" UNIQUE("user_id","revision")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "course_attempts" ADD CONSTRAINT "course_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "course_attempts" ADD CONSTRAINT "course_attempts_enrollment_id_course_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."course_enrollments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_release_id_course_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."course_releases"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "course_releases" ADD CONSTRAINT "course_releases_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "course_releases" ADD CONSTRAINT "course_releases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "courses" ADD CONSTRAINT "courses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learner_profiles" ADD CONSTRAINT "learner_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learner_recommendation_snapshots" ADD CONSTRAINT "learner_recommendation_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learner_track_plan_revisions" ADD CONSTRAINT "learner_track_plan_revisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_course_attempts_user" ON "course_attempts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_course_attempts_enrollment" ON "course_attempts" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_course_enrollments_user" ON "course_enrollments" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_course_releases_course" ON "course_releases" USING btree ("course_id");