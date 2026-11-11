import { drizzle } from 'drizzle-orm/netlify-db';
import { desc, eq } from 'drizzle-orm';
import { portalOrders, suiteState } from '../../db/schema.js';
import { cleanOrder, cleanProfile, normalizeName, normalizePhone, sameCustomer, type Profile } from '../lib/portal-orders.js';

type Rec = Record<string, any>;
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

// Recover delivery details from a saved customer address such as "123 Main St (6–8 Miles — ...)".
function profileFromAddress(address: string) {
  const match = address.match(/^(.*) \(((?:Within )?\d+.*Miles?\b.*)\)$/);
  return { fulfillmentMode: '', address: match ? match[1] : address, miles: '', milesLabel: match ? match[2] : '', meetupSpot: '', vehicle: '' };
}

export default async (req: Request) => {
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  try {
    const raw = await req.text();
    if (raw.length > 100_000) return reply({ error: 'Request too large.' }, 413);
    const body = JSON.parse(raw) as Rec;
    const db = drizzle();

    if (body.action === 'lookup') {
      const name = normalizeName(body.name), phone = normalizePhone(body.phone);
      if (!name || phone.length < 7) return reply({ found: false });
      const [row] = await db.select({ data: suiteState.data }).from(suiteState).where(eq(suiteState.id, 1));
      const customers = ((row?.data as Rec)?.customers || []) as Rec[];
      const customer = Array.isArray(customers) ? customers.find(c => sameCustomer(c, name, phone)) : undefined;
      // Orders not yet merged into the Suite may be newer than the saved customer record.
      const recent = await db.select().from(portalOrders).where(eq(portalOrders.merged, false)).orderBy(desc(portalOrders.createdAt)).limit(200);
      const pending = recent.find(p => sameCustomer({ name: (p.order as Rec).customerName, phone: (p.order as Rec).customerPhone }, name, phone));
      if (!customer && !pending) return reply({ found: false });
      const pendingOrder = pending?.order as Rec | undefined;
      const email = pendingOrder?.customerEmail || (customer?.email && customer.email !== 'Not provided' ? customer.email : '');
      const profile = (pending?.profile as Profile) || customer?.profile || profileFromAddress(String(customer?.address || ''));
      return reply({ found: true, name: customer?.name || pendingOrder?.customerName, email: String(email || '').replace(/\s*\(.*\)$/, ''), profile });
    }

    if (body.action === 'order') {
      const order = cleanOrder(body.order || {});
      if (!/^ORD-[\w-]{4,30}$/.test(order.id) || !order.customerName.trim() || normalizePhone(order.customerPhone).length < 7 || !order.items.length || !order.deliveryDate) {
        return reply({ error: 'Invalid order.' }, 400);
      }
      await db.insert(portalOrders).values({ id: order.id, order, profile: cleanProfile(body.profile) }).onConflictDoNothing();
      return reply({ saved: true });
    }
    return reply({ error: 'Unknown request.' }, 400);
  } catch (e) {
    console.error(e);
    return reply({ error: 'Unable to reach MomaBear right now.' }, 503);
  }
};
