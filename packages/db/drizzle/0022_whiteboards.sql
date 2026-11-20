CREATE TABLE IF NOT EXISTS "whiteboard_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"file_id" varchar(160) NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_whiteboard_assets_board_file" UNIQUE("board_id","user_id","file_id"),
	CONSTRAINT "ck_whiteboard_assets_type" CHECK ("whiteboard_assets"."mime_type" IN ('image/png','image/jpeg','image/webp')),
	CONSTRAINT "ck_whiteboard_assets_size" CHECK ("whiteboard_assets"."size_bytes" BETWEEN 1 AND 10485760),
	CONSTRAINT "ck_whiteboard_assets_bytes" CHECK ("whiteboard_assets"."size_bytes" = octet_length("whiteboard_assets"."data")),
	CONSTRAINT "ck_whiteboard_assets_hash" CHECK ("whiteboard_assets"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whiteboards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"scene" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_whiteboards_id_owner" UNIQUE("id","user_id"),
	CONSTRAINT "ck_whiteboards_revision" CHECK ("whiteboards"."revision" > 0),
	CONSTRAINT "ck_whiteboards_scene_object" CHECK (jsonb_typeof("whiteboards"."scene") = 'object')
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whiteboard_assets" ADD CONSTRAINT "fk_whiteboard_assets_board_owner" FOREIGN KEY ("board_id","user_id") REFERENCES "public"."whiteboards"("id","user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whiteboards" ADD CONSTRAINT "whiteboards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_whiteboard_assets_owner_board" ON "whiteboard_assets" USING btree ("user_id","board_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_whiteboards_user_updated" ON "whiteboards" USING btree ("user_id","updated_at");