CREATE TABLE "study_guilds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" varchar(64) NOT NULL,
	"invite_code" varchar(16) NOT NULL,
	"weekly_goal_minutes" integer DEFAULT 300 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_guilds_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
CREATE TABLE "study_guild_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_study_guild_member" UNIQUE("guild_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "study_guilds" ADD CONSTRAINT "study_guilds_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "study_guild_members" ADD CONSTRAINT "study_guild_members_guild_id_study_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."study_guilds"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "study_guild_members" ADD CONSTRAINT "study_guild_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_study_guilds_owner" ON "study_guilds" USING btree ("owner_user_id");
--> statement-breakpoint
CREATE INDEX "idx_guild_members_user" ON "study_guild_members" USING btree ("user_id");
