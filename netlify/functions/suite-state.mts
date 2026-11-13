import { drizzle } from 'drizzle-orm/netlify-db';
import { and, eq, sql } from 'drizzle-orm';
import { verifyRequestOrigin } from '@netlify/identity';
import { getStore } from '@netlify/blobs';
import {galleryPhotos,  suiteState } from '../../db/schema.js';
import { hasGallerySession } from '../lib/gallery-session.js';
import { mergePortalOrders } from '../lib/portal-orders.js';
const keys = ['products', 'addons', 'fuelConfig', 'lockoutDates', 'inventory', 'customers', 'orders', 'idleMinutes', 'hiddenItems', 'deletedItemsStack', 'menuLabels'];
const publicKeys = ['products', 'addons', 'fuelConfig', 'lockoutDates', 'menuLabels'];
export default async (req: Request) => {
  const reply = (data: unknown, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'no-store'}});
  try {
    const db = drizzle();
    const admin = await hasGallerySession(req);
    if (req.method === 'GET') {
      // Bring Customer Portal orders into the Suite's orders and customer histories when MomaBear loads her data.
      if (admin) await mergePortalOrders().catch(() => {});
      const [row] = await db.select().from(suiteState).where(eq(suiteState.id, 1));
      const data = (row?.data || {}) as Record<string, unknown>;
      return reply({revision: row?.revision || 0, data: Object.fromEntries((admin ? keys : publicKeys).filter(k => k in data).map(k => [k, data[k]]))});
    }
    if (req.method === 'POST') {
      verifyRequestOrigin(req);
      if (!admin) return reply({error: 'Unlock the Suite again to import backup data.'}, 401);
      const body = await req.json().catch(() => ({}));
      const backupHost = 'momabearsweets-backup.netlify.app';
      const backupOrigin = `https://${backupHost}`;
      let cookie = '';
      if (typeof body?.password === 'string' && body.password) {
        const authRes = await fetch(`${backupOrigin}/.netlify/functions/gallery-auth`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json', 'Origin': backupOrigin},
          body: JSON.stringify({password: body.password})
        });
        if (!authRes.ok) return reply({error: 'Incorrect backup Suite password. Please try again.'}, 401);
        const setCookie = authRes.headers.get('set-cookie') || '';
        const match = setCookie.match(/gallery_session=[^;]+/);
        if (match) cookie = match[0];
      }
      const upstream = await fetch(`${backupOrigin}/.netlify/functions/suite-state`, {
        headers: {'Cache-Control': 'no-store', ...(cookie ? {'Cookie': cookie} : {})}
      });
      if (!upstream.ok) return reply({error: 'Unable to reach backup site.'}, 502);
      const backup = await upstream.json();
      if (!backup?.data || typeof backup.data !== 'object') return reply({error: 'Invalid backup data.'}, 502);
      const imported = Object.fromEntries(keys.filter(k => k in backup.data).map(k => [k, backup.data[k]]));
      await db.insert(suiteState).values({id: 1}).onConflictDoNothing();
      const [current] = await db.select().from(suiteState).where(eq(suiteState.id, 1));
      const merged = {...((current?.data as Record<string, unknown>) || {}), ...imported};
      const [saved] = await db.update(suiteState).set({data: merged, revision: sql`${suiteState.revision} + 1`}).where(eq(suiteState.id, 1)).returning({revision: suiteState.revision});
      if (!saved) return reply({error: 'Unable to save imported backup.'}, 503);
      let galleryCount = 0;
const galRes = await fetch(`${backupOrigin}/.netlify/functions/sweets-gallery${cookie ? '?owner=1' : ''}`, {
headers: {'Cache-Control': 'no-store', ...(cookie ? {'Cookie': cookie} : {})}
});
if (galRes.ok) {
const galJson = await galRes.json().catch(() => null);
const backupPhotos = Array.isArray(galJson?.photos) ? galJson.photos : [];
if (backupPhotos.length > 0) {
const store = getStore('sweets-gallery-images');
const existing = await db.select().from(galleryPhotos);
const newRows: Array<{id: string; title: string; caption: string; published: boolean; position: number; imageKey: string; contentType: string}> = [];
for (let i = 0; i < backupPhotos.length; i += 6) {
const batch = backupPhotos.slice(i, i + 6);
const fetched = await Promise.all(batch.map(async (p: {id: string; title: string; caption?: string; published?: boolean; position?: number}, idx: number) => {
const imgRes = await fetch(`${backupOrigin}/.netlify/functions/sweets-gallery?id=${encodeURIComponent(p.id)}`, {
headers: cookie ? {'Cookie': cookie} : {},
redirect: 'follow'
});
if (!imgRes.ok) return null;
const contentType = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
const bytes = await imgRes.arrayBuffer();
const imageKey = crypto.randomUUID();
await store.set(imageKey, bytes);
return {
id: p.id,
title: String(p.title || 'Sweets Photo').slice(0, 120),
caption: String(p.caption || '').slice(0, 1200),
published: p.published !== false,
position: Number.isInteger(p.position) ? Number(p.position) : i + idx,
imageKey,
contentType
};
}));
for (const row of fetched) if (row) newRows.push(row);
}
if (newRows.length > 0) {
await db.delete(galleryPhotos);
await db.insert(galleryPhotos).values(newRows);
for (const old of existing) {
if (!old.imageKey.startsWith('/assets/menu/')) await store.delete(old.imageKey).catch(() => {});
}
galleryCount = newRows.length;
}
}
}
return reply({
        revision: saved.revision,
        customersCount: Array.isArray(merged.customers) ? merged.customers.length : 0,
        ordersCount: Array.isArray(merged.orders) ? merged.orders.length : 0,
galleryCount
      });
    }
    if (req.method !== 'PUT') return reply({error: 'Method not allowed'}, 405);
    verifyRequestOrigin(req);
    if (!admin) return reply({error: 'Unlock the Suite again to save your changes.'}, 401);
    const body = await req.json();
    if (!body.data || !Number.isInteger(body.revision)) return reply({error: 'Invalid save request.'}, 400);
    const data = Object.fromEntries(keys.filter(k => k in body.data).map(k => [k, body.data[k]]));
    // Menu button names: a small map of category -> display name. Older pages may not send it.
    const labels = body.data.menuLabels;
    if (labels !== undefined && (!labels || typeof labels !== 'object' || Array.isArray(labels))) return reply({error: 'Invalid menu button names.'}, 400);
    let source = labels;
    if (source === undefined) {
      const [current] = await db.select({data: suiteState.data}).from(suiteState).where(eq(suiteState.id, 1));
      const saved = (current?.data as Record<string, unknown> | undefined)?.menuLabels;
      source = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    }
    data.menuLabels = Object.fromEntries(Object.entries(source).slice(0, 50).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [String(k).slice(0, 60), String(v).trim().slice(0, 60)]));
    for (const key of keys.filter(k => !['fuelConfig', 'idleMinutes', 'menuLabels'].includes(k))) {
      if (!Array.isArray(data[key])) return reply({error: 'Invalid records.'}, 400);
    }
    if (!data.fuelConfig || typeof data.fuelConfig !== 'object' || !Number.isInteger(data.idleMinutes) || Number(data.idleMinutes) < 1 || Number(data.idleMinutes) > 15) return reply({error: 'Invalid settings.'}, 400);
    await db.insert(suiteState).values({id: 1}).onConflictDoNothing();
    const [saved] = await db.update(suiteState).set({data, revision: sql`${suiteState.revision} + 1`}).where(and(eq(suiteState.id, 1), eq(suiteState.revision, body.revision))).returning({revision: suiteState.revision});
    if (!saved) return reply({error: 'Another device saved changes. Your edits are still here. Reload shared data before editing again.'}, 409);
    return reply(saved);
  } catch { return reply({error: 'Unable to save online. Keep this page open and retry.'}, 503); }
};
