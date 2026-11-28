DROP TABLE IF EXISTS entries;
--> statement-breakpoint
CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Desi Eggs',
  pack_label TEXT NOT NULL,
  eggs_count INTEGER NOT NULL DEFAULT 30,
  price_paise INTEGER NOT NULL,
  mrp_paise INTEGER,
  description TEXT NOT NULL DEFAULT '',
  image_blob_key TEXT,
  stock_status TEXT NOT NULL DEFAULT 'in_stock',
  featured INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  trays_per_week INTEGER NOT NULL DEFAULT 1,
  price_paise INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  distance_km REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  zone_id INTEGER,
  zone_name TEXT NOT NULL,
  slot TEXT NOT NULL,
  items_json TEXT NOT NULL,
  subtotal_paise INTEGER NOT NULL,
  delivery_fee_paise INTEGER NOT NULL,
  total_paise INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  upi_ref TEXT,
  status TEXT NOT NULL DEFAULT 'placed',
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE enquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  business TEXT NOT NULL DEFAULT '',
  plan_id INTEGER,
  plan_name TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  handled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE admin_account (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempted_at INTEGER NOT NULL,
  success INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
INSERT INTO zones (name, distance_km, active, created_at) VALUES ('Kalka', 2, 1, 0);
--> statement-breakpoint
INSERT INTO zones (name, distance_km, active, created_at) VALUES ('Pinjore', 1, 1, 0);
--> statement-breakpoint
INSERT INTO settings (key, value) VALUES ('free_radius_km', '3');
--> statement-breakpoint
INSERT INTO settings (key, value) VALUES ('per_km_paise', '1000');
--> statement-breakpoint
INSERT INTO settings (key, value) VALUES ('min_order_paise', '0');
--> statement-breakpoint
INSERT INTO settings (key, value) VALUES ('upi_id', '');
--> statement-breakpoint
INSERT INTO settings (key, value) VALUES ('upi_name', 'Red Rooster');
--> statement-breakpoint
INSERT INTO settings (key, value) VALUES ('store_phone', '');
--> statement-breakpoint
INSERT INTO settings (key, value) VALUES ('store_whatsapp', '');
