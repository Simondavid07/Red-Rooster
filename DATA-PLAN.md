# Data Plan

## Context provenance
- `brown desi eggs hoo g` (prior user statement; the catalog is brown desi eggs only — no white/organic lines invented)
- `product m khud add kruga backend s thik h jaise product name quantity price images and other joo b chize hoti h` (prior user statement; products start EMPTY — the owner adds every product himself from the admin panel with name, pack quantity, price, image and description; no seed/demo products)
- `delivery area kalka or pinjore or aas paas k villages thik h delivery backend update kr skta h thik h oor up to 3 km free uske baad charges lgege` (prior user statement; delivery zones seeded only with the user-named areas Kalka and Pinjore, free delivery up to 3 km, per-km charge after that — all values editable in the admin backend)
- `payment gateway hm hamara khud kaa banyege from github ope source repos` + assistant proposal accepted in the parent conversation: SangamPay-style non-custodial self-hosted checkout — UPI payment goes directly to the store's own UPI ID (QR + intent), the site never holds funds or card data; Cash on Delivery also offered. No licensed-processor card flow is claimed.
- `reference m blinkit jaise rkhege bs colors unique rkhna` + accepted palette from the parent conversation: Deep Rooster Red #A31621, Warm Cream #FFF6E9, Charcoal Brown #2B2118, Yolk Gold #E9B44C (prior user statement + accepted assistant proposal; Blinkit-style commerce layout — search, category chips, product cards with ADD steppers, sticky cart bar — in a classic heritage palette, not Blinkit's yellow-green)
- `security bilkul dhyaan m rkhna` (prior user statement; admin auth and server-side validation are first-class, see below)
- `logo tum hi bnaa doo` (prior user statement; a rooster-comb + egg logo mark is generated at build time into client assets)
- `koi single page nhi hoo gaa many pages ho g` (prior user statement; multi-view app: Home, Shop, Product detail, Subscriptions, About, Quality, Bulk Orders, Recipes, Delivery Info, FAQ, Contact, Cart/Checkout, Track Order, Admin)

## Tested sources
### Image search — brown eggs hero photo
**Used by**: build-time asset copy (client/src/assets) for Home hero and Shop header
**Test command**: `/opt/hatch/bin/image-search "brown eggs in tray farm fresh" --max-results 5`, then `curl -fsSLI -A 'Mozilla/5.0' -H 'Accept: image/*' -H 'Referer: https://example.com/' '<url>'`
**Sample output**: ACCEPTED `https://hoolafarms.org/wp-content/uploads/2021/10/IMG_9483.jpg` — HTTP 200, Content-Type image/jpeg, a carton of brown eggs (source page https://hoolafarms.org/module/intro-to-grow/). ACCEPTED `https://bcegg.com/wp-content/uploads/2021/05/20200626_125556-scaled.jpg` — HTTP 200, image/jpeg, large tray of brown eggs (source page https://bcegg.com/news-posts/inside-a-free-run-egg-farm/)
**Processing**: download bytes at build time into client/src/assets, verify with `gm identify` (>=1536px long edge preferred), import in client; never hotlink
### Image search — free-range hens photo
**Used by**: build-time asset copy for About / Quality pages
**Test command**: `/opt/hatch/bin/image-search "free range hens farm India" --max-results 5` + same curl preflight
**Sample output**: REJECTED `https://aromas-of-india.com/wp-content/uploads/2021/08/hinai-4.jpg` — curl error 52 empty reply on preflight. Fallback candidates from the same result set (kisanindia.in flock photos) will be preflighted at build time; if none passes, the About/Quality pages ship with the accepted egg-tray photography only and no hen photo slot.
**Processing**: same owned-bytes pipeline as above
### Generated logo
**Used by**: header/footer brand mark, favicon-style asset
**Test command**: `media.generate_image` at build time (drawn/painted style rooster-comb + egg mark, deep red and yolk gold on transparent/cream)
**Processing**: saved into client/src/assets and imported; text/wordmark stays in markup, not baked into the image

## Long-term data behavior
- **Refresh policy**: none — all data is owner/customer-entered through the app; no external feed and no scheduled refresh
- **Growth**: products, delivery zones, subscription plans, orders, bulk enquiries and contact messages grow only through admin/customer actions; product images uploaded by the owner are stored as blobs (ctx.blobs) with only the blob key in the DB
- **Ordering**: products by admin-set sort order then newest; orders newest first; zones by name
- **Time semantics**: order timestamps stored as instants, rendered viewer-local; delivery slots are plain local-time labels chosen by the customer
- **Security model**: single-owner admin account created on first admin visit (owner sets the password; stored as a scrypt hash server-side, never in client code). Session = signed HMAC token validated server-side on every admin action; login attempts rate-limited in the DB. All queries parameterized via Drizzle; all action inputs validated with zod; prices and delivery fees are recomputed server-side at order placement (client totals never trusted); payment is UPI-direct to the store's own UPI ID from settings — no card/UPI credentials are ever collected or stored

## Rejected approaches
- **Tried**: seeding starter/demo egg products so the shop looks full on day one
  **Why rejected**: the user explicitly said he will add products himself from the backend; invented products/prices would be fake records in his own store. The shop ships with an honest empty state that points the owner to the admin panel.
- **Tried**: a real card payment gateway integration (Razorpay/Hyperswitch)
  **Why rejected**: per the accepted plan in the parent conversation, v1 is a self-hosted non-custodial UPI checkout (SangamPay pattern) — funds settle directly to the owner's UPI ID; a licensed processor is out of scope and no merchant credentials exist.
- **Tried**: hotlinking searched photos
  **Why rejected**: remote URLs can 403/expire from the published origin; all accepted photos are copied into artifact-owned assets at build time.
