CREATE TABLE "gallery_photos" (
	"id" uuid PRIMARY KEY,
	"title" text NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"image_key" text NOT NULL,
	"content_type" text NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
