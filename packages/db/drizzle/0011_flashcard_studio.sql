CREATE TABLE IF NOT EXISTS "flashcard_decks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_flashcard_decks_id_document_owner" UNIQUE("id","document_id","user_id"),
	CONSTRAINT "ck_flashcard_decks_name" CHECK (char_length(btrim("name")) BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "flashcard_generation_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"source_revision" text NOT NULL,
	"settings" jsonb NOT NULL,
	"cards" jsonb NOT NULL,
	"merge_result" jsonb,
	"selected_ids" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_flashcard_generation_drafts_revision" CHECK ("source_revision" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "flashcard_versions" (
	"card_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"front" text NOT NULL,
	"back" text NOT NULL,
	"chapter_id" uuid,
	"source_chunk_id" uuid,
	"source_quote" text,
	"source_revision" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_flashcard_versions" PRIMARY KEY("card_id","version"),
	CONSTRAINT "ck_flashcard_versions_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
ALTER TABLE "flashcards" ADD COLUMN "deck_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "flashcard_decks" ADD CONSTRAINT "flashcard_decks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "flashcard_decks" ADD CONSTRAINT "fk_flashcard_decks_document_owner" FOREIGN KEY ("document_id","user_id") REFERENCES "public"."documents"("id","user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "flashcard_generation_drafts" ADD CONSTRAINT "flashcard_generation_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "flashcard_generation_drafts" ADD CONSTRAINT "fk_flashcard_generation_drafts_document_owner" FOREIGN KEY ("document_id","user_id") REFERENCES "public"."documents"("id","user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "flashcard_versions" ADD CONSTRAINT "flashcard_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "flashcard_versions" ADD CONSTRAINT "fk_flashcard_versions_card_owner" FOREIGN KEY ("card_id","user_id") REFERENCES "public"."flashcards"("id","user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_flashcard_decks_default" ON "flashcard_decks" USING btree ("user_id","document_id") WHERE "is_default";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_flashcard_decks_named" ON "flashcard_decks" USING btree ("user_id","document_id","name") WHERE NOT "is_default";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_flashcard_generation_drafts_user_created" ON "flashcard_generation_drafts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_flashcard_generation_drafts_document" ON "flashcard_generation_drafts" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_flashcard_versions_user" ON "flashcard_versions" USING btree ("user_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "flashcards" ADD CONSTRAINT "fk_flashcards_deck_document_owner" FOREIGN KEY ("deck_id","document_id","user_id") REFERENCES "public"."flashcard_decks"("id","document_id","user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_flashcards_deck" ON "flashcards" USING btree ("deck_id");--> statement-breakpoint
-- Do not reassign a card across accounts to repair invalid legacy ownership.
-- The composite foreign key aborts migration on any such row for manual review.
INSERT INTO "flashcard_decks" ("user_id", "document_id", "name", "is_default")
SELECT DISTINCT "user_id", "document_id", 'Default', true FROM "flashcards";
--> statement-breakpoint
UPDATE "flashcards" AS f
SET "deck_id" = d."id"
FROM "flashcard_decks" AS d
WHERE d."document_id" = f."document_id" AND d."user_id" = f."user_id" AND d."is_default";
--> statement-breakpoint
ALTER TABLE "flashcards" ALTER COLUMN "deck_id" SET NOT NULL;
--> statement-breakpoint
-- Keep stable card IDs and history. Only backfill evidence locators that still
-- resolve to the same chapter, document, and owner. Do not invent a quote.
UPDATE "flashcards" AS f SET "source_chunk_id" = NULL, "source_quote" = NULL, "source_revision" = NULL
WHERE f."source_chunk_id" IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM "chunks" AS c JOIN "chapters" AS h ON h."id" = c."chapter_id"
  WHERE c."id" = f."source_chunk_id" AND c."chapter_id" = f."chapter_id"
    AND c."document_id" = f."document_id" AND h."document_id" = f."document_id"
    AND c."user_id" = f."user_id" AND h."user_id" = f."user_id"
);
--> statement-breakpoint
UPDATE "flashcards" AS f SET "chapter_id" = NULL, "source_chunk_id" = NULL, "source_quote" = NULL, "source_revision" = NULL
WHERE f."chapter_id" IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM "chapters" AS h WHERE h."id" = f."chapter_id"
    AND h."document_id" = f."document_id" AND h."user_id" = f."user_id"
);
--> statement-breakpoint
INSERT INTO "flashcard_versions" ("card_id", "user_id", "version", "front", "back", "chapter_id", "source_chunk_id", "source_quote", "source_revision", "created_at")
SELECT "id", "user_id", 1, "front", "back", "chapter_id", "source_chunk_id", "source_quote", "source_revision", "created_at" FROM "flashcards";
--> statement-breakpoint
CREATE FUNCTION "prepare_flashcard_insert"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deck_id IS NULL THEN
    -- Old writers need no migration-specific parameters. Avoid updating the
    -- default deck on each retry; the second query sees a concurrent commit.
    INSERT INTO "flashcard_decks" ("user_id", "document_id", "name", "is_default")
    VALUES (NEW.user_id, NEW.document_id, 'Default', true)
    ON CONFLICT ("user_id", "document_id") WHERE "is_default" DO NOTHING;
    SELECT d."id" INTO NEW.deck_id FROM "flashcard_decks" AS d
    WHERE d."user_id" = NEW.user_id AND d."document_id" = NEW.document_id AND d."is_default";
  END IF;
  IF NEW.source_quote IS NOT NULL OR NEW.source_revision IS NOT NULL THEN
    IF NEW.source_quote IS NULL OR btrim(NEW.source_quote) = ''
       OR (NEW.source_revision IS NOT NULL AND NEW.source_revision !~ '^[0-9a-f]{64}$')
       OR NOT EXISTS (
         SELECT 1 FROM "chunks" AS c JOIN "chapters" AS h ON h."id" = c."chapter_id"
         WHERE c."id" = NEW.source_chunk_id AND c."chapter_id" = NEW.chapter_id
           AND c."document_id" = NEW.document_id AND h."document_id" = NEW.document_id
           AND c."user_id" = NEW.user_id AND h."user_id" = NEW.user_id
           AND position(NEW.source_quote IN c."content") > 0
       ) THEN
      RAISE EXCEPTION 'flashcard evidence quote or source revision is invalid' USING ERRCODE = '23514';
    END IF;
  ELSE
    -- Existing writers have no quoted evidence. Keep valid locators, but do not
    -- let legacy callers expose a mismatched chapter or another owner's chunk.
    IF NEW.source_chunk_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "chunks" AS c JOIN "chapters" AS h ON h."id" = c."chapter_id"
      WHERE c."id" = NEW.source_chunk_id AND c."chapter_id" = NEW.chapter_id
        AND c."document_id" = NEW.document_id AND h."document_id" = NEW.document_id
        AND c."user_id" = NEW.user_id AND h."user_id" = NEW.user_id
    ) THEN
      NEW.source_chunk_id := NULL;
    END IF;
    IF NEW.chapter_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "chapters" AS h WHERE h."id" = NEW.chapter_id
        AND h."document_id" = NEW.document_id AND h."user_id" = NEW.user_id
    ) THEN
      NEW.chapter_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "prepare_flashcard_insert" BEFORE INSERT ON "flashcards"
FOR EACH ROW EXECUTE FUNCTION "prepare_flashcard_insert"();
--> statement-breakpoint
CREATE FUNCTION "snapshot_flashcard_insert"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "flashcard_versions" ("card_id", "user_id", "version", "front", "back", "chapter_id",
                                    "source_chunk_id", "source_quote", "source_revision", "created_at")
  VALUES (NEW.id, NEW.user_id, 1, NEW.front, NEW.back, NEW.chapter_id,
          NEW.source_chunk_id, NEW.source_quote, NEW.source_revision, NEW.created_at);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "snapshot_flashcard_insert" AFTER INSERT ON "flashcards"
FOR EACH ROW EXECUTE FUNCTION "snapshot_flashcard_insert"();
