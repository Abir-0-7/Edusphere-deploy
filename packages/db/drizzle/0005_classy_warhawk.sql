ALTER TABLE "reviews" ADD COLUMN "client_review_id" uuid;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "uq_reviews_client_id" UNIQUE("client_review_id");