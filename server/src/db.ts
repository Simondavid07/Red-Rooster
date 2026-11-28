// Red Rooster database — hosted (Turso/libSQL) on Render, local file for dev.
//
// - Render (production): set TURSO_DATABASE_URL (libsql://...) and
//   TURSO_AUTH_TOKEN. All tables — products, plans, zones, settings,
//   orders, enquiries, admin_account, login_attempts and blobs (product
//   images) — live in the hosted Turso database, so they survive restarts
//   and redeploys. Render's free tier has an ephemeral filesystem, so
//   nothing that must survive may live on local disk there. If the app
//   runs on Render without TURSO_DATABASE_URL it refuses to start, rather
//   than silently using a throwaway local database.
// - Local dev only: if TURSO_DATABASE_URL is not set, the same libSQL
//   driver opens a local file database at DATA_DIR/app.db (default
//   ./data/app.db). This is a dev fallback only — never the Render default.
//   (A `file:` URL in TURSO_DATABASE_URL also works and exercises the
//   exact Turso code path — blobs in the DB — against a local file.)
// - Product images: in Turso mode they are stored as rows in the `blobs`
//   table (base64, max 5 MB per image, same limit the Admin panel
//   enforces), so they survive restarts too. In local file mode they stay
//   as files under DATA_DIR/uploads (the old behaviour).
// - Migrations: drizzle/0002_red_rooster_store_tables.sql runs once, on
//   first boot when the products table does not exist yet. It seeds only
//   what the owner specified: delivery zones Kalka (2 km) and Pinjore
//   (1 km), free delivery up to 3 km, ₹10/km after that, and empty
//   UPI/phone settings. Products are NOT seeded — the owner adds them
//   from the Admin panel.

import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as schema from "./schema";

export const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), "data");
export const DB_PATH = process.env.DB_PATH || join(DATA_DIR, "app.db");
export const UPLOADS_DIR = join(DATA_DIR, "uploads");

const TURSO_URL = (process.env.TURSO_DATABASE_URL || "").trim();
const TURSO_TOKEN = (process.env.TURSO_AUTH_TOKEN || "").trim();
const IS_FILE_URL = TURSO_URL.startsWith("file:");

if (TURSO_URL && !IS_FILE_URL && !TURSO_TOKEN) {
  throw new Error(
    "TURSO_DATABASE_URL is set but TURSO_AUTH_TOKEN is missing. " +
      "Create a token for the database (turso db tokens create <name>) and set both env vars.",
  );
}

// On Render the filesystem is ephemeral: a local database would be wiped
// on every restart/redeploy. Refuse to start instead of losing data silently.
if (process.env.RENDER === "true" && !TURSO_URL) {
  throw new Error(
    "TURSO_DATABASE_URL is not set. On Render, the database must be Turso — " +
      "create a free Turso database and set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN. " +
      "See README.md (Deploy on Render).",
  );
}

export const DB_MODE: "turso" | "file" = TURSO_URL ? "turso" : "file";

mkdirSync(DATA_DIR, { recursive: true });
if (DB_MODE === "file") mkdirSync(UPLOADS_DIR, { recursive: true });

const client: Client =
  DB_MODE === "turso"
    ? createClient({ url: TURSO_URL, authToken: TURSO_TOKEN || undefined })
    : createClient({ url: `file:${DB_PATH}` });

export const db: LibSQLDatabase<typeof schema> = drizzle(client, { schema });
export type DB = typeof db;

/** Short, safe label for startup logs — never includes the auth token. */
export const DB_LABEL =
  DB_MODE === "turso"
    ? IS_FILE_URL
      ? `Turso-compatible (local file ${TURSO_URL.slice("file:".length)})`
      : `Turso (${TURSO_URL.replace(/^libsql:\/\//, "").split("/")[0]})`
    : `local file ${DB_PATH}`;

const BLOBS_TABLE_SQL =
  "CREATE TABLE IF NOT EXISTS blobs (" +
  "key TEXT PRIMARY KEY, " +
  "data_base64 TEXT NOT NULL, " +
  "mime_type TEXT NOT NULL, " +
  "created_at INTEGER NOT NULL)";

export async function migrate(): Promise<void> {
  const check = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'products'",
  );
  if (check.rows.length > 0) {
    // Databases created before the blobs table existed still need it
    // (it holds product images in Turso mode).
    await client.execute(BLOBS_TABLE_SQL);
    return;
  }
  const migrationPath = resolve(
    dirname(new URL(import.meta.url).pathname),
    "../../drizzle/0002_red_rooster_store_tables.sql",
  );
  const sql = readFileSync(migrationPath, "utf8");
  for (const chunk of sql.split("--> statement-breakpoint")) {
    const stmt = chunk.trim();
    if (stmt) await client.execute(stmt);
  }
  await client.execute(BLOBS_TABLE_SQL);
}

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/** Store an uploaded product image. In Turso mode it goes into the `blobs`
 *  table (so it survives restarts); in local file mode it stays a file. */
export async function saveUpload(key: string, bytes: Uint8Array, mimeType = "image/jpeg"): Promise<void> {
  if (DB_MODE === "turso") {
    const dataBase64 = Buffer.from(bytes).toString("base64");
    await db
      .insert(schema.blobs)
      .values({ key, dataBase64, mimeType, createdAt: new Date() })
      .onConflictDoUpdate({
        target: schema.blobs.key,
        set: { dataBase64, mimeType },
      });
    return;
  }
  const target = join(UPLOADS_DIR, key);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
}

export interface Upload {
  data: Uint8Array;
  mimeType: string;
}

/** Fetch an uploaded product image by key, from the DB (Turso mode) or
 *  from disk (local file mode). Returns null when the key is unknown. */
export async function getUpload(key: string): Promise<Upload | null> {
  if (DB_MODE === "turso") {
    const rows = await db
      .select()
      .from(schema.blobs)
      .where(eq(schema.blobs.key, key))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { data: Buffer.from(row.dataBase64, "base64"), mimeType: row.mimeType };
  }
  const target = resolve(UPLOADS_DIR, key);
  if (!target.startsWith(resolve(UPLOADS_DIR))) return null; // path traversal guard
  if (!existsSync(target)) return null;
  const ext = target.slice(target.lastIndexOf(".")).toLowerCase();
  return {
    data: new Uint8Array(readFileSync(target)),
    mimeType: MIME_BY_EXT[ext] ?? "application/octet-stream",
  };
}
