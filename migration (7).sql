CREATE TABLE "portal_orders" (
	"id" text PRIMARY KEY,
	"order" jsonb NOT NULL,
	"profile" jsonb DEFAULT '{}' NOT NULL,
	"merged" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
