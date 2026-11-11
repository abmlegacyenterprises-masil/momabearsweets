import { pgTable, text, boolean, timestamp, uuid, integer, jsonb } from 'drizzle-orm/pg-core';
export const galleryPhotos = pgTable('gallery_photos', {
  id: uuid().primaryKey(),
  title: text().notNull(),
  caption: text().notNull().default(''),
  imageKey: text('image_key').notNull(),
  contentType: text('content_type').notNull(),
  position: integer().notNull().default(0),
  published: boolean().notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const gallerySessions = pgTable('gallery_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
});

export const suiteState = pgTable('suite_state', {
  id: integer().primaryKey(),
  data: jsonb().notNull().default({}),
  revision: integer().notNull().default(0),
  passwordHash: text('password_hash'),
});

// Orders placed from the Customer Portal, waiting to be merged into MomaBear's shared Suite data.
export const portalOrders = pgTable('portal_orders', {
  id: text().primaryKey(),
  order: jsonb().notNull(),
  profile: jsonb().notNull().default({}),
  merged: boolean().notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
