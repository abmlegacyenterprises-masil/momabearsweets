import { drizzle } from 'drizzle-orm/netlify-db';
import { and, eq, sql } from 'drizzle-orm';
import { verifyRequestOrigin } from '@netlify/identity';
import { suiteState } from '../../db/schema.js';
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
      return reply({
        revision: saved.revision,
        customersCount: Array.isArray(merged.customers) ? merged.customers.length : 0,
        ordersCount: Array.isArray(merged.orders) ? merged.orders.length : 0
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
