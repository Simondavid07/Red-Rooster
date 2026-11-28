// Red Rooster — server actions (plain Bun version for Render).
//
// Same behaviour as the original Muse space actions, with the space
// runtime layer replaced by plain functions:
// - Single owner admin account; password stored as a scrypt hash, sessions
//   are HMAC-SHA256 signed tokens (see ./crypto.ts).
// - Login rate-limited: 5 failed attempts in 15 minutes.
// - All inputs zod-validated; all queries parameterized Drizzle.
// - Money is integer paise; order totals and delivery fees are recomputed
//   on the server from DB prices — client-sent totals are never trusted.
// - Payments are UPI-direct to the store's own UPI ID (non-custodial):
//   no card or UPI credentials are collected or stored, ever.
// - Product images are stored as files under DATA_DIR/uploads (see ./db.ts).
//
// Each entry is { request, response, handler } and is exposed by
// server/src/index.ts as POST /api/<name> with a JSON body.

import { z } from "zod";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import * as schema from "./schema";
import { qrSvg } from "./qr";
import { db, saveUpload } from "./db";
import {
  hashPassword,
  randomHex,
  signSession,
  verifyPassword,
  verifySession,
} from "./crypto";

type DB = typeof db;

// ---------------------------------------------------------------- helpers
const okResponse = z.object({ ok: z.literal(true) });

async function getSettings(d: DB): Promise<Record<string, string>> {
  const rows = await d.select().from(schema.settings);
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

function feeForDistance(distanceKm: number, s: Record<string, string>): number {
  const freeKm = Number(s["free_radius_km"] ?? "3") || 0;
  const perKm = Number(s["per_km_paise"] ?? "1000") || 0;
  if (distanceKm <= freeKm) return 0;
  return Math.ceil(distanceKm - freeKm) * perKm;
}

const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

function signToken(passwordHash: string): string {
  return signSession(passwordHash, Date.now() + SESSION_MS);
}

async function requireAdmin(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const acct = await db.select().from(schema.adminAccount).limit(1);
  const account = acct[0];
  if (!account) return false;
  return verifySession(account.passwordHash, token);
}

async function newOrderCode(): Promise<string> {
  const { hex } = randomHex(4);
  return `RR-${hex.slice(0, 5).toUpperCase()}`;
}

const productOut = z.object({
  id: z.number(),
  name: z.string(),
  category: z.string(),
  packLabel: z.string(),
  eggsCount: z.number(),
  pricePaise: z.number(),
  mrpPaise: z.number().nullable(),
  description: z.string(),
  imageUrl: z.string().nullable(),
  stockStatus: z.string(),
  featured: z.boolean(),
  sortOrder: z.number(),
  active: z.boolean(),
});

type ProductRow = typeof schema.products.$inferSelect;

async function toProductOut(row: ProductRow): Promise<z.infer<typeof productOut>> {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    packLabel: row.packLabel,
    eggsCount: row.eggsCount,
    pricePaise: row.pricePaise,
    mrpPaise: row.mrpPaise,
    description: row.description,
    imageUrl: row.imageBlobKey ? `/uploads/${row.imageBlobKey}` : null,
    stockStatus: row.stockStatus,
    featured: row.featured,
    sortOrder: row.sortOrder,
    active: row.active,
  };
}

const storefrontResponse = z.object({
  products: z.array(productOut),
  plans: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      description: z.string(),
      traysPerWeek: z.number(),
      pricePaise: z.number(),
    }),
  ),
  zones: z.array(
    z.object({ id: z.number(), name: z.string(), distanceKm: z.number(), feePaise: z.number() }),
  ),
  settings: z.object({
    freeRadiusKm: z.number(),
    perKmPaise: z.number(),
    minOrderPaise: z.number(),
    upiId: z.string(),
    upiName: z.string(),
    storePhone: z.string(),
    storeWhatsapp: z.string(),
  }),
});

const orderOut = z.object({
  id: z.number(),
  code: z.string(),
  customerName: z.string(),
  phone: z.string(),
  address: z.string(),
  zoneName: z.string(),
  slot: z.string(),
  items: z.array(
    z.object({
      productId: z.number(),
      name: z.string(),
      packLabel: z.string(),
      qty: z.number(),
      unitPricePaise: z.number(),
    }),
  ),
  subtotalPaise: z.number(),
  deliveryFeePaise: z.number(),
  totalPaise: z.number(),
  paymentMethod: z.string(),
  paymentStatus: z.string(),
  upiRef: z.string().nullable(),
  status: z.string(),
  note: z.string(),
  createdAt: z.string(),
});

type OrderRow = typeof schema.orders.$inferSelect;

function toOrderOut(row: OrderRow): z.infer<typeof orderOut> {
  let items: z.infer<typeof orderOut>["items"] = [];
  try {
    const parsed: unknown = JSON.parse(row.itemsJson);
    if (Array.isArray(parsed)) items = parsed as typeof items;
  } catch {
    items = [];
  }
  return {
    id: row.id,
    code: row.code,
    customerName: row.customerName,
    phone: row.phone,
    address: row.address,
    zoneName: row.zoneName,
    slot: row.slot,
    items,
    subtotalPaise: row.subtotalPaise,
    deliveryFeePaise: row.deliveryFeePaise,
    totalPaise: row.totalPaise,
    paymentMethod: row.paymentMethod,
    paymentStatus: row.paymentStatus,
    upiRef: row.upiRef,
    status: row.status,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

const phoneSchema = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number");

// ---------------------------------------------------------------- actions
// One entry per action. `request` is the zod schema the server validates
// the JSON body against in index.ts before calling `handler`, so the
// handler can trust the shape of `args` at runtime.
export type ActionEntry = {
  description: string;
  request: z.ZodTypeAny;
  response: z.ZodTypeAny;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any) => Promise<unknown>;
};

export const Actions: Record<string, ActionEntry> = {
  getStorefront: {
    description: "Returns everything the shop pages need: active products, subscription plans, delivery zones with computed fees, and store settings.",
    request: z.object({}),
    response: storefrontResponse,
    async handler(): Promise<z.infer<typeof storefrontResponse>> {
      const d = db;
      const [productRows, planRows, zoneRows, s] = await Promise.all([
        d
          .select()
          .from(schema.products)
          .where(eq(schema.products.active, true))
          .orderBy(asc(schema.products.sortOrder), desc(schema.products.id)),
        d
          .select()
          .from(schema.plans)
          .where(eq(schema.plans.active, true))
          .orderBy(asc(schema.plans.sortOrder), asc(schema.plans.id)),
        d
          .select()
          .from(schema.zones)
          .where(eq(schema.zones.active, true))
          .orderBy(asc(schema.zones.name)),
        getSettings(d),
      ]);
      const products = await Promise.all(productRows.map((r) => toProductOut(r)));
      return {
        products,
        plans: planRows.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          traysPerWeek: p.traysPerWeek,
          pricePaise: p.pricePaise,
        })),
        zones: zoneRows.map((zn) => ({
          id: zn.id,
          name: zn.name,
          distanceKm: zn.distanceKm,
          feePaise: feeForDistance(zn.distanceKm, s),
        })),
        settings: {
          freeRadiusKm: Number(s["free_radius_km"] ?? "3") || 0,
          perKmPaise: Number(s["per_km_paise"] ?? "1000") || 0,
          minOrderPaise: Number(s["min_order_paise"] ?? "0") || 0,
          upiId: s["upi_id"] ?? "",
          upiName: s["upi_name"] ?? "Red Rooster",
          storePhone: s["store_phone"] ?? "",
          storeWhatsapp: s["store_whatsapp"] ?? "",
        },
      };
    },
  },

  placeOrder: {
    description: "Places a customer order. Prices and the delivery fee are recomputed on the server from the database; returns the order with its tracking code.",
    request: z.object({
      customerName: z.string().trim().min(2).max(80),
      phone: phoneSchema,
      address: z.string().trim().min(8).max(300),
      zoneId: z.number().int().positive(),
      slot: z.string().trim().min(1).max(60),
      items: z
        .array(
          z.object({
            productId: z.number().int().positive(),
            qty: z.number().int().min(1).max(200),
          }),
        )
        .min(1)
        .max(50),
      paymentMethod: z.enum(["upi", "cod"]),
      note: z.string().trim().max(300).default(""),
    }),
    response: z.object({ order: orderOut }),
    async handler(args) {
      const d = db;
      const zoneRows = await d
        .select()
        .from(schema.zones)
        .where(and(eq(schema.zones.id, args.zoneId), eq(schema.zones.active, true)))
        .limit(1);
      const zone = zoneRows[0];
      if (!zone) throw new Error("Delivery area not available. Please pick another area.");

      const lines: z.infer<typeof orderOut>["items"] = [];
      let subtotal = 0;
      for (const item of args.items) {
        const rows = await d
          .select()
          .from(schema.products)
          .where(and(eq(schema.products.id, item.productId), eq(schema.products.active, true)))
          .limit(1);
        const p = rows[0];
        if (!p) throw new Error("One of the items is no longer available.");
        if (p.stockStatus === "out_of_stock") throw new Error(`${p.name} is out of stock right now.`);
        lines.push({
          productId: p.id,
          name: p.name,
          packLabel: p.packLabel,
          qty: item.qty,
          unitPricePaise: p.pricePaise,
        });
        subtotal += p.pricePaise * item.qty;
      }
      const s = await getSettings(d);
      const minOrder = Number(s["min_order_paise"] ?? "0") || 0;
      if (subtotal < minOrder) {
        throw new Error(`Minimum order is ₹${Math.round(minOrder / 100)}. Please add more items.`);
      }
      const fee = feeForDistance(zone.distanceKm, s);
      const total = subtotal + fee;

      // Unique tracking code (retry on the rare collision).
      let code = await newOrderCode();
      for (let attempt = 0; attempt < 5; attempt++) {
        const clash = await d
          .select({ id: schema.orders.id })
          .from(schema.orders)
          .where(eq(schema.orders.code, code))
          .limit(1);
        if (!clash[0]) break;
        code = await newOrderCode();
      }
      const inserted = await d
        .insert(schema.orders)
        .values({
          code,
          customerName: args.customerName,
          phone: args.phone,
          address: args.address,
          zoneId: zone.id,
          zoneName: zone.name,
          slot: args.slot,
          itemsJson: JSON.stringify(lines),
          subtotalPaise: subtotal,
          deliveryFeePaise: fee,
          totalPaise: total,
          paymentMethod: args.paymentMethod,
          paymentStatus: args.paymentMethod === "cod" ? "cod_pending" : "pending",
          note: args.note,
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error("Order could not be placed. Please try again.");
      return { order: toOrderOut(row) };
    },
  },

  getUpiPayment: {
    description: "Returns the UPI payment details (intent link, QR code SVG, payee) for an existing order, verified by order code + phone number.",
    request: z.object({ code: z.string().trim().min(4).max(20), phone: phoneSchema }),
    response: z.object({
      upiId: z.string(),
      upiName: z.string(),
      amountPaise: z.number(),
      upiUrl: z.string(),
      qrSvg: z.string().nullable(),
    }),
    async handler(args) {
      const d = db;
      const rows = await d
        .select()
        .from(schema.orders)
        .where(and(eq(schema.orders.code, args.code.toUpperCase()), eq(schema.orders.phone, args.phone)))
        .limit(1);
      const order = rows[0];
      if (!order) throw new Error("Order not found. Check the code and phone number.");
      const s = await getSettings(d);
      const upiId = (s["upi_id"] ?? "").trim();
      const upiName = (s["upi_name"] ?? "Red Rooster").trim() || "Red Rooster";
      if (!upiId) {
        return { upiId: "", upiName, amountPaise: order.totalPaise, upiUrl: "", qrSvg: null };
      }
      const amount = (order.totalPaise / 100).toFixed(2);
      const upiUrl =
        `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}` +
        `&am=${amount}&cu=INR&tn=${encodeURIComponent(`Red Rooster order ${order.code}`)}`;
      let svg: string | null = null;
      try {
        svg = qrSvg(upiUrl);
      } catch {
        svg = null;
      }
      return { upiId, upiName, amountPaise: order.totalPaise, upiUrl, qrSvg: svg };
    },
  },

  submitUpiRef: {
    description: "Lets a customer attach their UPI transaction reference (UTR) to an order after paying, verified by order code + phone.",
    request: z.object({
      code: z.string().trim().min(4).max(20),
      phone: phoneSchema,
      upiRef: z.string().trim().min(6).max(40),
    }),
    response: okResponse,
    async handler(args): Promise<z.infer<typeof okResponse>> {
      const d = db;
      const rows = await d
        .select()
        .from(schema.orders)
        .where(and(eq(schema.orders.code, args.code.toUpperCase()), eq(schema.orders.phone, args.phone)))
        .limit(1);
      const order = rows[0];
      if (!order) throw new Error("Order not found. Check the code and phone number.");
      await d
        .update(schema.orders)
        .set({ upiRef: args.upiRef })
        .where(eq(schema.orders.id, order.id));
      return { ok: true as const };
    },
  },

  trackOrder: {
    description: "Looks up one order's live status by its tracking code and the phone number used at checkout.",
    request: z.object({ code: z.string().trim().min(4).max(20), phone: phoneSchema }),
    response: z.object({ order: orderOut }),
    async handler(args) {
      const d = db;
      const rows = await d
        .select()
        .from(schema.orders)
        .where(and(eq(schema.orders.code, args.code.toUpperCase()), eq(schema.orders.phone, args.phone)))
        .limit(1);
      const order = rows[0];
      if (!order) throw new Error("Order not found. Check the code and phone number.");
      return { order: toOrderOut(order) };
    },
  },

  submitEnquiry: {
    description: "Saves a bulk-order, subscription or contact enquiry from a customer for the owner to see in the admin panel.",
    request: z.object({
      kind: z.enum(["bulk", "subscription", "contact"]),
      name: z.string().trim().min(2).max(80),
      phone: phoneSchema,
      business: z.string().trim().max(120).default(""),
      planId: z.number().int().positive().nullable().default(null),
      message: z.string().trim().max(1000).default(""),
    }),
    response: okResponse,
    async handler(args): Promise<z.infer<typeof okResponse>> {
      const d = db;
      let planName = "";
      if (args.planId) {
        const rows = await d
          .select()
          .from(schema.plans)
          .where(eq(schema.plans.id, args.planId))
          .limit(1);
        planName = rows[0]?.name ?? "";
      }
      await d.insert(schema.enquiries).values({
        kind: args.kind,
        name: args.name,
        phone: args.phone,
        business: args.business,
        planId: args.planId,
        planName,
        message: args.message,
      });
      return { ok: true as const };
    },
  },

  // ------------------------------------------------------------ admin auth
  adminStatus: {
    description: "Reports whether the owner admin account has been created yet, and whether a given session token is valid.",
    request: z.object({ token: z.string().max(300).optional() }),
    response: z.object({ hasAccount: z.boolean(), authed: z.boolean() }),
    async handler(args) {
      const d = db;
      const acct = await d.select({ id: schema.adminAccount.id }).from(schema.adminAccount).limit(1);
      const hasAccount = !!acct[0];
      const authed = hasAccount ? await requireAdmin(args.token) : false;
      return { hasAccount, authed };
    },
  },

  adminSetup: {
    description: "Creates the owner admin account with the owner's chosen password (only works when no account exists yet).",
    request: z.object({ password: z.string().min(8).max(100) }),
    response: z.object({ token: z.string() }),
    async handler(args) {
      const d = db;
      const acct = await d.select({ id: schema.adminAccount.id }).from(schema.adminAccount).limit(1);
      if (acct[0]) throw new Error("Admin account already exists. Please log in.");
      const passwordHash = await hashPassword(args.password);
      await d.insert(schema.adminAccount).values({ passwordHash });
      return { token: await signToken(passwordHash) };
    },
  },

  adminLogin: {
    description: "Logs the owner in. Rate-limited: repeated failed attempts lock login for a while.",
    request: z.object({ password: z.string().min(1).max(100) }),
    response: z.object({ token: z.string() }),
    async handler(args) {
      const d = db;
      const windowStart = new Date(Date.now() - 15 * 60 * 1000);
      const recent = await d
        .select()
        .from(schema.loginAttempts)
        .where(and(gte(schema.loginAttempts.attemptedAt, windowStart), eq(schema.loginAttempts.success, false)));
      if (recent.length >= 5) {
        throw new Error("Too many wrong attempts. Please wait 15 minutes and try again.");
      }
      const acct = await d.select().from(schema.adminAccount).limit(1);
      const account = acct[0];
      if (!account) throw new Error("No admin account yet. Create one first.");
      const valid = await verifyPassword(args.password, account.passwordHash);
      await d.insert(schema.loginAttempts).values({ success: valid });
      if (!valid) throw new Error("Wrong password.");
      return { token: await signToken(account.passwordHash) };
    },
  },

  adminChangePassword: {
    description: "Changes the owner admin password (requires the current password and a valid session).",
    request: z.object({
      token: z.string().min(1).max(300),
      currentPassword: z.string().min(1).max(100),
      newPassword: z.string().min(8).max(100),
    }),
    response: z.object({ token: z.string() }),
    async handler(args) {
      if (!(await requireAdmin(args.token))) throw new Error("Session expired. Log in again.");
      const d = db;
      const acct = await d.select().from(schema.adminAccount).limit(1);
      const account = acct[0];
      if (!account) throw new Error("No admin account.");
      const valid = await verifyPassword(args.currentPassword, account.passwordHash);
      if (!valid) throw new Error("Current password is wrong.");
      const passwordHash = await hashPassword(args.newPassword);
      await d
        .update(schema.adminAccount)
        .set({ passwordHash })
        .where(eq(schema.adminAccount.id, account.id));
      return { token: await signToken(passwordHash) };
    },
  },

  // ------------------------------------------------------------ admin data
  adminData: {
    description: "Returns the full admin dataset: all products, plans, zones, settings, recent orders and enquiries. Requires a valid admin session.",
    request: z.object({ token: z.string().min(1).max(300) }),
    response: z.object({
      products: z.array(productOut),
      plans: z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          description: z.string(),
          traysPerWeek: z.number(),
          pricePaise: z.number(),
          active: z.boolean(),
        }),
      ),
      zones: z.array(
        z.object({ id: z.number(), name: z.string(), distanceKm: z.number(), active: z.boolean() }),
      ),
      settings: z.record(z.string(), z.string()),
      orders: z.array(orderOut),
      enquiries: z.array(
        z.object({
          id: z.number(),
          kind: z.string(),
          name: z.string(),
          phone: z.string(),
          business: z.string(),
          planName: z.string(),
          message: z.string(),
          handled: z.boolean(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(args) {
      if (!(await requireAdmin(args.token))) throw new Error("Session expired. Log in again.");
      const d = db;
      const [productRows, planRows, zoneRows, s, orderRows, enquiryRows] = await Promise.all([
        d.select().from(schema.products).orderBy(asc(schema.products.sortOrder), desc(schema.products.id)),
        d.select().from(schema.plans).orderBy(asc(schema.plans.sortOrder), asc(schema.plans.id)),
        d.select().from(schema.zones).orderBy(asc(schema.zones.name)),
        getSettings(d),
        d.select().from(schema.orders).orderBy(desc(schema.orders.id)).limit(200),
        d.select().from(schema.enquiries).orderBy(desc(schema.enquiries.id)).limit(200),
      ]);
      const products = await Promise.all(productRows.map((r) => toProductOut(r)));
      return {
        products,
        plans: planRows.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          traysPerWeek: p.traysPerWeek,
          pricePaise: p.pricePaise,
          active: p.active,
        })),
        zones: zoneRows.map((zn) => ({
          id: zn.id,
          name: zn.name,
          distanceKm: zn.distanceKm,
          active: zn.active,
        })),
        settings: s,
        orders: orderRows.map(toOrderOut),
        enquiries: enquiryRows.map((e) => ({
          id: e.id,
          kind: e.kind,
          name: e.name,
          phone: e.phone,
          business: e.business,
          planName: e.planName,
          message: e.message,
          handled: e.handled,
          createdAt: e.createdAt.toISOString(),
        })),
      };
    },
  },

  adminSaveProduct: {
    description: "Creates or updates a product in the owner's catalog (name, pack, price, stock, image and more). Requires admin session.",
    request: z.object({
      token: z.string().min(1).max(300),
      id: z.number().int().positive().nullable().default(null),
      name: z.string().trim().min(2).max(120),
      category: z.string().trim().min(1).max(60).default("Desi Eggs"),
      packLabel: z.string().trim().min(1).max(60),
      eggsCount: z.number().int().min(1).max(10000),
      pricePaise: z.number().int().min(1).max(100000000),
      mrpPaise: z.number().int().min(0).max(100000000).nullable().default(null),
      description: z.string().trim().max(1000).default(""),
      stockStatus: z.enum(["in_stock", "low_stock", "out_of_stock"]),
      featured: z.boolean().default(false),
      sortOrder: z.number().int().min(0).max(9999).default(0),
      active: z.boolean().default(true),
      image: z
        .object({ dataBase64: z.string().min(10), mimeType: z.string() })
        .nullable()
        .default(null),
      removeImage: z.boolean().default(false),
    }),
    response: z.object({ id: z.number() }),
    async handler(args) {
      if (!(await requireAdmin(args.token))) throw new Error("Session expired. Log in again.");
      const d = db;
      let imageBlobKey: string | null | undefined = undefined; // undefined = keep existing
      if (args.removeImage) imageBlobKey = null;
      if (args.image) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(args.image.mimeType)) {
          throw new Error("Image must be JPG, PNG or WebP.");
        }
        const bytes = Buffer.from(args.image.dataBase64, "base64");
        if (bytes.length > 5 * 1024 * 1024) throw new Error("Image is too large (max 5 MB).");
        const ext = args.image.mimeType === "image/png" ? "png" : args.image.mimeType === "image/webp" ? "webp" : "jpg";
        const rand = randomHex(6);
        const key = `products/${Date.now()}-${rand.hex}.${ext}`;
        await saveUpload(key, bytes, args.image.mimeType);
        imageBlobKey = key;
      }
      const values = {
        name: args.name,
        category: args.category,
        packLabel: args.packLabel,
        eggsCount: args.eggsCount,
        pricePaise: args.pricePaise,
        mrpPaise: args.mrpPaise && args.mrpPaise > 0 ? args.mrpPaise : null,
        description: args.description,
        stockStatus: args.stockStatus,
        featured: args.featured,
        sortOrder: args.sortOrder,
        active: args.active,
        ...(imageBlobKey !== undefined ? { imageBlobKey } : {}),
      };
      if (args.id) {
        await d.update(schema.products).set(values).where(eq(schema.products.id, args.id));
          return { id: args.id };
      }
      const inserted = await d
        .insert(schema.products)
        .values({ ...values, imageBlobKey: imageBlobKey ?? null })
        .returning({ id: schema.products.id });
      const row = inserted[0];
      if (!row) throw new Error("Product could not be saved.");
      return { id: row.id };
    },
  },

  adminDeleteProduct: {
    description: "Deletes a product from the catalog. Requires admin session.",
    request: z.object({ token: z.string().min(1).max(300), id: z.number().int().positive() }),
    response: okResponse,
    async handler(args): Promise<z.infer<typeof okResponse>> {
      if (!(await requireAdmin(args.token))) throw new Error("Session expired. Log in again.");
      const d = db;
      await d.delete(schema.products).where(eq(schema.products.id, args.id));
      return { ok: true as const };
    },
  },

  adminSavePlan: {
    description: "Creates or updates a subscription plan. Requires admin session.",
    request: z.object({
      token: z.string().min(1).max(300),
      id: z.number().int().positive().nullable().default(null),
      name: z.string().trim().min(2).max(120),
      description: z.string().trim().max(500).default(""),
      traysPerWeek: z.number().int().min(1).max(50),
      pricePaise: z.number().int().min(1).max(100000000),
      active: z.boolean().default(true),
      sortOrder: z.number().int().min(0).max(9999).default(0),
    }),
    response: z.object({ id: z.number() }),
    async handler(args) {
      if (!(await requireAdmin(args.token))) throw new Error("Session expired. Log in again.");
      const d = db;
      const values = {
        name: args.name,
        description: args.description,
        traysPerWeek: args.traysPerWeek,
        pricePaise: args.pricePaise,
        active: args.active,
        sortOrder: args.sortOrder,
      };
      if (args.id) {
        await d.update(schema.plans).set(values).where(eq(schema.plans.id, args.id));
          return { id: args.id };
      }
      const inserted = await d.insert(schema.plans).values(values).returning({ id: schema.plans.id });
      const row = inserted[0];
      if (!row) throw new Error("Plan could not be saved.");
      return { id: row.id };
    },
  },

  adminDeletePlan: {
    description: "Deletes a subscription plan. Requires admin session.",
    request: z.object({ token: z.string().min(1).max(300), id: z.number().int().positive() }),
    response: okResponse,
    async handler(args): Promise<z.infer<typeof okResponse>> {
      if (!(await requireAdmin(args.token))) throw new Error("Session expired. Log in again.");
      const d = db;
      await d.delete(schema.plans).where(eq(schema.plans.id, args.id));
      return { ok: true as const };
    },
  },

  adminSaveZone: {
    description: "Creates or updates a delivery zone (area name + distance in km, which drives the delivery fee). Requires admin session.",
    request: z.object({
      token: z.string().min(1).max(300),
      id: z.number().int().positive().nullable().default(null),
      name: z.string().trim().min(2).max(80),
      distanceKm: z.number().min(0).max(200),
      active: z.boolean().default(true),
    }),
    response: z.object({ id: z.number() }),
    async handler(args) {
      if (!(await requireAdmin(args.token))) throw new Error("Session expired. Log in again.");
      const d = db;
      const values = { name: args.name, distanceKm: args.distanceKm, active: args.active };
      if (args.id) {
        await d.update(schema.zones).set(values).where(eq(schema.zones.id, args.id));
          return { id: args.id };
      }
      const inserted = await d.insert(schema.zones).values(values).returning({ id: schema.zones.id });
      const row = inserted[0];
      if (!row) throw new Error("Zone could not be saved.");
      return { id: row.id };
    },
  },

  adminDeleteZone: {
    description: "Deletes a delivery zone. Requires admin session.",
    request: z.object({ token: z.string().min(1).max(300), id: z.number().int().positive() }),
    response: okResponse,
    async handler(args): Promise<z.infer<typeof okResponse>> {
      if (!(await requireAdmin(args.token))) throw new Error("Session expired. Log in again.");
      const d = db;
      await d.delete(schema.zones).where(eq(schema.zones.id, args.id));
      return { ok: true as const };
    },
  },

  adminSaveSettings: {
    description: "Updates store settings: delivery pricing (free radius km, per-km charge, minimum order), the store's own UPI ID for payments, and contact numbers. Requires admin session.",
    request: z.object({
      token: z.string().min(1).max(300),
      freeRadiusKm: z.number().min(0).max(100),
      perKmRupees: z.number().min(0).max(10000),
      minOrderRupees: z.number().min(0).max(1000000),
      upiId: z.string().trim().max(80),
      upiName: z.string().trim().max(60),
      storePhone: z.string().trim().max(15),
      storeWhatsapp: z.string().trim().max(15),
    }),
    response: okResponse,
    async handler(args): Promise<z.infer<typeof okResponse>> {
      if (!(await requireAdmin(args.token))) throw new Error("Session expired. Log in again.");
      if (args.upiId && !/^[\w.\-]{2,}@[a-zA-Z]{2,}/.test(args.upiId)) {
        throw new Error("UPI ID looks wrong — it should look like name@bank.");
      }
      const d = db;
      const pairs: [string, string][] = [
        ["free_radius_km", String(args.freeRadiusKm)],
        ["per_km_paise", String(Math.round(args.perKmRupees * 100))],
        ["min_order_paise", String(Math.round(args.minOrderRupees * 100))],
        ["upi_id", args.upiId],
        ["upi_name", args.upiName || "Red Rooster"],
        ["store_phone", args.storePhone],
        ["store_whatsapp", args.storeWhatsapp],
      ];
      for (const [key, value] of pairs) {
        await d
          .insert(schema.settings)
          .values({ key, value })
          .onConflictDoUpdate({ target: schema.settings.key, set: { value } });
      }
      return { ok: true as const };
    },
  },

  adminUpdateOrder: {
    description: "Updates an order's delivery status and/or payment status from the admin panel. Requires admin session.",
    request: z.object({
      token: z.string().min(1).max(300),
      id: z.number().int().positive(),
      status: z.enum(["placed", "confirmed", "out_for_delivery", "delivered", "cancelled"]).optional(),
      paymentStatus: z.enum(["pending", "paid", "cod_pending"]).optional(),
    }),
    response: okResponse,
    async handler(args): Promise<z.infer<typeof okResponse>> {
      if (!(await requireAdmin(args.token))) throw new Error("Session expired. Log in again.");
      const d = db;
      const set: Partial<{ status: OrderRow["status"]; paymentStatus: OrderRow["paymentStatus"] }> = {};
      if (args.status) set.status = args.status;
      if (args.paymentStatus) set.paymentStatus = args.paymentStatus;
      if (Object.keys(set).length > 0) {
        await d.update(schema.orders).set(set).where(eq(schema.orders.id, args.id));
      }
      return { ok: true as const };
    },
  },

  adminMarkEnquiry: {
    description: "Marks an enquiry as handled (or reopens it) in the admin panel. Requires admin session.",
    request: z.object({
      token: z.string().min(1).max(300),
      id: z.number().int().positive(),
      handled: z.boolean(),
    }),
    response: okResponse,
    async handler(args): Promise<z.infer<typeof okResponse>> {
      if (!(await requireAdmin(args.token))) throw new Error("Session expired. Log in again.");
      const d = db;
      await d
        .update(schema.enquiries)
        .set({ handled: args.handled })
        .where(eq(schema.enquiries.id, args.id));
      return { ok: true as const };
    },
  },
};
