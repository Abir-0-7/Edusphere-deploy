ALTER TABLE "course_outline_approvals" ADD CONSTRAINT "uq_outline_approvals_owner_outline" UNIQUE ("id", "user_id", "outline_id");
--> statement-breakpoint
CREATE TABLE "course_generation_runs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "outline_id" uuid NOT NULL,
  "approval_id" uuid NOT NULL,
  "active_job_id" uuid,
  "revision" integer DEFAULT 1 NOT NULL,
  "state" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "course_generation_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "uq_course_generation_runs_owner" UNIQUE ("id", "user_id"),
  CONSTRAINT "fk_generation_outline_owner" FOREIGN KEY ("outline_id", "user_id") REFERENCES "course_outlines"("id", "user_id") ON DELETE CASCADE,
  CONSTRAINT "fk_generation_approval_owner_outline" FOREIGN KEY ("approval_id", "user_id", "outline_id") REFERENCES "course_outline_approvals"("id", "user_id", "outline_id") ON DELETE CASCADE,
  CONSTRAINT "ck_generation_revision" CHECK ("revision" > 0),
  CONSTRAINT "ck_generation_state_object" CHECK (jsonb_typeof("state") = 'object'),
  CONSTRAINT "ck_generation_state_size" CHECK (octet_length("state"::text) <= 2097152)
);
--> statement-breakpoint
CREATE INDEX "idx_course_generation_owner_updated" ON "course_generation_runs" ("user_id", "updated_at");
--> statement-breakpoint
CREATE INDEX "idx_course_generation_outline" ON "course_generation_runs" ("outline_id", "user_id");
--> statement-breakpoint
ALTER TABLE "ai_operations" ADD COLUMN "generation_run_id" uuid;
--> statement-breakpoint
ALTER TABLE "ai_response_cache" ADD COLUMN "generation_run_id" uuid;
--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "fk_operations_generation_owner" FOREIGN KEY ("generation_run_id", "user_id") REFERENCES "course_generation_runs"("id", "user_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "ai_response_cache" ADD CONSTRAINT "fk_response_cache_generation_owner" FOREIGN KEY ("generation_run_id", "user_id") REFERENCES "course_generation_runs"("id", "user_id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX "idx_ai_operations_generation" ON "ai_operations" ("generation_run_id", "user_id");
--> statement-breakpoint
CREATE INDEX "idx_ai_response_cache_generation" ON "ai_response_cache" ("generation_run_id", "user_id");
--> statement-breakpoint
CREATE FUNCTION delete_jobs_for_course_generation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM jobs WHERE payload->>'user_id' = OLD.user_id::text AND payload->>'generation_id' = OLD.id::text
    AND kind = 'generate_course_modules';
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER course_generation_delete_jobs BEFORE DELETE ON "course_generation_runs"
FOR EACH ROW EXECUTE FUNCTION delete_jobs_for_course_generation();
