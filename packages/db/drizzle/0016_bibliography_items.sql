CREATE TABLE "bibliography_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "title" text DEFAULT '' NOT NULL,
  "authors" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "issued" jsonb,
  "container_title" text DEFAULT '' NOT NULL,
  "edition" text DEFAULT '' NOT NULL,
  "volume" text DEFAULT '' NOT NULL,
  "issue" text DEFAULT '' NOT NULL,
  "item_pages" text DEFAULT '' NOT NULL,
  "publisher" text DEFAULT '' NOT NULL,
  "doi" text DEFAULT '' NOT NULL,
  "url" text DEFAULT '' NOT NULL,
  "accessed" jsonb,
  "repository_commit" text DEFAULT '' NOT NULL,
  "source_document_id" uuid,
  "metadata_provenance" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "metadata_suggestions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ck_bibliography_kind" CHECK ("kind" IN ('book', 'book_chapter', 'journal_article', 'website', 'repository')),
  CONSTRAINT "ck_bibliography_revision" CHECK ("revision" > 0),
  CONSTRAINT "fk_bibliography_source_document_owner" FOREIGN KEY ("source_document_id", "user_id") REFERENCES "documents"("id", "user_id")
);
--> statement-breakpoint
ALTER TABLE "bibliography_items" ADD CONSTRAINT "bibliography_items_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX "idx_bibliography_user_updated" ON "bibliography_items" USING btree ("user_id", "updated_at");
--> statement-breakpoint
CREATE INDEX "idx_bibliography_user_source" ON "bibliography_items" USING btree ("user_id", "source_document_id");
--> statement-breakpoint
CREATE FUNCTION clear_bibliography_source_before_document_delete() RETURNS trigger AS $$
BEGIN
  UPDATE "bibliography_items"
     SET "source_document_id" = NULL
   WHERE "source_document_id" = OLD."id"
     AND "user_id" = OLD."user_id";
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "trg_documents_clear_bibliography_source"
  BEFORE DELETE ON "documents"
  FOR EACH ROW EXECUTE FUNCTION clear_bibliography_source_before_document_delete();
