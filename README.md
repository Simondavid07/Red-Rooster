# Red Rooster — Render version (free tier)

Brown desi egg-selling store for Kalka & Pinjore (Blinkit-style, multi-page).
Adapted from the original Muse space so it runs on plain Bun with no
space runtime: the server is a single Bun HTTP server (`server/src/index.ts`)
serving the built React client and the same store actions as `POST /api/<name>`.

Colors: Deep Rooster Red #A31621, Warm Cream #FFF6E9, Charcoal Brown #2B2118,
Yolk Gold #E9B44C.

## What's inside

- `client/` — React 19 + Tailwind frontend (Home, Shop, Product, Subscription,
  About, Quality, Bulk B2B, Recipes, Delivery Info, FAQ, Contact, Cart/Checkout,
  Track Order, Owner Admin). Built by `client/build.mjs` (Tailwind CLI + Bun.build).
- `server/` — Bun server: `index.ts` (static + API routes), `actions.ts`
  (storefront, placeOrder, getUpiPayment, trackOrder, admin auth/data/settings),
  `crypto.ts` (scrypt passwords, HMAC sessions), `db.ts` (Turso/libSQL
  database + local file fallback, migrations, product-image blobs),
  `qr.ts` (UPI QR generator), `schema.ts` (Drizzle schema).
- `drizzle/` — SQLite migrations. On first boot the store tables are created
  (in Turso, or in the local file DB for local dev) and seeded with **only**
  what the owner specified: delivery zones Kalka (2 km) and Pinjore (1 km),
  free delivery up to 3 km, ₹10/km after that, and empty UPI/phone settings.
- `render.yaml` — free Render web service definition, with the Turso
  env vars the service needs (see Deploy below).

## What's NOT inside (by design)

- **No products, no prices, no UPI ID.** The catalog starts EMPTY — the owner
  adds every product from the Admin panel (name, pack, price, photo,
  description), and sets his own UPI ID in Admin → Settings. Nothing is
  invented or seeded.
- `data/` — only used in **local dev** (see "Run locally"): the local
  SQLite file (`data/app.db`) and uploaded product images (`data/uploads/`)
  when no Turso env vars are set. On Render, data lives in Turso instead —
  `data/` is never used there. Both are git-ignored; never commit a live
  `app.db` (it holds the admin password hash and orders).
- `node_modules/` — run `bun install` to restore.

## Payments & delivery

- Checkout: UPI QR + "pay in UPI app" to the store's own UPI ID (set in
  Admin → Settings) + Cash on Delivery. No card/UPI data is stored.
- Delivery: Kalka + Pinjore + nearby villages; free up to 3 km, ₹10/km
  beyond (editable in Admin).
- Security: scrypt admin password, HMAC-signed sessions (7 days),
  rate-limited login (5 failed attempts / 15 min), server-recomputed
  prices/fees — client-sent totals are never trusted.

## Run locally

```bash
bun install
bun run build        # builds client/dist (Tailwind + React bundle)
bun run start        # serves on http://localhost:3000
```

By default (no Turso env vars) it uses a local file database at
`./data/app.db` and stores uploaded images under `./data/uploads/` —
this is the **local dev fallback only**.

To test the exact Turso code path locally, point it at a local file
through the Turso variable instead:

```bash
TURSO_DATABASE_URL="file:./data/app.db" bun run start
```

Or point it at a real Turso database (same vars as Render uses):

```bash
TURSO_DATABASE_URL="libsql://red-rooster-<you>.turso.io" \
TURSO_AUTH_TOKEN="<token>" \
bun run start
```

Check it: `curl http://localhost:3000/api/health` → `{"ok":true}`.
First visit: open the site → Admin → create the owner password → add
products and your UPI ID in Settings.

## Deploy on Render (free tier) — data now SAVES

> Do this from the GitHub repo. The owner must create the repo first
> (an empty public repo named `red-rooster`), then push this folder's
> contents to it — the GitHub App cannot create repos.

### Step 1 — Create the free Turso database (5 minutes)

Turso is a hosted SQLite-compatible database (libSQL). Its free tier is
far bigger than this store will ever need — about 9 GB storage and
500M rows read / 25M rows written per month (check
turso.tech/pricing when you sign up, in case the limits change).

**With the Turso CLI** (exact commands):

```bash
turso auth signup            # or: turso auth login (GitHub login works)
turso db create red-rooster --location bom   # bom = Mumbai, closest to Kalka
turso db show red-rooster    # copy the Database URL: libsql://red-rooster-<you>.turso.io
turso db tokens create red-rooster   # copy the token — it is shown once
```

**Or in the browser:** turso.tech → Sign in → Create Database → name
`red-rooster`, location Mumbai (bom) → open the database and copy its
Database URL, then create an auth token for that database (the CLI
command above is the reliable way to make the token).

Keep the URL and token safe — the token is a password for the database.
Never commit them, never paste them in chat, and never put them in the
GitHub repo.

### Step 2 — Push the code

From a local clone (the Muse GitHub connector's snapshot push cannot
carry the binary images in `client/src/assets/` — push with `git` so
the photos and logo travel too):

```bash
git init && git add . && git commit -m "Red Rooster store (Render version)"
git remote add origin https://github.com/Simondavid07/red-rooster.git
git push -u origin main
```

Binary files that must be in the repo: `client/src/assets/eggs-carton.jpg`,
`client/src/assets/eggs-tray.jpg`, `client/src/assets/hens.jpg`,
`client/src/assets/logo.webp` (plus `icon.webp` at the repo root).

### Step 3 — Create the Render service

1. **Render → New → Web Service → Build and deploy from a Git repository**
   → pick `Simondavid07/red-rooster`.
   Or use the Blueprint: **New → Blueprint →** pick the same repo — Render
   reads `render.yaml` and fills in everything below automatically.
2. **Settings** (already in `render.yaml`, check them):
   - Runtime: Node (Bun is installed by the build command — Render has no
     native Bun runtime)
   - Build command:
     `curl -fsSL https://bun.sh/install | bash && export PATH="$HOME/.bun/bin:$PATH" && bun install && bun run build`
   - Start command:
     `export PATH="$HOME/.bun/bin:$PATH" && bun run start`
   - Plan: **Free**
   - Environment variables: `NODE_ENV=production`, plus the two Turso
     variables from Step 1:
     - `TURSO_DATABASE_URL` = the `libsql://...` URL
     - `TURSO_AUTH_TOKEN` = the token (add it as a **Secret** in Render)
     (Render sets `PORT` automatically; the server listens on it.)
3. **Deploy.** First deploy takes a few minutes (Bun install + client
   build). On first boot the server creates the tables in Turso and seeds
   only the zones/settings the owner specified. Render gives the site a
   URL like `https://red-rooster.onrender.com`.
   Open it → Admin → create the owner password → add products + UPI ID.

### What persists now (vs before)

| Data | Before (file SQLite) | Now (Turso) |
|---|---|---|
| Products, plans, zones, settings | Lost on restart/redeploy | Saved in Turso — survives restarts and redeploys |
| Orders, enquiries | Lost on restart/redeploy | Saved in Turso |
| Admin account + login attempts | Lost on restart/redeploy | Saved in Turso |
| Product photos (Admin uploads) | Lost on restart/redeploy | Saved in Turso (`blobs` table) |
| Built site files | Rebuilt on every deploy | Rebuilt on every deploy (unchanged) |

### Free-tier limits that still apply

- **Render free service sleeps** after ~15 minutes of inactivity, so the
  first visit after a pause takes ~30–60 seconds to wake up. Data is
  unaffected — only the wake-up is slow. (A paid instance stays awake.)
- **Turso free tier** is about 9 GB storage — product photos are stored
  in the database at up to 5 MB each, so even hundreds of photos fit.
  If the store ever outgrows it, Turso's paid plans start small.
- **If the Turso env vars are missing on Render, the server refuses to
  start** with a clear error instead of silently using a throwaway local
  database. If you see that error, re-check the two env vars in the
  Render dashboard (a wrong token gives an auth error in the deploy logs).
- Redeploys are safe now: the first-boot migration only creates tables
  when they do not exist yet, so pushing new code never wipes the shop.
  (Old installs that already ran the file-SQLite version start empty in
  Turso — products/orders from the old throwaway database do not carry
  over; re-add products once in Admin after the first Turso deploy.)

## API (for reference)

- `POST /api/getStorefront` `{}` — products, plans, zones + fees, settings
- `POST /api/placeOrder` — customerName, phone, address, zoneId, slot,
  items[{productId, qty}], paymentMethod (`upi`|`cod`), note
- `POST /api/getUpiPayment` `{code, phone}` — UPI intent URL + QR SVG
- `POST /api/submitUpiRef` `{code, phone, upiRef}` — attach UPI/UTR ref
- `POST /api/trackOrder` `{code, phone}`
- `POST /api/submitEnquiry` — bulk / subscription / contact
- `POST /api/adminStatus|adminSetup|adminLogin|adminChangePassword`
- `POST /api/adminData|adminSaveProduct|adminDeleteProduct|adminSavePlan|`
  `adminDeletePlan|adminSaveZone|adminDeleteZone|adminSaveSettings|`
  `adminUpdateOrder|adminMarkEnquiry` — all require a valid admin `token`
