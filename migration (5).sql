CREATE TABLE "suite_state" (
	"id" integer PRIMARY KEY,
	"data" jsonb DEFAULT '{}' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"password_hash" text
);
