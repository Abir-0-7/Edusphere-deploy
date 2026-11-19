CREATE TABLE IF NOT EXISTS "flashcard_quality_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flashcards" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "flashcards" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "flashcard_quality_reports" ADD CONSTRAINT "flashcard_quality_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "flashcard_quality_reports" ADD CONSTRAINT "fk_flashcard_quality_reports_card_owner" FOREIGN KEY ("card_id","user_id") REFERENCES "public"."flashcards"("id","user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_flashcard_quality_reports_user_created" ON "flashcard_quality_reports" USING btree ("user_id","created_at");
