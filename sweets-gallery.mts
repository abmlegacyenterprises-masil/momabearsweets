import { drizzle } from 'drizzle-orm/netlify-db';
import { eq, asc, sql } from 'drizzle-orm';
import { getStore } from '@netlify/blobs';
import { verifyRequestOrigin } from '@netlify/identity';
import { hasGallerySession } from '../lib/gallery-session.js';
import { galleryPhotos } from '../../db/schema.js';

export default async (req: Request) => {
  const headers = { 'Cache-Control': 'no-store' };
  const respond = (data: unknown, status = 200) => Response.json(data, { status, headers });
  try {
    const url = new URL(req.url);
    const owner = url.searchParams.get('owner') === '1';
    const writing = req.method !== 'GET';
    if (writing) verifyRequestOrigin(req);
    let admin = false;
    if (owner || writing) {
      admin = await hasGallerySession(req);
      if (!admin) return respond({ error: 'Enter your portal password to unlock Gallery Manager.' }, 403);
    }
    const db = drizzle();
    const store = getStore('sweets-gallery-images');
    const id = url.searchParams.get('id');
    if (id && !/^[0-9a-f-]{36}$/i.test(id)) return respond({ error: 'Invalid photo.' }, 400);
    if (req.method === 'GET') {
      if (id) {
        const [photo] = await db.select().from(galleryPhotos).where(eq(galleryPhotos.id, id));
        if (!photo || (!photo.published && !admin)) return new Response(null, { status: 404 });
        if (photo.imageKey.startsWith('/assets/menu/')) return Response.redirect(new URL(photo.imageKey, req.url), 302);
        const bytes = await store.get(photo.imageKey, { type: 'arrayBuffer' });
        if (!bytes) return new Response(null, { status: 404 });
        return new Response(bytes, { headers: { ...headers, 'Content-Type': photo.contentType, 'X-Content-Type-Options': 'nosniff' } });
      }
      const fields = { id: galleryPhotos.id, title: galleryPhotos.title, caption: galleryPhotos.caption, published: galleryPhotos.published, position: galleryPhotos.position };
      const query = db.select(fields).from(galleryPhotos);
      const photos = await (owner ? query : query.where(eq(galleryPhotos.published, true))).orderBy(asc(galleryPhotos.position), asc(galleryPhotos.id));
      return respond({ photos });
    }
    if (req.method === 'PATCH' && id) {
      const { direction } = await req.json();
      if (direction !== 'left' && direction !== 'right') return respond({ error: 'Choose left or right.' }, 400);
      await db.transaction(async tx => {
        // Serialize reorder operations so simultaneous moves cannot lose changes.
        await tx.execute(sql`LOCK TABLE ${galleryPhotos} IN SHARE ROW EXCLUSIVE MODE`);
        const ordered = await tx.select({ id: galleryPhotos.id }).from(galleryPhotos).orderBy(asc(galleryPhotos.position), asc(galleryPhotos.id));
        const index = ordered.findIndex(photo => photo.id === id);
        if (index < 0) throw new Error('Photo no longer exists.');
        const target = index + (direction === 'left' ? -1 : 1);
        if (target < 0 || target >= ordered.length) return;
        [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
        for (const [position, photo] of ordered.entries()) {
          await tx.update(galleryPhotos).set({ position }).where(eq(galleryPhotos.id, photo.id));
        }
      });
      return respond({ ok: true });
    }
    if (req.method === 'DELETE' && id) {
      const [photo] = await db.delete(galleryPhotos).where(eq(galleryPhotos.id, id)).returning();
      if (!photo) return respond({ error: 'Photo no longer exists.' }, 404);
      if (!photo.imageKey.startsWith('/assets/menu/')) await store.delete(photo.imageKey);
      return respond({ ok: true });
    }
    if (req.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);
    const form = await req.formData();
    const title = String(form.get('title') || '').trim();
    const caption = String(form.get('caption') || '').trim();
    const published = form.get('published') === 'true';
    if (!title || title.length > 120 || caption.length > 1200) return respond({ error: 'Enter a title up to 120 characters and a caption up to 1,200 characters.' }, 400);
    const [existing] = id ? await db.select().from(galleryPhotos).where(eq(galleryPhotos.id, id)) : [];
    if (id && !existing) return respond({ error: 'Photo no longer exists.' }, 404);
    const file = form.get('image');
    let imageKey = existing?.imageKey;
    let contentType = existing?.contentType;
    if (file instanceof File && file.size) {
      if (file.size > 3 * 1024 * 1024) return respond({ error: 'Choose an image smaller than 3 MB.' }, 400);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const type = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
        : bytes[0] === 137 && Buffer.from(bytes.slice(1, 8)).equals(Buffer.from([80,78,71,13,10,26,10])) ? 'image/png'
        : Buffer.from(bytes.slice(0,4)).toString() === 'RIFF' && Buffer.from(bytes.slice(8,12)).toString() === 'WEBP' ? 'image/webp' : null;
      if (!type) return respond({ error: 'Choose a JPEG, PNG, or WebP photo.' }, 400);
      contentType = type;
      imageKey = crypto.randomUUID();
      await store.set(imageKey, bytes.buffer);
    }
    // New menu items can reuse one of the bundled bakery menu photos instead of uploading a copy.
    const assetPath = String(form.get('assetPath') || '');
    const asset = assetPath.match(/^\/assets\/menu\/[A-Za-z0-9_-]+\.(jpe?g|png|webp)$/i);
    if (!imageKey && asset) {
      imageKey = assetPath;
      contentType = asset[1].toLowerCase() === 'png' ? 'image/png' : asset[1].toLowerCase() === 'webp' ? 'image/webp' : 'image/jpeg';
    }
    if (!imageKey || !contentType) return respond({ error: 'Choose a photo to upload.' }, 400);
    try {
      const values = { title, caption, published, imageKey, contentType };
      if (id) await db.update(galleryPhotos).set(values).where(eq(galleryPhotos.id, id));
      else await db.insert(galleryPhotos).values({ ...values, id: crypto.randomUUID(), position: sql`(SELECT COALESCE(MAX(position), -1) + 1 FROM gallery_photos)` });
    } catch (error) {
      if (imageKey !== existing?.imageKey) await store.delete(imageKey);
      throw error;
    }
    if (existing && imageKey !== existing.imageKey && !existing.imageKey.startsWith('/assets/menu/')) await store.delete(existing.imageKey);
    return respond({ ok: true });
  } catch {
    return respond({ error: 'The gallery is temporarily unavailable. Please try again.' }, 503);
  }
};
