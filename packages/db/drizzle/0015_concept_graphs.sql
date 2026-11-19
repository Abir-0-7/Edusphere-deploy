CREATE TABLE IF NOT EXISTS "concept_graphs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "graph" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_concept_graph_document_owner" UNIQUE ("document_id", "user_id"),
  CONSTRAINT "ck_concept_graph_revision" CHECK ("revision" > 0),
  CONSTRAINT "ck_concept_graph_object" CHECK (jsonb_typeof("graph") = 'object')
);
--> statement-breakpoint
ALTER TABLE "concept_graphs" ADD CONSTRAINT "concept_graphs_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "concept_graphs" ADD CONSTRAINT "fk_concept_graph_source_owner"
  FOREIGN KEY ("document_id", "user_id") REFERENCES "public"."documents"("id", "user_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_concept_graphs_user_updated" ON "concept_graphs" USING btree ("user_id", "updated_at");
