import { drizzle } from 'drizzle-orm/netlify-db';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { portalOrders, suiteState } from '../../db/schema.js';

type Rec = Record<string, any>;
export type Profile = { fulfillmentMode: string; address: string; miles: string; meetupSpot: string; vehicle: string };

export const normalizeName = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
export const normalizePhone = (value: unknown) => String(value ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
// Same phone number, and the same name — or the same first and last name, so "Lisa Machell Montgomery" matches "Lisa Montgomery".
export const sameName = (a: string, b: string) => {
  if (!a || !b) return false;
  if (a === b) return true;
  const x = a.split(' '), y = b.split(' ');
  return x.length > 1 && y.length > 1 && x[0] === y[0] && x[x.length - 1] === y[y.length - 1];
};
export const sameCustomer = (c: Rec, name: string, phone: string) =>
  !!name && phone.length >= 7 && normalizePhone(c?.phone) === phone && sameName(normalizeName(c?.name), name);

// Orders never carry a customer's middle name(s): "Lisa Machell Montgomery" -> "Lisa Montgomery".
// Titles ("Sister"), suffixes ("Jr."), multi-part last names ("De La Cruz") and couples ("PJ & Camille") are kept.
const NAME_TITLES = /^(mr|mrs|ms|miss|mx|dr|sister|sis|brother|bro|pastor|rev|reverend|elder|deacon|deaconess|mother|father|aunt|auntie|uncle|coach|minister|evangelist|bishop|prophet|prophetess|first|lady)\.?$/i;
const NAME_SUFFIXES = /^(jr|sr|ii|iii|iv|v|esq|md|phd)\.?,?$/i;
const NAME_PARTICLES = /^(de|del|della|der|den|la|le|las|los|van|von|da|das|dos|du|di|st\.?|saint|bin|ibn|al|el|mac|ter|ten)$/i;
export function withoutMiddleName(name: unknown) {
  const s = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!s || /&|\+|\/|\band\b/i.test(s)) return s;
  let w = s.split(' ');
  const pre: string[] = [], suf: string[] = [];
  while (w.length > 2 && NAME_TITLES.test(w[0])) pre.push(w.shift()!);
  while (w.length > 2 && NAME_SUFFIXES.test(w[w.length - 1])) suf.unshift(w.pop()!);
  if (w.length > 2) {
    let start = w.length - 1;
    while (start > 1 && NAME_PARTICLES.test(w[start - 1])) start--;
    w = [w[0], ...w.slice(start)];
  }
  return [...pre, ...w, ...suf].join(' ');
}

const text = (value: unknown, max = 500) => String(value ?? '').slice(0, max);
const money = (value: unknown) => Math.round(Math.max(0, Math.min(100000, Number(value) || 0)) * 100) / 100;

// Build a clean order record from what the customer's browser sent.
export function cleanOrder(input: Rec) {
  const items = (Array.isArray(input.items) ? input.items : []).slice(0, 100).map((i: Rec) => ({
    productId: text(i?.productId, 100), name: text(i?.name, 200),
    qty: Math.max(1, Math.min(999, Math.floor(Number(i?.qty) || 1))), price: money(i?.price),
  }));
  return {
    id: text(input.id, 40),
    customerName: withoutMiddleName(text(input.customerName, 120)),
    customerPhone: text(input.customerPhone, 40),
    customerEmail: text(input.customerEmail, 200),
    deliveryDate: /^\d{4}-\d{2}-\d{2}$/.test(String(input.deliveryDate)) ? String(input.deliveryDate) : '',
    timeWindow: text(input.timeWindow, 120),
    fulfillmentType: input.fulfillmentType === 'Doorstep Delivery' ? 'Doorstep Delivery' : 'Safe Meetup Spot',
    destination: text(input.destination, 600),
    items,
    addons: (Array.isArray(input.addons) ? input.addons : []).slice(0, 50).map((a: unknown) => text(a, 200)),
    deliveryFee: money(input.deliveryFee),
    total: money(input.total),
    paymentMethod: text(input.paymentMethod, 120),
    paid: false,
    status: 'Pending',
    notes: text(input.notes, 2000),
    ingredientsChecklist: (Array.isArray(input.ingredientsChecklist) ? input.ingredientsChecklist : []).slice(0, 300)
      .map((c: Rec) => ({ item: text(c?.item, 300), checked: false })),
  };
}

export function cleanProfile(input: Rec): Profile {
  return {
    fulfillmentMode: input?.fulfillmentMode === 'Doorstep Delivery' ? 'Doorstep Delivery' : 'Safe Meetup Spot',
    address: text(input?.address, 400), miles: text(input?.miles, 10),
    meetupSpot: text(input?.meetupSpot, 200), vehicle: text(input?.vehicle, 200),
  };
}

// Add a portal order to the shared order list and to the matching customer's history (or a new customer).
export function applyPortalOrder(data: Rec, order: Rec, profile: Profile) {
  data.orders = Array.isArray(data.orders) ? data.orders : [];
  data.customers = Array.isArray(data.customers) ? data.customers : [];
  if (data.orders.some((o: Rec) => o?.id === order.id)) return;
  data.orders.unshift(order);
  const name = normalizeName(order.customerName), phone = normalizePhone(order.customerPhone);
  const entry = {
    orderId: order.id, date: order.deliveryDate,
    itemsSummary: order.items.map((i: Rec) => `${i.name} (x${i.qty})`).join(', '),
    fulfillment: `${order.fulfillmentType} — ${order.destination}`,
    total: order.total, paid: false, paymentMethod: order.paymentMethod, status: 'Pending',
  };
  const existing = data.customers.find((c: Rec) => sameCustomer(c, name, phone));
  if (existing) {
    if (order.customerEmail) existing.email = order.customerEmail;
    if (order.destination) existing.address = order.destination;
    existing.profile = profile;
    existing.history = Array.isArray(existing.history) ? existing.history : [];
    if (!existing.history.some((h: Rec) => h?.orderId === order.id)) existing.history.unshift(entry);
  } else {
    data.customers.unshift({
      id: `cust-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: order.customerName, phone: order.customerPhone, email: order.customerEmail || 'Not provided',
      address: order.destination, notes: order.notes || 'New portal delivery customer', profile, history: [entry],
    });
  }
}

// Fold any waiting portal orders into the shared Suite data. Safe to repeat: already-added orders are skipped.
export async function mergePortalOrders() {
  const db = drizzle();
  for (let attempt = 0; attempt < 3; attempt++) {
    const pending = await db.select().from(portalOrders).where(eq(portalOrders.merged, false)).orderBy(asc(portalOrders.createdAt)).limit(200);
    if (!pending.length) return;
    await db.insert(suiteState).values({ id: 1 }).onConflictDoNothing();
    const [row] = await db.select().from(suiteState).where(eq(suiteState.id, 1));
    const data = structuredClone((row?.data || {}) as Rec);
    for (const p of pending) applyPortalOrder(data, p.order as Rec, p.profile as Profile);
    const [saved] = await db.update(suiteState).set({ data, revision: sql`${suiteState.revision} + 1` })
      .where(and(eq(suiteState.id, 1), eq(suiteState.revision, row?.revision ?? 0))).returning({ revision: suiteState.revision });
    if (!saved) continue;
    await db.update(portalOrders).set({ merged: true }).where(inArray(portalOrders.id, pending.map(p => p.id)));
    if (pending.length < 200) return;
  }
}
