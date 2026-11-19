ALTER TABLE "flashcard_versions" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "flashcards" ADD COLUMN "needs_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "flashcards" ADD CONSTRAINT "ck_flashcards_status" CHECK ("flashcards"."status" IN ('active','retired'));--> statement-breakpoint
ALTER TABLE "flashcards" ADD CONSTRAINT "ck_flashcards_tags" CHECK (jsonb_typeof("flashcards"."tags") = 'array' AND jsonb_array_length("flashcards"."tags") <= 20);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "version_flashcard_content_update"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE next_version integer;
BEGIN
  IF NEW.front IS DISTINCT FROM OLD.front OR NEW.back IS DISTINCT FROM OLD.back THEN
    SELECT COALESCE(MAX(version), 0) + 1 INTO next_version
    FROM "flashcard_versions" WHERE card_id = OLD.id AND user_id = OLD.user_id;
    INSERT INTO "flashcard_versions"
      ("card_id","user_id","version","front","back","chapter_id","source_chunk_id",
       "source_quote","source_revision","tags","created_at")
    VALUES
      (OLD.id, OLD.user_id, next_version, NEW.front, NEW.back, NEW.chapter_id, NEW.source_chunk_id,
       NEW.source_quote, NEW.source_revision, NEW.tags, now());
    NEW.needs_review := true;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "version_flashcard_content_update"
BEFORE UPDATE OF "front","back" ON "flashcards"
FOR EACH ROW EXECUTE FUNCTION "version_flashcard_content_update"();
