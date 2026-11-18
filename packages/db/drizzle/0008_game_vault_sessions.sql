CREATE TABLE IF NOT EXISTS "game_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"game_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"status" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"tokens_awarded" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "realtime_duels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"opponent_user_id" uuid,
	"state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '1 day' NOT NULL,
	CONSTRAINT "ck_realtime_distinct_players" CHECK (opponent_user_id IS NULL OR opponent_user_id <> user_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "realtime_event_limits" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "ck_realtime_event_limits_count" CHECK ("realtime_event_limits"."count" BETWEEN 1 AND 601)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "realtime_matchmaking" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"match_id" uuid,
	"opponent_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '5 minutes' NOT NULL,
	CONSTRAINT "ck_matchmaking_distinct_players" CHECK (opponent_user_id IS NULL OR opponent_user_id <> user_id)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "realtime_duels" ADD CONSTRAINT "realtime_duels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "realtime_duels" ADD CONSTRAINT "realtime_duels_opponent_user_id_users_id_fk" FOREIGN KEY ("opponent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "realtime_event_limits" ADD CONSTRAINT "realtime_event_limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "realtime_matchmaking" ADD CONSTRAINT "realtime_matchmaking_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "realtime_matchmaking" ADD CONSTRAINT "realtime_matchmaking_opponent_user_id_users_id_fk" FOREIGN KEY ("opponent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_game_sessions_user_updated" ON "game_sessions" USING btree ("user_id","updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_realtime_duels_user" ON "realtime_duels" USING btree ("user_id","expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_realtime_duels_opponent" ON "realtime_duels" USING btree ("opponent_user_id","expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_realtime_matchmaking_expiry" ON "realtime_matchmaking" USING btree ("expires_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION purge_realtime_source_duels() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM realtime_duels WHERE user_id = OLD.user_id AND state->'cards' @> jsonb_build_array(jsonb_build_object('id', OLD.id::text));
  RETURN OLD;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS purge_realtime_source_duels ON flashcards;
--> statement-breakpoint
CREATE TRIGGER purge_realtime_source_duels BEFORE DELETE ON flashcards FOR EACH ROW EXECUTE FUNCTION purge_realtime_source_duels();
