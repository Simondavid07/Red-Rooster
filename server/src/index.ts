// Red Rooster — plain Bun HTTP server (Render version).
//
// Serves:
//   GET  /                     the built React client (client/dist)
//   GET  /api/health           { ok: true }
//   POST /api/<action>         JSON body = action args, validated with zod.
//                              Returns the action result, or
//                              { error: "<message>" } with status 400.
//   GET  /uploads/<key>        product images uploaded from Admin.
//   Any other GET path          SPA fallback to index.html.
//
// Start:  bun run server/src/index.ts   (PORT env var, default 3000)
// Build client first:  bun run build

import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Actions } from "./actions";
import { DB_LABEL, getUpload, migrate } from "./db";

await migrate();

const DIST_DIR = resolve(dirname(new URL(import.meta.url).pathname), "../../client/dist");
const INDEX_HTML = join(DIST_DIR, "index.html");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function mimeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

const PORT = Number(process.env.PORT || 3000);

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    const path = decodeURIComponent(url.pathname);

    // ---- health ---------------------------------------------------------
    if (path === "/api/health" && req.method === "GET") {
      return json({ ok: true });
    }

    // ---- API ------------------------------------------------------------
    if (path.startsWith("/api/") && req.method === "POST") {
      const name = path.slice("/api/".length);
      const action = (Actions as Record<string, { request: { parse: (v: unknown) => unknown }; handler: (a: never) => Promise<unknown> }>)[name];
      if (!action) return json({ error: `Unknown action: ${name}` }, 404);
      let body: unknown = {};
      try {
        body = req.headers.get("content-type")?.includes("application/json")
          ? await req.json()
          : {};
      } catch {
        return json({ error: "Request body must be valid JSON." }, 400);
      }
      try {
        const args = action.request.parse(body) as never;
        const result = await action.handler(args);
        return json(result);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Something went wrong. Please try again.";
        return json({ error: message }, 400);
      }
    }

    // ---- uploaded product images ----------------------------------------
    // In Turso mode these come from the `blobs` table in the hosted
    // database; in local file mode they come from DATA_DIR/uploads.
    if (path.startsWith("/uploads/") && req.method === "GET") {
      const upload = await getUpload(path.slice("/uploads/".length));
      if (!upload) return new Response("Not found", { status: 404 });
      return new Response(upload.data, {
        headers: { "Content-Type": upload.mimeType },
      });
    }

    // ---- static client + SPA fallback ------------------------------------
    if (req.method === "GET") {
      const filePath = join(DIST_DIR, path === "/" ? "index.html" : path);
      const safe = resolve(filePath);
      if (safe.startsWith(DIST_DIR) && existsSync(safe) && statSync(safe).isFile()) {
        return new Response(Bun.file(safe), { headers: { "Content-Type": mimeFor(safe) } });
      }
      if (existsSync(INDEX_HTML)) {
        return new Response(Bun.file(INDEX_HTML), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      return new Response("Client not built yet. Run `bun run build` first.", { status: 500 });
    }

    return new Response("Method not allowed", { status: 405 });
  },
});

console.log(`Red Rooster listening on http://localhost:${server.port}`);
console.log(`Database: ${DB_LABEL}`);
