CREATE TABLE "source_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "document_id" uuid,
  "content_hash" varchar(64) NOT NULL,
  "snapshot" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_source_versions_owner_hash" UNIQUE ("user_id", "content_hash"),
  CONSTRAINT "ck_source_versions_hash" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ck_source_versions_snapshot_object" CHECK (jsonb_typeof("snapshot") = 'object'),
  CONSTRAINT "ck_source_versions_snapshot_size" CHECK (octet_length("snapshot"::text) <= 3145728),
  CONSTRAINT "source_versions_user_id_users_id_fk" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_source_versions_document_owner" FOREIGN KEY ("document_id", "user_id")
    REFERENCES "documents"("id", "user_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "idx_source_versions_owner_created" ON "source_versions" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_source_versions_document" ON "source_versions" USING btree ("document_id");
--> statement-breakpoint
CREATE FUNCTION reject_source_version_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Source versions are immutable; create a new version instead'
    USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER source_versions_immutable
BEFORE UPDATE ON "source_versions"
FOR EACH ROW EXECUTE FUNCTION reject_source_version_update();
