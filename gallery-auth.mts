import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, timingSafeEqual, createHash, scryptSync } from 'node:crypto';
import { verifyRequestOrigin } from '@netlify/identity';
import type { Context } from '@netlify/functions';
import { drizzle } from 'drizzle-orm/netlify-db';
import { eq, lt } from 'drizzle-orm';
import { gallerySessions, suiteState } from '../../db/schema.js';
import { hasGallerySession, sessionHash } from '../lib/gallery-session.js';
export default async (req: Request, context: Context) => {
  const headers = { 'Cache-Control': 'no-store' };
  const respond = (data: unknown, status = 200) => Response.json(data, { status, headers });
  try {
    if (req.method === 'GET') return respond({ unlocked: await hasGallerySession(req) });
    if (req.method !== 'POST') return new Response(null, { status: 405 });
    verifyRequestOrigin(req);
    const body = await req.json();
    const db = drizzle();
    if (body.action === 'logout') {
      const token = context.cookies.get('gallery_session');
      if (token) await db.delete(gallerySessions).where(eq(gallerySessions.tokenHash, sessionHash(token)));
      context.cookies.set({ name: 'gallery_session', value: '', path: '/', maxAge: 0, httpOnly: true, sameSite: 'Strict', secure: new URL(req.url).protocol === 'https:' });
      return respond({ ok: true });
    }
    if (body.action === 'password') {
      if (!await hasGallerySession(req)) return respond({error: 'Unlock the Suite first.'}, 401);
      if (typeof body.password !== 'string' || !body.password.trim() || body.password.length > 256) return respond({error: 'Enter a valid password.'}, 400);
      const salt = randomBytes(16).toString('hex');
      const passwordHash = salt + ':' + scryptSync(body.password, salt, 64).toString('hex');
      await db.insert(suiteState).values({id: 1, passwordHash}).onConflictDoUpdate({target: suiteState.id, set: {passwordHash}});
      return respond({ok: true});
    }
    // Reuse the existing portal's default rather than maintaining another password.
    const html = await readFile(join(process.cwd(), 'index.html'), 'utf8');
    const [settings] = await db.select({passwordHash: suiteState.passwordHash}).from(suiteState).where(eq(suiteState.id, 1));
    const expected = html.match(/ownerPassword:\s*"([^"\n]+)"/)?.[1];
    if (!expected) return respond({ error: 'Gallery access is temporarily unavailable.' }, 503);
    const digest = (value: string) => createHash('sha256').update(value).digest();
    let valid = false;
    if (typeof body.password === 'string' && body.password.length <= 256) {
      if (settings?.passwordHash) {
        const [salt, hash] = settings.passwordHash.split(':');
        valid = timingSafeEqual(scryptSync(body.password, salt, 64), Buffer.from(hash, 'hex'));
      } else valid = timingSafeEqual(digest(body.password), digest(expected));
    }
    if (!valid) return respond({ error: 'Incorrect portal password. Please try again.' }, 401);
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await db.delete(gallerySessions).where(lt(gallerySessions.expiresAt, new Date()));
    await db.insert(gallerySessions).values({ tokenHash: sessionHash(token), expiresAt });
    context.cookies.set({ name: 'gallery_session', value: token, httpOnly: true, secure: new URL(req.url).protocol === 'https:', sameSite: 'Strict', path: '/', maxAge: 30 * 60 });
    return respond({ ok: true });
  } catch {
    return respond({ error: 'Unable to unlock the gallery. Please try again.' }, 503);
  }
};
