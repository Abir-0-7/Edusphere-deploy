CREATE TABLE IF NOT EXISTS "flashcard_quiz_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"deck_id" uuid NOT NULL,
	"questions" jsonb NOT NULL,
	"answer_key" jsonb NOT NULL,
	"submitted_answers" jsonb,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"graded_at" timestamp with time zone
);
DO $$ BEGIN
 ALTER TABLE "flashcard_quiz_sessions" ADD CONSTRAINT "flashcard_quiz_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "flashcard_quiz_sessions" ADD CONSTRAINT "fk_flashcard_quiz_sessions_document_owner" FOREIGN KEY ("document_id","user_id") REFERENCES "public"."documents"("id","user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "flashcard_quiz_sessions" ADD CONSTRAINT "fk_flashcard_quiz_sessions_deck_owner" FOREIGN KEY ("deck_id","document_id","user_id") REFERENCES "public"."flashcard_decks"("id","document_id","user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
CREATE INDEX IF NOT EXISTS "idx_flashcard_quiz_sessions_user_created" ON "flashcard_quiz_sessions" USING btree ("user_id","created_at");
