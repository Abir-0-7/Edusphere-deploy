ALTER TABLE "source_versions" ADD CONSTRAINT "uq_source_versions_id_owner" UNIQUE ("id", "user_id");
--> statement-breakpoint
CREATE TABLE "course_outlines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "plan" jsonb NOT NULL,
  "content_hash" varchar(64) NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "approved_revision" integer,
  "approved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "course_outlines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "uq_course_outlines_id_owner" UNIQUE ("id", "user_id"),
  CONSTRAINT "ck_course_outlines_revision" CHECK ("revision" > 0),
  CONSTRAINT "ck_course_outlines_hash" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ck_course_outlines_plan_object" CHECK (jsonb_typeof("plan") = 'object'),
  CONSTRAINT "ck_course_outlines_plan_size" CHECK (octet_length("plan"::text) <= 262144),
  CONSTRAINT "ck_course_outlines_approval" CHECK (
    ("status" = 'draft' AND "approved_revision" IS NULL AND "approved_at" IS NULL)
    OR ("status" = 'approved' AND "approved_revision" IS NOT NULL
        AND "approved_revision" = "revision" AND "approved_at" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX "idx_course_outlines_owner_updated" ON "course_outlines" ("user_id", "updated_at");
--> statement-breakpoint
CREATE TABLE "course_outline_sources" (
  "outline_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "source_version_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "course_outline_sources_outline_id_source_version_id_pk" PRIMARY KEY ("outline_id", "source_version_id"),
  CONSTRAINT "course_outline_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_outline_sources_outline_owner" FOREIGN KEY ("outline_id", "user_id")
    REFERENCES "course_outlines"("id", "user_id") ON DELETE CASCADE,
  CONSTRAINT "fk_outline_sources_version_owner" FOREIGN KEY ("source_version_id", "user_id")
    REFERENCES "source_versions"("id", "user_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "idx_outline_sources_version_owner" ON "course_outline_sources" ("source_version_id", "user_id");
--> statement-breakpoint
CREATE INDEX "idx_outline_sources_owner" ON "course_outline_sources" ("user_id");
--> statement-breakpoint
CREATE TABLE "course_outline_approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "outline_id" uuid NOT NULL,
  "revision" integer NOT NULL,
  "content_hash" varchar(64) NOT NULL,
  "snapshot" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "course_outline_approvals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "uq_outline_approvals_outline_revision" UNIQUE ("outline_id", "revision"),
  CONSTRAINT "fk_outline_approvals_outline_owner" FOREIGN KEY ("outline_id", "user_id")
    REFERENCES "course_outlines"("id", "user_id") ON DELETE CASCADE,
  CONSTRAINT "ck_outline_approvals_revision" CHECK ("revision" > 0),
  CONSTRAINT "ck_outline_approvals_hash" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ck_outline_approvals_snapshot_object" CHECK (jsonb_typeof("snapshot") = 'object'),
  CONSTRAINT "ck_outline_approvals_snapshot_size" CHECK (octet_length("snapshot"::text) <= 524288)
);
--> statement-breakpoint
CREATE INDEX "idx_outline_approvals_owner_created" ON "course_outline_approvals" ("user_id", "created_at");
--> statement-breakpoint
CREATE FUNCTION reject_outline_approval_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Outline approvals are immutable; approve a new revision instead' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER course_outline_approvals_immutable BEFORE UPDATE ON "course_outline_approvals"
FOR EACH ROW EXECUTE FUNCTION reject_outline_approval_update();
--> statement-breakpoint
CREATE FUNCTION delete_outlines_for_source_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM course_outlines o
  WHERE o.user_id = OLD.user_id AND EXISTS (
    SELECT 1 FROM course_outline_sources s
    WHERE s.outline_id = o.id AND s.user_id = o.user_id AND s.source_version_id = OLD.id
  );
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER source_versions_delete_outlines BEFORE DELETE ON "source_versions"
FOR EACH ROW EXECUTE FUNCTION delete_outlines_for_source_version();
