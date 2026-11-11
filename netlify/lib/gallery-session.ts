import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/netlify-db';
import { and, eq, gt } from 'drizzle-orm';
import { gallerySessions } from '../../db/schema.js';
export function sessionHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
export async function hasGallerySession(req: Request) {
  const token = req.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith('gallery_session='))?.slice('gallery_session='.length);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
  const [session] = await drizzle().select({ tokenHash: gallerySessions.tokenHash }).from(gallerySessions).where(and(eq(gallerySessions.tokenHash, sessionHash(token)), gt(gallerySessions.expiresAt, new Date())));
  return !!session;
}
