// Red Rooster store schema.
//
// Products, plans, zones and orders are all owner/customer-entered at
// runtime — nothing here is seeded with invented catalog data. The only
// seeded rows (see the migration) are the delivery zones the owner named
// (Kalka, Pinjore) and the delivery/pricing settings he specified
// (free delivery up to 3 km, per-km charge after that), all editable
// from the admin panel.

import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const products = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  category: text("category").notNull().default("Desi Eggs"),
  packLabel: text("pack_label").notNull(), // e.g. "Tray of 30"
  eggsCount: integer("eggs_count").notNull().default(30),
  pricePaise: integer("price_paise").notNull(),
  mrpPaise: integer("mrp_paise"), // optional strike-through price
  description: text("description").notNull().default(""),
  imageBlobKey: text("image_blob_key"),
  stockStatus: text("stock_status", {
    enum: ["in_stock", "low_stock", "out_of_stock"],
  })
    .notNull()
    .default("in_stock"),
  featured: integer("featured", { mode: "boolean" }).notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const plans = sqliteTable("plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  traysPerWeek: integer("trays_per_week").notNull().default(1),
  pricePaise: integer("price_paise").notNull(), // per month
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const zones = sqliteTable("zones", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  distanceKm: real("distance_km").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const orders = sqliteTable("orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(), // public tracking code, e.g. RR-8F3K2
  customerName: text("customer_name").notNull(),
  phone: text("phone").notNull(),
  address: text("address").notNull(),
  zoneId: integer("zone_id"),
  zoneName: text("zone_name").notNull(),
  slot: text("slot").notNull(),
  itemsJson: text("items_json").notNull(), // [{productId,name,packLabel,qty,unitPricePaise}]
  subtotalPaise: integer("subtotal_paise").notNull(),
  deliveryFeePaise: integer("delivery_fee_paise").notNull(),
  totalPaise: integer("total_paise").notNull(),
  paymentMethod: text("payment_method", { enum: ["upi", "cod"] }).notNull(),
  paymentStatus: text("payment_status", {
    enum: ["pending", "paid", "cod_pending"],
  })
    .notNull()
    .default("pending"),
  upiRef: text("upi_ref"), // UPI transaction / UTR reference typed by customer
  status: text("status", {
    enum: ["placed", "confirmed", "out_for_delivery", "delivered", "cancelled"],
  })
    .notNull()
    .default("placed"),
  note: text("note").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const enquiries = sqliteTable("enquiries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["bulk", "subscription", "contact"] }).notNull(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  business: text("business").notNull().default(""),
  planId: integer("plan_id"),
  planName: text("plan_name").notNull().default(""),
  message: text("message").notNull().default(""),
  handled: integer("handled", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const adminAccount = sqliteTable("admin_account", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  passwordHash: text("password_hash").notNull(), // scrypt "salt:hash" hex
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const loginAttempts = sqliteTable("login_attempts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  attemptedAt: integer("attempted_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  success: integer("success", { mode: "boolean" }).notNull().default(false),
});

// Uploaded product images. In Turso mode the image bytes live here
// (base64) so they survive restarts and redeploys on Render's free tier;
// in local file mode images stay as files under DATA_DIR/uploads and
// this table is unused.
export const blobs = sqliteTable("blobs", {
  key: text("key").primaryKey(), // e.g. "products/1730000000000-abcdef.jpg"
  dataBase64: text("data_base64").notNull(),
  mimeType: text("mime_type").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
