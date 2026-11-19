CREATE TABLE IF NOT EXISTS "ai_budget_reservations" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"budget_day" date NOT NULL,
	"reserved_tokens" integer NOT NULL,
	"actual_tokens" integer,
	"state" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_ai_budget_reservations_values" CHECK ("ai_budget_reservations"."reserved_tokens" > 0 AND ("ai_budget_reservations"."actual_tokens" IS NULL OR "ai_budget_reservations"."actual_tokens" BETWEEN 0 AND "ai_budget_reservations"."reserved_tokens") AND "ai_budget_reservations"."state" IN ('reserved','settled','released','expired'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_minute_limits" (
	"user_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "pk_ai_minute_limits" PRIMARY KEY("user_id","window_start"),
	CONSTRAINT "ck_ai_minute_limits_count" CHECK ("ai_minute_limits"."count" BETWEEN 1 AND 100000)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid,
	"operation_key" varchar(64) NOT NULL,
	"state" text NOT NULL,
	"result" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_ai_operations_owner_key" UNIQUE("user_id","operation_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_response_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid,
	"cache_key" varchar(64) NOT NULL,
	"content" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_ai_response_cache_user_key" UNIQUE("user_id","cache_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_usage" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"cache_hit" boolean DEFAULT false NOT NULL,
	"provider_attempts" integer DEFAULT 0 NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_ai_usage_operation_owner" UNIQUE("operation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_usage_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"outcome" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_ai_usage_attempt_operation_no" UNIQUE("operation_id","attempt_no")
);
--> statement-breakpoint
ALTER TABLE "flashcards" ADD COLUMN "source_quote" text;--> statement-breakpoint
ALTER TABLE "flashcards" ADD COLUMN "source_revision" varchar(64);--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "cancel_requested" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "uq_documents_id_owner" UNIQUE("id","user_id");--> statement-breakpoint
ALTER TABLE "flashcards" ADD CONSTRAINT "uq_flashcards_id_owner" UNIQUE("id","user_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_budget_reservations" ADD CONSTRAINT "ai_budget_reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_minute_limits" ADD CONSTRAINT "ai_minute_limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_operations" ADD CONSTRAINT "fk_ai_operations_document_owner" FOREIGN KEY ("document_id","user_id") REFERENCES "public"."documents"("id","user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_response_cache" ADD CONSTRAINT "ai_response_cache_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_response_cache" ADD CONSTRAINT "ai_response_cache_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_response_cache" ADD CONSTRAINT "fk_ai_response_cache_document_owner" FOREIGN KEY ("document_id","user_id") REFERENCES "public"."documents"("id","user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_usage_attempts" ADD CONSTRAINT "ai_usage_attempts_operation_id_ai_usage_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."ai_usage"("operation_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_usage_attempts" ADD CONSTRAINT "ai_usage_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_usage_attempts" ADD CONSTRAINT "fk_ai_usage_attempts_operation_owner" FOREIGN KEY ("operation_id","user_id") REFERENCES "public"."ai_usage"("operation_id","user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_budget_day_feature" ON "ai_budget_reservations" USING btree ("budget_day","feature");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_budget_owner_day" ON "ai_budget_reservations" USING btree ("user_id","budget_day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_budget_state_expiry" ON "ai_budget_reservations" USING btree ("state","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_minute_limits_window" ON "ai_minute_limits" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_operations_owner_expiry" ON "ai_operations" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_response_cache_user_expiry" ON "ai_response_cache" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_response_cache_document" ON "ai_response_cache" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_usage_user_created" ON "ai_usage" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_usage_attempts_user_created" ON "ai_usage_attempts" USING btree ("user_id","created_at");--> statement-breakpoint
-- Remove source locators that no longer belong to the stored document owner.
UPDATE "flashcards" AS f SET "chapter_id"=NULL,"source_chunk_id"=NULL,"source_quote"=NULL,"source_revision"=NULL
WHERE f."chapter_id" IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM "chapters" h WHERE h."id"=f."chapter_id" AND h."document_id"=f."document_id" AND h."user_id"=f."user_id"
);
--> statement-breakpoint
UPDATE "flashcards" AS f SET "source_chunk_id"=NULL,"source_quote"=NULL,"source_revision"=NULL
WHERE f."source_chunk_id" IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM "chunks" c JOIN "chapters" h ON h."id"=c."chapter_id"
  WHERE c."id"=f."source_chunk_id" AND c."chapter_id"=f."chapter_id"
    AND c."document_id"=f."document_id" AND h."document_id"=f."document_id"
    AND c."user_id"=f."user_id" AND h."user_id"=f."user_id"
);
--> statement-breakpoint
CREATE FUNCTION "guard_flashcard_evidence"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_quote IS NOT NULL OR NEW.source_revision IS NOT NULL THEN
    IF NEW.source_quote IS NULL OR btrim(NEW.source_quote)='' OR NEW.source_revision IS NULL
       OR NEW.source_revision !~ '^[0-9a-f]{64}$'
       OR NOT EXISTS (
         SELECT 1 FROM "chunks" c JOIN "chapters" h ON h."id"=c."chapter_id"
         WHERE c."id"=NEW.source_chunk_id AND c."chapter_id"=NEW.chapter_id
           AND c."document_id"=NEW.document_id AND h."document_id"=NEW.document_id
           AND c."user_id"=NEW.user_id AND h."user_id"=NEW.user_id
           AND position(NEW.source_quote IN c."content")>0
       ) THEN
      RAISE EXCEPTION 'flashcard evidence does not resolve in the owner-scoped source' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "guard_flashcard_evidence" BEFORE INSERT OR UPDATE OF "source_quote","source_revision","source_chunk_id","chapter_id","document_id","user_id" ON "flashcards"
FOR EACH ROW EXECUTE FUNCTION "guard_flashcard_evidence"();
--> statement-breakpoint
CREATE FUNCTION "clear_flashcard_chunk_evidence"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "flashcards" SET "source_chunk_id"=NULL,"source_quote"=NULL,"source_revision"=NULL
  WHERE "source_chunk_id"=OLD."id";
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "clear_flashcard_chunk_evidence" BEFORE DELETE ON "chunks"
FOR EACH ROW EXECUTE FUNCTION "clear_flashcard_chunk_evidence"();
--> statement-breakpoint
CREATE FUNCTION "clear_flashcard_chapter_evidence"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "flashcards" SET "chapter_id"=NULL,"source_chunk_id"=NULL,"source_quote"=NULL,"source_revision"=NULL
  WHERE "chapter_id"=OLD."id";
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "clear_flashcard_chapter_evidence" BEFORE DELETE ON "chapters"
FOR EACH ROW EXECUTE FUNCTION "clear_flashcard_chapter_evidence"();
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "flashcards" ADD CONSTRAINT "fk_flashcards_document_owner" FOREIGN KEY ("document_id","user_id") REFERENCES "public"."documents"("id","user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reviews" ADD CONSTRAINT "fk_reviews_card_owner" FOREIGN KEY ("flashcard_id","user_id") REFERENCES "public"."flashcards"("id","user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_jobs_status_lease" ON "jobs" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_jobs_kind_dedupe" ON "jobs" USING btree ("kind","dedupe_key") WHERE "jobs"."dedupe_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "flashcards" ADD CONSTRAINT "ck_flashcards_evidence_pair" CHECK (("flashcards"."source_quote" IS NULL AND "flashcards"."source_revision" IS NULL) OR (btrim("flashcards"."source_quote") <> '' AND "flashcards"."source_revision" ~ '^[0-9a-f]{64}$'));
