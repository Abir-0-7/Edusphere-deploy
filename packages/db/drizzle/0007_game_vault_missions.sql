CREATE TABLE "game_mission_progress" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "game_id" text NOT NULL,
  "mission_id" text NOT NULL,
  "unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "xp_awarded" integer DEFAULT 0 NOT NULL,
  "achievements" jsonb DEFAULT '[]'::jsonb NOT NULL,
  CONSTRAINT "uq_game_mission_progress_user_game_mission" UNIQUE("user_id", "game_id", "mission_id")
);
--> statement-breakpoint
ALTER TABLE "game_mission_progress" ADD CONSTRAINT "game_mission_progress_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_game_mission_progress_user_game" ON "game_mission_progress" USING btree ("user_id", "game_id");
