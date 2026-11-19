CREATE TABLE "course_generation_lesson_edits" (
  "run_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "objective_id" text NOT NULL,
  "revision" integer NOT NULL,
  "output" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "copied_from_run_id" uuid,
  "copied_from_revision" integer,
  CONSTRAINT "course_generation_lesson_edits_run_id_objective_id_revision_pk" PRIMARY KEY ("run_id", "objective_id", "revision"),
  CONSTRAINT "course_generation_lesson_edits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_generation_edits_run_owner" FOREIGN KEY ("run_id", "user_id") REFERENCES "course_generation_runs"("id", "user_id") ON DELETE CASCADE,
  CONSTRAINT "ck_generation_edits_revision" CHECK ("revision" BETWEEN 1 AND 5),
  CONSTRAINT "ck_generation_edits_objective" CHECK ("objective_id" ~ '^[A-Za-z0-9_-]{1,80}$'),
  CONSTRAINT "ck_generation_edits_output" CHECK (jsonb_typeof("output") = 'object' AND octet_length("output"::text) <= 65536),
  CONSTRAINT "ck_generation_edits_copy" CHECK (("copied_from_run_id" IS NULL AND "copied_from_revision" IS NULL) OR ("copied_from_run_id" IS NOT NULL AND "copied_from_revision" IS NOT NULL AND "copied_from_revision" BETWEEN 1 AND 5))
);
--> statement-breakpoint
CREATE INDEX "idx_generation_edits_owner_run" ON "course_generation_lesson_edits" ("user_id", "run_id");
--> statement-breakpoint
CREATE FUNCTION reject_generation_lesson_edit_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Lesson edit history is append-only' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER course_generation_edits_immutable BEFORE UPDATE ON "course_generation_lesson_edits"
FOR EACH ROW EXECUTE FUNCTION reject_generation_lesson_edit_update();
