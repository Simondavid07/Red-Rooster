// Red Rooster — brown desi egg store for Kalka, Pinjore & nearby villages.
// Multi-page app (client-side routed views): Home, Shop, Product detail,
// Subscriptions, About, Quality, Bulk Orders, Recipes, Delivery Info, FAQ,
// Contact, Cart/Checkout, Track Order, and the owner Admin panel.
//
// Catalog data comes entirely from the server: the owner adds products,
// plans, zones and prices from the Admin panel. Nothing is hard-coded.

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fileToBase64, type ApiResponse } from "./api";
import logoUrl from "./assets/logo.webp";
import heroEggsUrl from "./assets/eggs-carton.jpg";
import trayEggsUrl from "./assets/eggs-tray.jpg";
import hensUrl from "./assets/hens.jpg";

// ------------------------------------------------------------------ types
type Storefront = ApiResponse<typeof api, "getStorefront">;
type Product = Storefront["products"][number];
type Plan = Storefront["plans"][number];
type Order = ApiResponse<typeof api, "trackOrder">["order"];
type AdminData = ApiResponse<typeof api, "adminData">;

type Route =
  | { name: "home" }
  | { name: "shop" }
  | { name: "product"; id: number }
  | { name: "subscriptions" }
  | { name: "about" }
  | { name: "quality" }
  | { name: "bulk" }
  | { name: "recipes" }
  | { name: "delivery" }
  | { name: "faq" }
  | { name: "contact" }
  | { name: "cart" }
  | { name: "track" }
  | { name: "admin" };

type CartMap = Record<number, number>;

const SLOTS = [
  "Morning · 7–10 AM",
  "Midday · 11 AM–2 PM",
  "Evening · 4–7 PM",
];

function inr(paise: number): string {
  const v = paise / 100;
  return `₹${Number.isInteger(v) ? v.toLocaleString("en-IN") : v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function loadCart(): CartMap {
  try {
    const raw = localStorage.getItem("rr-cart");
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as CartMap;
  } catch {
    /* ignore */
  }
  return {};
}

const STATUS_LABEL: Record<string, string> = {
  placed: "Order placed",
  confirmed: "Confirmed",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};
const STATUS_STEPS = ["placed", "confirmed", "out_for_delivery", "delivered"];

// ------------------------------------------------------------------ atoms
function StockBadge({ status }: { status: string }) {
  if (status === "out_of_stock")
    return <span className="rounded-full bg-[#a31621] px-2 py-0.5 text-xs font-semibold text-white">Out of stock</span>;
  if (status === "low_stock")
    return <span className="rounded-full bg-[#e9b44c] px-2 py-0.5 text-xs font-semibold text-[#2b2118]">Only a few left</span>;
  return <span className="rounded-full bg-[#e6f2e6] px-2 py-0.5 text-xs font-semibold text-[#2e7d32]">In stock</span>;
}

function QtyStepper({
  qty,
  onChange,
  label,
}: {
  qty: number;
  onChange: (q: number) => void;
  label: string;
}) {
  if (qty === 0) {
    return (
      <button
        type="button"
        aria-label={`Add ${label} to cart`}
        onClick={() => onChange(1)}
        className="min-h-10 rounded-lg bg-[var(--accent)] px-5 text-sm font-bold tracking-wide text-white shadow-sm transition active:scale-95"
      >
        ADD +
      </button>
    );
  }
  return (
    <div className="flex items-center overflow-hidden rounded-lg bg-[var(--accent)] text-white shadow-sm">
      <button
        type="button"
        aria-label={`Remove one ${label}`}
        onClick={() => onChange(qty - 1)}
        className="flex h-10 w-10 items-center justify-center text-lg font-bold"
      >
        −
      </button>
      <span className="min-w-6 text-center text-sm font-bold" aria-label={`Quantity ${qty}`}>
        {qty}
      </span>
      <button
        type="button"
        aria-label={`Add one more ${label}`}
        onClick={() => onChange(qty + 1)}
        className="flex h-10 w-10 items-center justify-center text-lg font-bold"
      >
        +
      </button>
    </div>
  );
}

function ProductCard({
  product,
  qty,
  onQty,
  onOpen,
}: {
  product: Product;
  qty: number;
  onQty: (id: number, q: number) => void;
  onOpen: (id: number) => void;
}) {
  const out = product.stockStatus === "out_of_stock";
  const discount =
    product.mrpPaise && product.mrpPaise > product.pricePaise
      ? Math.round((1 - product.pricePaise / product.mrpPaise) * 100)
      : 0;
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_1px_3px_rgba(43,33,24,0.07)]">
      <button type="button" onClick={() => onOpen(product.id)} className="relative block text-left" aria-label={`View ${product.name}`}>
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="aspect-[4/3] w-full object-cover" loading="lazy" />
        ) : (
          <img src={trayEggsUrl} alt={product.name} className="aspect-[4/3] w-full object-cover" loading="lazy" />
        )}
        {discount > 0 && (
          <span className="absolute left-2 top-2 rounded-md bg-[var(--gold)] px-2 py-0.5 text-xs font-bold text-[#2b2118]">
            {discount}% OFF
          </span>
        )}
      </button>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <button type="button" onClick={() => onOpen(product.id)} className="text-left font-semibold leading-snug">
            {product.name}
          </button>
          <StockBadge status={product.stockStatus} />
        </div>
        <p className="text-sm text-[var(--dim)]">
          {product.packLabel} · {product.eggsCount} eggs
        </p>
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div>
            <p className="text-lg font-bold leading-none">{inr(product.pricePaise)}</p>
            {product.mrpPaise && product.mrpPaise > product.pricePaise && (
              <p className="mt-1 text-sm text-[var(--dim)] line-through">{inr(product.mrpPaise)}</p>
            )}
            <p className="mt-1 text-xs text-[var(--dim)]">{inr(Math.round(product.pricePaise / Math.max(1, product.eggsCount)))} / egg</p>
          </div>
          {!out && <QtyStepper qty={qty} onChange={(q) => onQty(product.id, q)} label={product.name} />}
          {out && (
            <span className="rounded-lg bg-[var(--surface-alt)] px-3 py-2 text-sm font-semibold text-[var(--dim)]">Sold out</span>
          )}
        </div>
      </div>
    </article>
  );
}

function SectionTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="mb-4">
      <h2 className="font-display text-2xl font-bold text-[var(--text)]">{children}</h2>
      {sub && <p className="mt-1 text-sm text-[var(--dim)]">{sub}</p>}
    </div>
  );
}

function EmptyCatalog({ goAdmin }: { goAdmin: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-5 py-10 text-center">
      <img src={logoUrl} alt="" className="mx-auto h-20 w-20 rounded-full object-cover" />
      <h3 className="font-display mt-4 text-xl font-bold">Fresh trays are being packed</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--dim)]">
        The shop is open, but no products have been added yet. If you are the owner, add your first
        egg tray from the admin panel — name, pack size, price and photo.
      </p>
      <button
        type="button"
        onClick={goAdmin}
        className="mt-5 min-h-11 rounded-xl bg-[var(--accent)] px-5 text-sm font-bold text-white"
      >
        Owner? Add products in Admin
      </button>
    </div>
  );
}

function EnquiryForm({
  kind,
  plans,
  businessLabel,
}: {
  kind: "bulk" | "subscription" | "contact";
  plans?: Plan[];
  businessLabel?: string;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [business, setBusiness] = useState("");
  const [planId, setPlanId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const mutation = useMutation({
    mutationFn: () =>
      api.submitEnquiry({
        kind,
        name,
        phone,
        business,
        planId,
        message,
      }),
    onSuccess: () => setDone(true),
    onError: (e) => setError(e instanceof Error ? e.message : "Something went wrong. Try again."),
  });
  if (done) {
    return (
      <div className="rounded-2xl border border-[#cfe3cf] bg-[#f0f7f0] px-5 py-8 text-center">
        <p className="text-3xl" aria-hidden>✓</p>
        <h3 className="font-display mt-2 text-xl font-bold">Request received</h3>
        <p className="mt-1 text-sm text-[var(--dim)]">Dhanyavaad! The Red Rooster team will call you back on {phone} shortly.</p>
      </div>
    );
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (name.trim().length < 2) return setError("Please enter your name.");
    if (!/^[6-9]\d{9}$/.test(phone.trim())) return setError("Enter a valid 10-digit mobile number.");
    mutation.mutate();
  };
  const inputCls =
    "w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-base outline-none focus:border-[var(--accent)]";
  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <div>
        <label htmlFor={`eq-name-${kind}`} className="mb-1 block text-sm font-semibold">Your name</label>
        <input id={`eq-name-${kind}`} className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ramesh Kumar" autoComplete="name" />
      </div>
      <div>
        <label htmlFor={`eq-phone-${kind}`} className="mb-1 block text-sm font-semibold">Mobile number</label>
        <input id={`eq-phone-${kind}`} className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" inputMode="numeric" autoComplete="tel" />
      </div>
      {businessLabel && (
        <div>
          <label htmlFor={`eq-biz-${kind}`} className="mb-1 block text-sm font-semibold">{businessLabel}</label>
          <input id={`eq-biz-${kind}`} className={inputCls} value={business} onChange={(e) => setBusiness(e.target.value)} placeholder="e.g. Sharma Dhaba, Kalka" />
        </div>
      )}
      {plans && plans.length > 0 && (
        <div>
          <label htmlFor={`eq-plan-${kind}`} className="mb-1 block text-sm font-semibold">Choose a plan</label>
          <select id={`eq-plan-${kind}`} className={inputCls} value={planId ?? ""} onChange={(e) => setPlanId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Just enquiring…</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — {inr(p.pricePaise)}/month</option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label htmlFor={`eq-msg-${kind}`} className="mb-1 block text-sm font-semibold">Message</label>
        <textarea id={`eq-msg-${kind}`} className={inputCls} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Anything we should know?" />
      </div>
      {error && <p className="rounded-lg bg-[#fbe9ea] px-3 py-2 text-sm font-medium text-[var(--accent-dark)]">{error}</p>}
      <button type="submit" disabled={mutation.isPending} className="min-h-12 w-full rounded-xl bg-[var(--accent)] text-base font-bold text-white disabled:opacity-60">
        {mutation.isPending ? "Sending…" : "Send request"}
      </button>
    </form>
  );
}

// ------------------------------------------------------------------ pages
function HomePage({
  data,
  cart,
  setQty,
  go,
}: {
  data: Storefront;
  cart: CartMap;
  setQty: (id: number, q: number) => void;
  go: (r: Route) => void;
}) {
  const featured = data.products.filter((p) => p.featured);
  const shown = (featured.length > 0 ? featured : data.products).slice(0, 6);
  const { settings, zones } = data;
  return (
    <div className="space-y-10">
      {/* Hero */}
      <section className="overflow-hidden rounded-3xl bg-[var(--accent)] text-white shadow-md">
        <div className="grid md:grid-cols-2">
          <div className="flex flex-col justify-center gap-4 p-6 sm:p-10">
            <span className="w-fit rounded-full bg-[var(--gold)] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#2b2118]">
              100% Brown Desi Eggs
            </span>
            <h1 className="font-display text-4xl font-extrabold leading-tight sm:text-5xl">
              Subah ka anda,<br />seedha farm se.
            </h1>
            <p className="max-w-md text-base text-[#f6d9db]">
              Farm-fresh brown desi eggs delivered across Kalka, Pinjore and nearby villages.
              Free delivery within {settings.freeRadiusKm} km — no middlemen, no cold storage.
            </p>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => go({ name: "shop" })} className="min-h-12 rounded-xl bg-white px-6 text-base font-bold text-[var(--accent)] shadow">
                Order eggs now
              </button>
              <button type="button" onClick={() => go({ name: "subscriptions" })} className="min-h-12 rounded-xl border-2 border-white/70 px-6 text-base font-bold text-white">
                Weekly plans
              </button>
            </div>
            <p className="text-sm text-[#f6d9db]">
              {zones.length > 0 ? `Delivering to ${zones.map((z) => z.name).join(", ")} & nearby villages` : "Delivery areas opening soon"}
            </p>
          </div>
          <div className="relative min-h-56">
            <img src={heroEggsUrl} alt="A fresh tray of brown desi eggs" className="absolute inset-0 h-full w-full object-cover" />
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { t: "Farm Fresh", d: "Collected daily, never stored for weeks" },
          { t: `Free delivery ≤ ${settings.freeRadiusKm} km`, d: `Then just ${inr(settings.perKmPaise)}/km` },
          { t: "Crack-free promise", d: "Broken egg in your tray? We replace it free" },
          { t: "Pay your way", d: "UPI direct to our account, or cash on delivery" },
        ].map((f) => (
          <div key={f.t} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="font-display text-base font-bold text-[var(--accent)]">{f.t}</p>
            <p className="mt-1 text-sm text-[var(--dim)]">{f.d}</p>
          </div>
        ))}
      </section>

      {/* Products */}
      <section>
        <div className="flex items-end justify-between gap-3">
          <SectionTitle sub="Brown desi eggs, packed in trays">Today&apos;s fresh trays</SectionTitle>
          {data.products.length > 0 && (
            <button type="button" onClick={() => go({ name: "shop" })} className="mb-4 shrink-0 text-sm font-bold text-[var(--accent)]">
              View all →
            </button>
          )}
        </div>
        {data.products.length === 0 ? (
          <EmptyCatalog goAdmin={() => go({ name: "admin" })} />
        ) : (
          <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3">
            {shown.map((p) => (
              <ProductCard key={p.id} product={p} qty={cart[p.id] ?? 0} onQty={setQty} onOpen={(id) => go({ name: "product", id })} />
            ))}
          </div>
        )}
      </section>

      {/* How it works */}
      <section>
        <SectionTitle>How ordering works</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { n: "1", t: "Pick your tray", d: "Choose your pack and add it to the cart — takes less than a minute." },
            { n: "2", t: "Pay UPI or cash", d: "Pay instantly to our own UPI ID with any app, or choose cash on delivery." },
            { n: "3", t: "Eggs at your door", d: "We deliver in your chosen slot. Track your order any time with your code." },
          ].map((s) => (
            <div key={s.n} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <span className="font-display flex h-10 w-10 items-center justify-center rounded-full bg-[var(--gold)] text-lg font-extrabold text-[#2b2118]">{s.n}</span>
              <p className="mt-3 font-semibold">{s.t}</p>
              <p className="mt-1 text-sm text-[var(--dim)]">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Subscription teaser */}
      <section className="grid items-center gap-6 overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] md:grid-cols-2">
        <img src={hensUrl} alt="Free-range hens at the farm" className="h-56 w-full object-cover md:h-full" loading="lazy" />
        <div className="p-6 sm:p-8">
          <h2 className="font-display text-2xl font-bold">Never run out of eggs again</h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
            Our hens roam free and eat natural feed — that is what makes the yolk deep orange and the
            taste unmistakably desi. Join a weekly plan and fresh trays reach your door on schedule,
            at plan prices.
          </p>
          <button type="button" onClick={() => go({ name: "subscriptions" })} className="mt-4 min-h-11 rounded-xl bg-[var(--accent)] px-5 text-sm font-bold text-white">
            See subscription plans
          </button>
        </div>
      </section>
    </div>
  );
}

function ShopPage({
  data,
  cart,
  setQty,
  go,
}: {
  data: Storefront;
  cart: CartMap;
  setQty: (id: number, q: number) => void;
  go: (r: Route) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [sort, setSort] = useState("popular");
  const categories = useMemo(
    () => ["All", ...Array.from(new Set(data.products.map((p) => p.category)))],
    [data.products],
  );
  const filtered = useMemo(() => {
    let list = data.products.filter(
      (p) =>
        (category === "All" || p.category === category) &&
        (query.trim() === "" ||
          `${p.name} ${p.packLabel} ${p.category}`.toLowerCase().includes(query.trim().toLowerCase())),
    );
    if (sort === "price-low") list = [...list].sort((a, b) => a.pricePaise - b.pricePaise);
    if (sort === "price-high") list = [...list].sort((a, b) => b.pricePaise - a.pricePaise);
    if (sort === "eggs") list = [...list].sort((a, b) => b.eggsCount - a.eggsCount);
    return list;
  }, [data.products, category, query, sort]);

  return (
    <div>
      <div className="mb-5 overflow-hidden rounded-3xl">
        <div className="relative">
          <img src={trayEggsUrl} alt="Trays of brown desi eggs ready for delivery" className="h-40 w-full object-cover sm:h-52" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#2b2118]/80 to-transparent" />
          <div className="absolute bottom-0 p-5">
            <h1 className="font-display text-3xl font-extrabold text-white">Shop desi eggs</h1>
            <p className="text-sm text-[#f3e7d3]">Brown desi eggs only — farm fresh, tray packed.</p>
          </div>
        </div>
      </div>

      <div className="sticky top-[104px] z-20 -mx-4 bg-[var(--bg)] px-4 py-2 sm:top-[108px]">
        <label htmlFor="shop-search" className="sr-only">Search eggs</label>
        <input
          id="shop-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search trays, packs…"
          className="w-full rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-base shadow-sm outline-none focus:border-[var(--accent)]"
        />
        <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-1">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${
                category === c ? "bg-[var(--accent)] text-white" : "border border-[var(--border)] bg-[var(--surface)]"
              }`}
            >
              {c}
            </button>
          ))}
          <label htmlFor="shop-sort" className="sr-only">Sort products</label>
          <select
            id="shop-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="ml-auto shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold"
          >
            <option value="popular">Popular</option>
            <option value="price-low">Price: low to high</option>
            <option value="price-high">Price: high to low</option>
            <option value="eggs">Most eggs</option>
          </select>
        </div>
      </div>

      {data.products.length === 0 ? (
        <EmptyCatalog goAdmin={() => go({ name: "admin" })} />
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-10 text-center text-sm text-[var(--dim)]">
          No trays match your search. Try a different name or category.
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((p) => (
            <ProductCard key={p.id} product={p} qty={cart[p.id] ?? 0} onQty={setQty} onOpen={(id) => go({ name: "product", id })} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProductPage({
  data,
  id,
  cart,
  setQty,
  go,
}: {
  data: Storefront;
  id: number;
  cart: CartMap;
  setQty: (id: number, q: number) => void;
  go: (r: Route) => void;
}) {
  const product = data.products.find((p) => p.id === id);
  if (!product) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-10 text-center">
        <h1 className="font-display text-xl font-bold">This product is not available</h1>
        <p className="mt-2 text-sm text-[var(--dim)]">It may have been removed or sold out for the season.</p>
        <button type="button" onClick={() => go({ name: "shop" })} className="mt-5 min-h-11 rounded-xl bg-[var(--accent)] px-5 text-sm font-bold text-white">
          Back to shop
        </button>
      </div>
    );
  }
  const related = data.products.filter((p) => p.id !== id && p.category === product.category).slice(0, 3);
  const qty = cart[product.id] ?? 0;
  return (
    <div className="space-y-8">
      <button type="button" onClick={() => go({ name: "shop" })} className="text-sm font-bold text-[var(--accent)]">← Back to shop</button>
      <div className="grid gap-6 md:grid-cols-2">
        <img
          src={product.imageUrl ?? trayEggsUrl}
          alt={product.name}
          className="aspect-square w-full rounded-3xl border border-[var(--border)] object-cover"
        />
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-[var(--surface-alt)] px-3 py-1 text-xs font-bold uppercase tracking-wide">{product.category}</span>
            <StockBadge status={product.stockStatus} />
          </div>
          <h1 className="font-display mt-3 text-3xl font-extrabold leading-tight">{product.name}</h1>
          <p className="mt-1 text-base text-[var(--dim)]">{product.packLabel} · {product.eggsCount} brown desi eggs</p>
          <div className="mt-4 flex items-end gap-3">
            <p className="text-3xl font-extrabold">{inr(product.pricePaise)}</p>
            {product.mrpPaise && product.mrpPaise > product.pricePaise && (
              <>
                <p className="pb-1 text-lg text-[var(--dim)] line-through">{inr(product.mrpPaise)}</p>
                <span className="mb-1 rounded-md bg-[var(--gold)] px-2 py-0.5 text-sm font-bold">
                  Save {inr(product.mrpPaise - product.pricePaise)}
                </span>
              </>
            )}
          </div>
          <p className="mt-1 text-sm text-[var(--dim)]">That is {inr(Math.round(product.pricePaise / Math.max(1, product.eggsCount)))} per egg.</p>
          {product.description && <p className="mt-4 leading-relaxed text-[var(--text)]">{product.description}</p>}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {product.stockStatus !== "out_of_stock" ? (
              <QtyStepper qty={qty} onChange={(q) => setQty(product.id, q)} label={product.name} />
            ) : (
              <span className="rounded-lg bg-[var(--surface-alt)] px-4 py-2.5 font-semibold text-[var(--dim)]">Out of stock right now</span>
            )}
            {qty > 0 && (
              <button type="button" onClick={() => go({ name: "cart" })} className="min-h-11 rounded-xl bg-[var(--gold)] px-5 text-sm font-bold text-[#2b2118]">
                Go to cart →
              </button>
            )}
          </div>
          <ul className="mt-6 space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
            <li>✓ Free delivery within {data.settings.freeRadiusKm} km — Kalka, Pinjore & nearby villages</li>
            <li>✓ Cracked egg? Free replacement with your next order</li>
            <li>✓ Pay by UPI on delivery confirmation, or cash on delivery</li>
          </ul>
        </div>
      </div>
      {related.length > 0 && (
        <section>
          <SectionTitle>You may also like</SectionTitle>
          <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} qty={cart[p.id] ?? 0} onQty={setQty} onOpen={(pid) => go({ name: "product", id: pid })} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SubscriptionsPage({ data }: { data: Storefront }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-extrabold">Weekly egg plans</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--dim)]">
          One less thing to remember. Pick a plan, and fresh brown desi trays reach your home every
          week on your delivery day. Pause or stop any time with one call — no lock-in, no advance
          beyond the month.
        </p>
      </div>
      {data.plans.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-5 py-10 text-center">
          <h2 className="font-display text-xl font-bold">Plans are being set up</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--dim)]">
            Subscription plans have not been published yet. Send us an enquiry and we will set up a
            weekly delivery for you personally.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.plans.map((p) => (
            <article key={p.id} className="flex flex-col rounded-3xl border-2 border-[var(--gold)] bg-[var(--surface)] p-5 shadow-sm">
              <h2 className="font-display text-xl font-bold">{p.name}</h2>
              <p className="mt-1 text-sm text-[var(--dim)]">{p.traysPerWeek} tray{p.traysPerWeek > 1 ? "s" : ""} every week</p>
              <p className="mt-3 text-3xl font-extrabold">{inr(p.pricePaise)}<span className="text-base font-semibold text-[var(--dim)]"> /month</span></p>
              {p.description && <p className="mt-2 flex-1 text-sm leading-relaxed">{p.description}</p>}
            </article>
          ))}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        <div className="space-y-3 text-sm leading-relaxed">
          <h2 className="font-display text-xl font-bold">How plans work</h2>
          <p>1. Send the enquiry with your plan and address area.</p>
          <p>2. We call you to fix your weekly delivery day and slot.</p>
          <p>3. Pay monthly by UPI or cash — skip a week any time by informing us a day ahead, and that week is adjusted in the next month.</p>
        </div>
        <EnquiryForm kind="subscription" plans={data.plans} />
      </div>
    </div>
  );
}

function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="font-display text-3xl font-extrabold">Our story</h1>
      <img src={hensUrl} alt="Free-range hens roaming at the Red Rooster farm" className="aspect-[16/9] w-full rounded-3xl border border-[var(--border)] object-cover" />
      <div className="space-y-4 leading-relaxed">
        <p>
          Red Rooster started with a simple frustration: the &ldquo;desi eggs&rdquo; in city shops were
          neither desi nor fresh. Weeks old, trucked in from faraway commercial farms, with pale yolks
          that tasted of nothing.
        </p>
        <p>
          So we went back to how it was always done in our villages around Kalka and Pinjore. Our hens
          are country (desi) breeds that roam outdoors, scratch the earth, and eat a natural diet of
          grains, greens and kitchen-farm produce — no growth hormones, no artificial yolk colour.
        </p>
        <p>
          The result is an egg the way it should be: a firm white, a deep orange yolk that stands tall,
          and a taste that reminds you of the eggs from your grandmother&apos;s courtyard. We collect
          every morning, pack trays the same day, and deliver within a short radius so nothing sits in
          storage.
        </p>
        <p>
          We are a small local startup, and every order supports farming families in the Kalka–Pinjore
          belt. Dhanyavaad for buying local.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3 text-center">
        {[
          { n: "100%", l: "Brown desi eggs" },
          { n: "Same day", l: "Collection & packing" },
          { n: "0", l: "Middlemen" },
        ].map((s) => (
          <div key={s.l} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="font-display text-xl font-extrabold text-[var(--accent)]">{s.n}</p>
            <p className="mt-1 text-xs text-[var(--dim)]">{s.l}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function QualityPage() {
  const steps = [
    { t: "Morning collection", d: "Eggs are collected by hand every morning from clean nesting areas, so nothing sits overnight in the coop." },
    { t: "Candle & crack check", d: "Every egg is checked against light for cracks and quality. Anything doubtful never enters a tray — no exceptions." },
    { t: "Grading by size", d: "Eggs are graded so your tray is uniform — no tiny eggs hiding at the bottom of the pack." },
    { t: "Same-day tray packing", d: "Trays are packed the same day in clean pulp trays that let the eggs breathe and travel safely." },
    { t: "Short-radius delivery", d: "We deliver only around Kalka–Pinjore, so eggs reach you within hours — never after days in a warehouse." },
    { t: "Crack-free promise", d: "If you find a cracked egg in your tray, tell us and we replace it free with your next order." },
  ];
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="font-display text-3xl font-extrabold">From our farm to your kitchen</h1>
      <img src={trayEggsUrl} alt="Graded brown desi eggs packed in trays" className="aspect-[16/9] w-full rounded-3xl border border-[var(--border)] object-cover" />
      <p className="leading-relaxed text-[var(--dim)]">
        Freshness is not a slogan for us — it is a process. Here is exactly what happens to your eggs
        before they reach your door.
      </p>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.t} className="flex gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <span className="font-display flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] font-bold text-white">{i + 1}</span>
            <div>
              <p className="font-semibold">{s.t}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-[var(--dim)]">{s.d}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function BulkPage() {
  return (
    <div className="space-y-6">
      <div className="max-w-2xl">
        <h1 className="font-display text-3xl font-extrabold">Bulk orders for businesses</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
          Dhabas, restaurants, bakeries, hostels, sweet shops and caterers across Kalka–Pinjore trust
          farm eggs for taste their customers notice. We supply daily or alternate-day trays at bulk
          rates, with one monthly bill.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { t: "Bulk pricing", d: "Special per-tray rates for regular business orders — tell us your daily need." },
          { t: "Fixed delivery", d: "Morning delivery before your kitchen opens, on your chosen days." },
          { t: "Monthly billing", d: "One simple monthly bill with UPI or bank payment. No daily cash hassle." },
        ].map((f) => (
          <div key={f.t} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="font-display font-bold text-[var(--accent)]">{f.t}</p>
            <p className="mt-1 text-sm text-[var(--dim)]">{f.d}</p>
          </div>
        ))}
      </div>
      <div className="max-w-xl">
        <EnquiryForm kind="bulk" businessLabel="Business name & type" />
      </div>
    </div>
  );
}

const RECIPES = [
  {
    name: "Desi Anda Bhurji",
    time: "15 min",
    serves: "2 people",
    ingredients: ["4 brown desi eggs", "1 onion, finely chopped", "1 tomato, chopped", "2 green chillies", "½ tsp haldi", "½ tsp red chilli powder", "Fresh coriander", "1 tbsp desi ghee or oil", "Salt to taste"],
    steps: [
      "Heat ghee in a kadhai and fry the onion till golden at the edges.",
      "Add tomato, chillies, haldi and chilli powder. Cook till the masala leaves oil.",
      "Beat the eggs with salt and pour in. Keep stirring on medium flame.",
      "Cook till just set — soft, not dry. Finish with coriander and serve with roti or pav.",
    ],
  },
  {
    name: "Classic Egg Curry (Anda Curry)",
    time: "35 min",
    serves: "4 people",
    ingredients: ["6 brown desi eggs, boiled", "2 onions, ground to paste", "2 tomatoes, pureed", "1 tbsp ginger-garlic paste", "1 tsp garam masala", "½ tsp haldi", "1 tsp dhania powder", "2 tbsp oil", "Salt to taste"],
    steps: [
      "Boil the eggs 10 minutes, cool, peel. Shallow-fry till lightly golden and keep aside.",
      "In the same oil, fry onion paste till deep golden. Add ginger-garlic paste.",
      "Add tomato puree and all dry spices. Cook till oil separates.",
      "Add a cup of hot water, simmer 5 minutes, slide in the eggs and simmer 5 more. Rest 10 minutes before serving.",
    ],
  },
  {
    name: "Masala Omelette — Dhaba Style",
    time: "10 min",
    serves: "1 person",
    ingredients: ["2 brown desi eggs", "½ onion, finely chopped", "½ tomato, finely chopped", "1 green chilli", "Coriander leaves", "¼ tsp black pepper", "1 tsp butter or ghee", "Salt to taste"],
    steps: [
      "Whisk eggs with salt and pepper till frothy — this is the dhaba secret.",
      "Stir in onion, tomato, chilli and coriander.",
      "Cook on a hot tawa with butter, flipping once, till both sides are golden with crisp edges.",
      "Serve immediately with buttered toast or a stuffed paratha.",
    ],
  },
  {
    name: "Golden Egg Fried Rice",
    time: "20 min",
    serves: "3 people",
    ingredients: ["3 brown desi eggs", "3 cups cooked rice (day-old works best)", "1 carrot, finely diced", "½ cup peas or beans", "2 spring onions", "2 tbsp oil", "1 tsp soy sauce", "½ tsp black pepper", "Salt to taste"],
    steps: [
      "Scramble the eggs in hot oil into soft ribbons. Remove and keep aside.",
      "Stir-fry the vegetables on high flame for 2–3 minutes — keep the crunch.",
      "Add rice, soy sauce, pepper and salt. Toss on high flame till steaming.",
      "Fold the egg ribbons back in, garnish with spring onion greens and serve hot.",
    ],
  },
];

function RecipesPage() {
  const [open, setOpen] = useState(0);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="font-display text-3xl font-extrabold">Recipes from our kitchen</h1>
        <p className="mt-2 text-sm text-[var(--dim)]">Simple, honest recipes that let a good desi egg shine. Tap a recipe to open it.</p>
      </div>
      {RECIPES.map((r, i) => (
        <article key={r.name} className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          <button
            type="button"
            onClick={() => setOpen(open === i ? -1 : i)}
            aria-expanded={open === i}
            className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
          >
            <span>
              <span className="font-display block text-lg font-bold">{r.name}</span>
              <span className="text-sm text-[var(--dim)]">{r.time} · {r.serves}</span>
            </span>
            <span className="text-xl font-bold text-[var(--accent)]" aria-hidden>{open === i ? "−" : "+"}</span>
          </button>
          {open === i && (
            <div className="grid gap-5 border-t border-[var(--border)] px-5 py-4 sm:grid-cols-[1fr_1.4fr]">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--accent)]">Ingredients</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {r.ingredients.map((ing) => <li key={ing}>{ing}</li>)}
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--accent)]">Method</h3>
                <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
                  {r.steps.map((s) => <li key={s}>{s}</li>)}
                </ol>
              </div>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function DeliveryPage({ data }: { data: Storefront }) {
  const { settings, zones } = data;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="font-display text-3xl font-extrabold">Delivery areas & charges</h1>
      <div className="rounded-3xl bg-[var(--accent)] p-6 text-white">
        <p className="font-display text-2xl font-bold">Free delivery within {settings.freeRadiusKm} km</p>
        <p className="mt-1 text-sm text-[#f6d9db]">
          After {settings.freeRadiusKm} km, delivery is charged at {inr(settings.perKmPaise)} per extra km —
          calculated automatically from your area at checkout. No hidden charges, ever.
        </p>
        {settings.minOrderPaise > 0 && (
          <p className="mt-2 text-sm text-[#f6d9db]">Minimum order: {inr(settings.minOrderPaise)}</p>
        )}
      </div>
      <section>
        <SectionTitle sub="Distance is measured from our Kalka collection point">Areas we deliver to</SectionTitle>
        {zones.length === 0 ? (
          <p className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-8 text-center text-sm text-[var(--dim)]">
            Delivery areas are being updated. Please call us to check your village.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            {zones.map((z) => (
              <li key={z.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <span>
                  <span className="font-semibold">{z.name}</span>
                  <span className="block text-sm text-[var(--dim)]">approx. {z.distanceKm} km away</span>
                </span>
                {z.feePaise === 0 ? (
                  <span className="rounded-full bg-[#e6f2e6] px-3 py-1 text-sm font-bold text-[#2e7d32]">FREE delivery</span>
                ) : (
                  <span className="rounded-full bg-[var(--surface-alt)] px-3 py-1 text-sm font-bold">{inr(z.feePaise)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="font-display text-xl font-bold">Delivery slots</h2>
        <p>Morning 7–10 AM · Midday 11 AM–2 PM · Evening 4–7 PM. Order before the slot begins and we will do our best to reach you within it.</p>
        <p>Your village not listed? We are expanding village by village — send a message from the Contact page and we will try to add your area.</p>
      </section>
    </div>
  );
}

const FAQS = [
  { q: "What makes your eggs 'desi'?", a: "Our hens are country breeds raised free-range on natural feed — grains, greens and farm produce, with no growth hormones or artificial yolk colouring. That is why the yolk is deep orange and the taste is richer than regular farm eggs." },
  { q: "Are the eggs fertilised?", a: "No. Our eggs are table eggs from hens kept for laying. They are collected daily and are meant purely for eating." },
  { q: "How fresh are the eggs when they reach me?", a: "Eggs are collected in the morning, checked, graded and packed the same day. Because we deliver only in the Kalka–Pinjore area, most trays reach you within a day of being laid." },
  { q: "What if an egg is cracked in my tray?", a: "Tell us on call or WhatsApp with your order code, and we will replace the cracked eggs free with your next order. That is our crack-free promise." },
  { q: "How do I pay?", a: "You can pay by UPI directly to our store's own UPI ID — any app (Google Pay, PhonePe, Paytm) works, and the money goes straight to us, never to a middleman. Or simply choose Cash on Delivery and pay when your eggs arrive." },
  { q: "Is delivery really free?", a: "Yes — delivery is free for all areas within 3 km of our Kalka collection point. Beyond that, a small per-kilometre charge applies and is shown clearly at checkout before you confirm." },
  { q: "Can I get eggs every week without ordering again?", a: "Yes — join a weekly subscription plan from the Subscriptions page. We deliver on your fixed day, and you can pause any week with a day's notice." },
  { q: "Do you supply to shops and dhabas?", a: "Yes, we supply restaurants, dhabas, bakeries, hostels and sweet shops at bulk rates with monthly billing. Send a bulk enquiry and we will call you with rates." },
];

function FaqPage() {
  const [open, setOpen] = useState(0);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="font-display text-3xl font-extrabold">Common questions</h1>
      {FAQS.map((f, i) => (
        <article key={f.q} className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          <button type="button" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
            <span className="font-semibold">{f.q}</span>
            <span className="text-xl font-bold text-[var(--accent)]" aria-hidden>{open === i ? "−" : "+"}</span>
          </button>
          {open === i && <p className="border-t border-[var(--border)] px-5 py-4 text-sm leading-relaxed text-[var(--dim)]">{f.a}</p>}
        </article>
      ))}
    </div>
  );
}

function ContactPage({ data }: { data: Storefront }) {
  const { settings } = data;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="font-display text-3xl font-extrabold">Talk to us</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <p className="font-display font-bold text-[var(--accent)]">Call us</p>
          {settings.storePhone ? (
            <a href={`tel:${settings.storePhone}`} className="mt-1 block text-lg font-semibold">{settings.storePhone}</a>
          ) : (
            <p className="mt-1 text-sm text-[var(--dim)]">Phone number coming soon — use the form below meanwhile.</p>
          )}
          <p className="mt-1 text-sm text-[var(--dim)]">7 AM – 7 PM, all days</p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <p className="font-display font-bold text-[var(--accent)]">WhatsApp</p>
          {settings.storeWhatsapp ? (
            <a href={`https://wa.me/91${settings.storeWhatsapp}`} target="_blank" rel="noreferrer" className="mt-1 block text-lg font-semibold">
              Chat on WhatsApp
            </a>
          ) : (
            <p className="mt-1 text-sm text-[var(--dim)]">WhatsApp number coming soon — use the form below meanwhile.</p>
          )}
          <p className="mt-1 text-sm text-[var(--dim)]">Fastest for order queries</p>
        </div>
      </div>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 text-sm leading-relaxed">
        <p className="font-display text-base font-bold text-[var(--accent)]">Find us</p>
        <p className="mt-1">Red Rooster collection point, Kalka, Haryana — serving Pinjore and nearby villages.</p>
      </div>
      <EnquiryForm kind="contact" />
    </div>
  );
}

// ------------------------------------------------------------------ cart
function CartPage({
  data,
  cart,
  setQty,
  go,
  onOrderPlaced,
}: {
  data: Storefront;
  cart: CartMap;
  setQty: (id: number, q: number) => void;
  go: (r: Route) => void;
  onOrderPlaced: (order: Order) => void;
}) {
  const items = data.products.filter((p) => (cart[p.id] ?? 0) > 0);
  const subtotal = items.reduce((sum, p) => sum + p.pricePaise * (cart[p.id] ?? 0), 0);
  const [zoneId, setZoneId] = useState<number | null>(null);
  const zone = data.zones.find((z) => z.id === zoneId) ?? null;
  const fee = zone ? zone.feePaise : 0;
  const total = subtotal + fee;
  const minOrder = data.settings.minOrderPaise;
  const belowMin = subtotal < minOrder;

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [slot, setSlot] = useState(SLOTS[0] ?? "Morning · 7–10 AM");
  const [note, setNote] = useState("");
  const [payment, setPayment] = useState<"upi" | "cod">("upi");
  const [error, setError] = useState("");
  const [placed, setPlaced] = useState<Order | null>(null);

  const placeMutation = useMutation({
    mutationFn: () =>
      api.placeOrder({
        customerName: name,
        phone,
        address,
        zoneId: zoneId ?? 0,
        slot,
        items: items.map((p) => ({ productId: p.id, qty: cart[p.id] ?? 0 })),
        paymentMethod: payment,
        note,
      }),
    onSuccess: (res) => {
      setPlaced(res.order);
      onOrderPlaced(res.order);
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Order failed. Please try again."),
  });

  // UPI payment details for the just-placed order
  const upiQuery = useQuery({
    queryKey: ["upi-payment", placed?.code, phone],
    queryFn: () => api.getUpiPayment({ code: placed?.code ?? "", phone }),
    enabled: !!placed && placed.paymentMethod === "upi",
  });
  const [upiRef, setUpiRef] = useState("");
  const [refSaved, setRefSaved] = useState(false);
  const refMutation = useMutation({
    mutationFn: () => api.submitUpiRef({ code: placed?.code ?? "", phone, upiRef }),
    onSuccess: () => setRefSaved(true),
    onError: (e) => setError(e instanceof Error ? e.message : "Could not save the reference."),
  });

  if (placed) {
    return (
      <div className="mx-auto max-w-xl space-y-5">
        <div className="rounded-3xl border border-[#cfe3cf] bg-[#f0f7f0] px-6 py-8 text-center">
          <p className="text-4xl" aria-hidden>✓</p>
          <h1 className="font-display mt-2 text-2xl font-extrabold">Order placed!</h1>
          <p className="mt-2 text-sm text-[var(--dim)]">
            Dhanyavaad, {placed.customerName}. Your order code is
          </p>
          <p className="font-display mt-1 text-3xl font-extrabold tracking-wide text-[var(--accent)]">{placed.code}</p>
          <p className="mt-2 text-sm text-[var(--dim)]">
            Save this code — use it with your mobile number to track your order.
            Delivery: {placed.slot} · Total: <strong className="text-[var(--text)]">{inr(placed.totalPaise)}</strong>
          </p>
        </div>

        {placed.paymentMethod === "upi" && (
          <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <h2 className="font-display text-xl font-bold">Complete your UPI payment</h2>
            {upiQuery.isPending && <p className="mt-3 text-sm text-[var(--dim)]">Preparing payment…</p>}
            {upiQuery.data && upiQuery.data.upiId === "" && (
              <p className="mt-3 rounded-xl bg-[var(--surface-alt)] px-4 py-3 text-sm">
                Online UPI payment is being set up by the store. Please keep {inr(placed.totalPaise)} ready —
                our delivery person will collect it, or we will call you with payment details.
              </p>
            )}
            {upiQuery.data && upiQuery.data.upiId !== "" && (
              <div className="mt-3 space-y-4">
                <p className="text-sm text-[var(--dim)]">
                  Pay <strong className="text-[var(--text)]">{inr(upiQuery.data.amountPaise)}</strong> to{" "}
                  <strong className="text-[var(--text)]">{upiQuery.data.upiName}</strong> ({upiQuery.data.upiId}).
                  The money goes directly to the store&apos;s own account — no middleman.
                </p>
                {upiQuery.data.qrSvg && (
                  <div
                    className="mx-auto w-fit overflow-hidden rounded-2xl border border-[var(--border)] bg-white p-2 [&>svg]:h-52 [&>svg]:w-52"
                    role="img"
                    aria-label="UPI payment QR code"
                    dangerouslySetInnerHTML={{ __html: upiQuery.data.qrSvg }}
                  />
                )}
                <a
                  href={upiQuery.data.upiUrl}
                  className="flex min-h-12 items-center justify-center rounded-xl bg-[var(--accent)] text-base font-bold text-white"
                >
                  Pay {inr(upiQuery.data.amountPaise)} in your UPI app
                </a>
                <div>
                  <label htmlFor="upi-ref" className="mb-1 block text-sm font-semibold">
                    Paid? Enter your UPI transaction ID / UTR (optional but helps us confirm fast)
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="upi-ref"
                      value={upiRef}
                      onChange={(e) => setUpiRef(e.target.value)}
                      placeholder="e.g. 402833…"
                      className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 outline-none focus:border-[var(--accent)]"
                    />
                    <button
                      type="button"
                      disabled={upiRef.trim().length < 6 || refMutation.isPending || refSaved}
                      onClick={() => refMutation.mutate()}
                      className="shrink-0 rounded-xl bg-[var(--gold)] px-4 font-bold text-[#2b2118] disabled:opacity-50"
                    >
                      {refSaved ? "Saved ✓" : "Save"}
                    </button>
                  </div>
                </div>
              </div>
            )}
            {error && <p className="mt-3 rounded-lg bg-[#fbe9ea] px-3 py-2 text-sm font-medium text-[var(--accent-dark)]">{error}</p>}
          </section>
        )}
        {placed.paymentMethod === "cod" && (
          <p className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4 text-center text-sm">
            You chose Cash on Delivery — please keep {inr(placed.totalPaise)} ready when your eggs arrive.
          </p>
        )}
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" onClick={() => go({ name: "track" })} className="min-h-11 rounded-xl bg-[var(--accent)] px-5 text-sm font-bold text-white">
            Track this order
          </button>
          <button type="button" onClick={() => go({ name: "shop" })} className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 text-sm font-bold">
            Continue shopping
          </button>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-5 py-12 text-center">
        <img src={logoUrl} alt="" className="mx-auto h-20 w-20 rounded-full object-cover" />
        <h1 className="font-display mt-4 text-2xl font-bold">Your cart is empty</h1>
        <p className="mt-2 text-sm text-[var(--dim)]">Add a fresh tray of brown desi eggs to get started.</p>
        <button type="button" onClick={() => go({ name: "shop" })} className="mt-5 min-h-11 rounded-xl bg-[var(--accent)] px-6 text-sm font-bold text-white">
          Browse eggs
        </button>
      </div>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!zone) return setError("Please choose your delivery area.");
    if (name.trim().length < 2) return setError("Please enter your name.");
    if (!/^[6-9]\d{9}$/.test(phone.trim())) return setError("Enter a valid 10-digit mobile number.");
    if (address.trim().length < 8) return setError("Please enter your full address with a landmark.");
    if (belowMin) return setError(`Minimum order is ${inr(minOrder)}. Add a little more.`);
    placeMutation.mutate();
  };

  const inputCls = "w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-base outline-none focus:border-[var(--accent)]";

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-5">
        <h1 className="font-display text-3xl font-extrabold">Your cart</h1>
        <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          {items.map((p) => (
            <li key={p.id} className="flex items-center gap-3 p-3">
              <img src={p.imageUrl ?? trayEggsUrl} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{p.name}</p>
                <p className="text-sm text-[var(--dim)]">{p.packLabel} · {inr(p.pricePaise)}</p>
              </div>
              <QtyStepper qty={cart[p.id] ?? 0} onChange={(q) => setQty(p.id, q)} label={p.name} />
              <p className="w-20 text-right font-bold">{inr(p.pricePaise * (cart[p.id] ?? 0))}</p>
            </li>
          ))}
        </ul>

        <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          <h2 className="font-display text-lg font-bold">Delivery details</h2>
          <div>
            <label htmlFor="co-zone" className="mb-1 block text-sm font-semibold">Delivery area</label>
            <select id="co-zone" className={inputCls} value={zoneId ?? ""} onChange={(e) => setZoneId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Choose your area…</option>
              {data.zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name} ({z.distanceKm} km) — {z.feePaise === 0 ? "FREE delivery" : inr(z.feePaise)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="co-name" className="mb-1 block text-sm font-semibold">Your name</label>
              <input id="co-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Full name" />
            </div>
            <div>
              <label htmlFor="co-phone" className="mb-1 block text-sm font-semibold">Mobile number</label>
              <input id="co-phone" className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" autoComplete="tel" placeholder="10-digit mobile" />
            </div>
          </div>
          <div>
            <label htmlFor="co-address" className="mb-1 block text-sm font-semibold">Full address</label>
            <textarea id="co-address" className={inputCls} rows={2} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="House no., street / village, landmark" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="co-slot" className="mb-1 block text-sm font-semibold">Delivery slot</label>
              <select id="co-slot" className={inputCls} value={slot} onChange={(e) => setSlot(e.target.value)}>
                {SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="co-note" className="mb-1 block text-sm font-semibold">Note (optional)</label>
              <input id="co-note" className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Call on arrival" />
            </div>
          </div>
        </section>
      </div>

      <div className="space-y-4 lg:sticky lg:top-32 lg:self-start">
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="font-display text-lg font-bold">Bill details</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-[var(--dim)]">Items total</dt><dd className="font-semibold">{inr(subtotal)}</dd></div>
            <div className="flex justify-between">
              <dt className="text-[var(--dim)]">Delivery {zone ? `(${zone.name})` : ""}</dt>
              <dd className="font-semibold">{!zone ? "Select area" : fee === 0 ? <span className="text-[#2e7d32]">FREE</span> : inr(fee)}</dd>
            </div>
            {zone && (
              <p className="rounded-lg bg-[var(--surface-alt)] px-3 py-2 text-xs">
                {zone.distanceKm <= data.settings.freeRadiusKm
                  ? `Your area is within the free ${data.settings.freeRadiusKm} km radius.`
                  : `${zone.distanceKm} km away — free up to ${data.settings.freeRadiusKm} km, then ${inr(data.settings.perKmPaise)}/km.`}
              </p>
            )}
            <div className="flex justify-between border-t border-[var(--border)] pt-2 text-base">
              <dt className="font-bold">To pay</dt><dd className="font-extrabold">{inr(total)}</dd>
            </div>
          </dl>
          {belowMin && <p className="mt-3 rounded-lg bg-[#fdf3d7] px-3 py-2 text-sm font-medium">Minimum order is {inr(minOrder)} — add {inr(minOrder - subtotal)} more.</p>}

          <fieldset className="mt-4 space-y-2">
            <legend className="text-sm font-semibold">Payment method</legend>
            <label className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${payment === "upi" ? "border-[var(--accent)] bg-[#fdf1f2]" : "border-[var(--border)]"}`}>
              <input type="radio" name="pay" value="upi" checked={payment === "upi"} onChange={() => setPayment("upi")} className="h-5 w-5 accent-[#a31621]" />
              <span>
                <span className="block font-semibold">UPI — pay now</span>
                <span className="block text-xs text-[var(--dim)]">Direct to the store&apos;s own UPI ID. Any app works.</span>
              </span>
            </label>
            <label className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${payment === "cod" ? "border-[var(--accent)] bg-[#fdf1f2]" : "border-[var(--border)]"}`}>
              <input type="radio" name="pay" value="cod" checked={payment === "cod"} onChange={() => setPayment("cod")} className="h-5 w-5 accent-[#a31621]" />
              <span>
                <span className="block font-semibold">Cash on Delivery</span>
                <span className="block text-xs text-[var(--dim)]">Pay when your eggs arrive at your door.</span>
              </span>
            </label>
          </fieldset>

          {error && <p className="mt-3 rounded-lg bg-[#fbe9ea] px-3 py-2 text-sm font-medium text-[var(--accent-dark)]">{error}</p>}
          <button type="submit" disabled={placeMutation.isPending} className="mt-4 min-h-13 w-full rounded-xl bg-[var(--accent)] py-3.5 text-base font-bold text-white shadow disabled:opacity-60">
            {placeMutation.isPending ? "Placing order…" : `Place order · ${inr(total)}`}
          </button>
          <p className="mt-2 text-center text-xs text-[var(--dim)]">By ordering you agree to be called on your mobile for delivery.</p>
        </section>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ track
function TrackPage() {
  const [code, setCode] = useState(() => {
    try {
      return localStorage.getItem("rr-last-code") ?? "";
    } catch {
      return "";
    }
  });
  const [phone, setPhone] = useState(() => {
    try {
      return localStorage.getItem("rr-last-phone") ?? "";
    } catch {
      return "";
    }
  });
  const [search, setSearch] = useState<{ code: string; phone: string } | null>(null);
  const query = useQuery({
    queryKey: ["track", search?.code, search?.phone],
    queryFn: () => api.trackOrder({ code: search?.code ?? "", phone: search?.phone ?? "" }),
    enabled: !!search,
    retry: false,
  });
  const order = query.data?.order;
  const stepIndex = order ? STATUS_STEPS.indexOf(order.status) : -1;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSearch({ code: code.trim().toUpperCase(), phone: phone.trim() });
  };

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <h1 className="font-display text-3xl font-extrabold">Track your order</h1>
      <form onSubmit={submit} className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
        <div>
          <label htmlFor="track-code" className="mb-1 block text-sm font-semibold">Order code</label>
          <input id="track-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. RR-AB12C" className="w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 uppercase outline-none focus:border-[var(--accent)]" />
        </div>
        <div>
          <label htmlFor="track-phone" className="mb-1 block text-sm font-semibold">Mobile number used at checkout</label>
          <input id="track-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" placeholder="10-digit mobile" className="w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 outline-none focus:border-[var(--accent)]" />
        </div>
        <button type="submit" disabled={query.isFetching} className="min-h-12 w-full rounded-xl bg-[var(--accent)] font-bold text-white disabled:opacity-60">
          {query.isFetching ? "Finding…" : "Find my order"}
        </button>
        {query.isError && (
          <p className="rounded-lg bg-[#fbe9ea] px-3 py-2 text-sm font-medium text-[var(--accent-dark)]">
            {query.error instanceof Error ? query.error.message : "Order not found."}
          </p>
        )}
      </form>

      {order && (
        <section className="space-y-4 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-display text-xl font-extrabold">{order.code}</p>
            <span className={`rounded-full px-3 py-1 text-sm font-bold ${order.status === "cancelled" ? "bg-[#fbe9ea] text-[var(--accent-dark)]" : "bg-[var(--surface-alt)]"}`}>
              {STATUS_LABEL[order.status] ?? order.status}
            </span>
          </div>
          {order.status !== "cancelled" && (
            <ol className="flex items-center gap-1" aria-label="Delivery progress">
              {STATUS_STEPS.map((s, i) => (
                <li key={s} className="flex flex-1 flex-col items-center gap-1">
                  <span className={`h-2.5 w-full rounded-full ${i <= stepIndex ? "bg-[var(--accent)]" : "bg-[var(--border)]"}`} />
                  <span className={`text-center text-[11px] leading-tight ${i <= stepIndex ? "font-bold" : "text-[var(--dim)]"}`}>{STATUS_LABEL[s]}</span>
                </li>
              ))}
            </ol>
          )}
          <ul className="space-y-1 text-sm">
            {order.items.map((it) => (
              <li key={it.productId} className="flex justify-between">
                <span>{it.name} ({it.packLabel}) × {it.qty}</span>
                <span className="font-semibold">{inr(it.unitPricePaise * it.qty)}</span>
              </li>
            ))}
          </ul>
          <dl className="space-y-1 border-t border-[var(--border)] pt-3 text-sm">
            <div className="flex justify-between"><dt className="text-[var(--dim)]">Delivery fee</dt><dd>{order.deliveryFeePaise === 0 ? "FREE" : inr(order.deliveryFeePaise)}</dd></div>
            <div className="flex justify-between font-bold"><dt>Total</dt><dd>{inr(order.totalPaise)}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--dim)]">Area</dt><dd>{order.zoneName}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--dim)]">Slot</dt><dd>{order.slot}</dd></div>
            <div className="flex justify-between">
              <dt className="text-[var(--dim)]">Payment</dt>
              <dd>{order.paymentMethod === "upi" ? "UPI" : "Cash on Delivery"} · {order.paymentStatus === "paid" ? "Paid ✓" : order.paymentStatus === "cod_pending" ? "Pay on delivery" : "Payment pending"}</dd>
            </div>
            <div className="flex justify-between"><dt className="text-[var(--dim)]">Placed</dt><dd>{new Date(order.createdAt).toLocaleString("en-IN")}</dd></div>
          </dl>
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ admin
const ADMIN_TOKEN_KEY = "rr-admin-token";

function rupeesToPaise(v: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function AdminPage({ go }: { go: (r: Route) => void }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string>(() => {
    try {
      return localStorage.getItem(ADMIN_TOKEN_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const status = useQuery({
    queryKey: ["admin-status", token],
    queryFn: () => api.adminStatus({ token: token || undefined }),
  });
  const hasAccount = status.data?.hasAccount ?? false;
  const authed = status.data?.authed ?? false;

  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const saveToken = (t: string) => {
    setToken(t);
    try {
      localStorage.setItem(ADMIN_TOKEN_KEY, t);
    } catch {
      /* ignore */
    }
  };
  const setupMutation = useMutation({
    mutationFn: () => api.adminSetup({ password }),
    onSuccess: (res) => {
      saveToken(res.token);
      setPassword("");
      setAuthError("");
    },
    onError: (e) => setAuthError(e instanceof Error ? e.message : "Setup failed."),
  });
  const loginMutation = useMutation({
    mutationFn: () => api.adminLogin({ password }),
    onSuccess: (res) => {
      saveToken(res.token);
      setPassword("");
      setAuthError("");
    },
    onError: (e) => setAuthError(e instanceof Error ? e.message : "Login failed."),
  });
  const logout = () => {
    saveToken("");
    try {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
    } catch {
      /* ignore */
    }
  };

  const data = useQuery({
    queryKey: ["admin-data", token],
    queryFn: () => api.adminData({ token }),
    enabled: authed && token !== "",
    retry: false,
  });

  if (status.isPending) return <p className="py-10 text-center text-sm text-[var(--dim)]">Checking admin access…</p>;

  if (!authed) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <img src={logoUrl} alt="" className="mx-auto h-20 w-20 rounded-full object-cover" />
        <h1 className="font-display mt-3 text-center text-2xl font-extrabold">
          {hasAccount ? "Owner login" : "Create your owner account"}
        </h1>
        <p className="mt-2 text-center text-sm text-[var(--dim)]">
          {hasAccount
            ? "This panel controls products, prices, delivery areas and orders. Keep your password private."
            : "Welcome! Set a strong password for your store's admin panel. You will use it to add products and manage the shop."}
        </p>
        <form
          className="mt-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setAuthError("");
            if (hasAccount) loginMutation.mutate();
            else setupMutation.mutate();
          }}
        >
          <div>
            <label htmlFor="admin-password" className="mb-1 block text-sm font-semibold">
              {hasAccount ? "Password" : "Choose a password (min 8 characters)"}
            </label>
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 outline-none focus:border-[var(--accent)]"
              autoComplete={hasAccount ? "current-password" : "new-password"}
            />
          </div>
          {authError && <p className="rounded-lg bg-[#fbe9ea] px-3 py-2 text-sm font-medium text-[var(--accent-dark)]">{authError}</p>}
          <button type="submit" disabled={password.length < (hasAccount ? 1 : 8) || setupMutation.isPending || loginMutation.isPending} className="min-h-12 w-full rounded-xl bg-[var(--accent)] font-bold text-white disabled:opacity-60">
            {hasAccount ? "Log in" : "Create account & open panel"}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-[var(--dim)]">
          🔒 Password is stored hashed on the server. Wrong attempts are rate-limited automatically.
        </p>
      </div>
    );
  }

  if (data.isPending) return <p className="py-10 text-center text-sm text-[var(--dim)]">Loading your store…</p>;
  if (data.isError || !data.data) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
        <p className="text-sm">Session expired or data could not load.</p>
        <button type="button" onClick={logout} className="mt-4 min-h-11 rounded-xl bg-[var(--accent)] px-5 text-sm font-bold text-white">Log in again</button>
      </div>
    );
  }

  const admin = data.data;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-data"] });
    void queryClient.invalidateQueries({ queryKey: ["storefront"] });
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Store admin</h1>
          <p className="text-sm text-[var(--dim)]">Products, plans, delivery areas, orders — sab yahin se control hota hai.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => go({ name: "shop" })} className="min-h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-bold">View shop</button>
          <button type="button" onClick={logout} className="min-h-10 rounded-xl bg-[var(--accent)] px-4 text-sm font-bold text-white">Log out</button>
        </div>
      </div>

      <AdminOrders token={token} admin={admin} refresh={refresh} />
      <AdminProducts token={token} admin={admin} refresh={refresh} />
      <AdminPlans token={token} admin={admin} refresh={refresh} />
      <AdminZones token={token} admin={admin} refresh={refresh} />
      <AdminEnquiries token={token} admin={admin} refresh={refresh} />
      <AdminSettings token={token} admin={admin} refresh={refresh} />
      <AdminSecurity />
    </div>
  );
}

function AdminSection({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
      <h2 className="font-display text-xl font-bold">{title}</h2>
      {sub && <p className="mt-0.5 text-sm text-[var(--dim)]">{sub}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

const adminInput =
  "w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";

function AdminOrders({ token, admin, refresh }: { token: string; admin: AdminData; refresh: () => void }) {
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: (args: { id: number; status?: "placed" | "confirmed" | "out_for_delivery" | "delivered" | "cancelled"; paymentStatus?: "pending" | "paid" | "cod_pending" }) =>
      api.adminUpdateOrder({ token, ...args }),
    onSuccess: refresh,
    onError: (e) => setError(e instanceof Error ? e.message : "Update failed."),
  });
  return (
    <AdminSection title={`Orders (${admin.orders.length})`} sub="Newest first. Update delivery and payment status as you work.">
      {error && <p className="mb-3 rounded-lg bg-[#fbe9ea] px-3 py-2 text-sm font-medium text-[var(--accent-dark)]">{error}</p>}
      {admin.orders.length === 0 ? (
        <p className="text-sm text-[var(--dim)]">No orders yet. When a customer orders, it will appear here.</p>
      ) : (
        <ul className="space-y-3">
          {admin.orders.map((o) => (
            <li key={o.id} className="rounded-2xl border border-[var(--border)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">{o.code} · {o.customerName}</p>
                <p className="text-sm font-bold">{inr(o.totalPaise)}</p>
              </div>
              <p className="mt-1 text-sm text-[var(--dim)]">
                📞 {o.phone} · {o.zoneName} · {o.slot} · {new Date(o.createdAt).toLocaleString("en-IN")}
              </p>
              <p className="mt-1 text-sm">{o.address}</p>
              <ul className="mt-2 space-y-0.5 text-sm text-[var(--dim)]">
                {o.items.map((it) => (
                  <li key={it.productId}>{it.name} ({it.packLabel}) × {it.qty} — {inr(it.unitPricePaise * it.qty)}</li>
                ))}
                <li>Delivery: {o.deliveryFeePaise === 0 ? "FREE" : inr(o.deliveryFeePaise)}</li>
              </ul>
              {o.note && <p className="mt-1 text-sm">Note: {o.note}</p>}
              {o.paymentMethod === "upi" && (
                <p className="mt-1 text-sm">UPI {o.upiRef ? `· Ref: ${o.upiRef}` : "· no ref submitted yet"}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <label className="sr-only" htmlFor={`ord-status-${o.id}`}>Delivery status for {o.code}</label>
                <select
                  id={`ord-status-${o.id}`}
                  value={o.status}
                  onChange={(e) => mutation.mutate({ id: o.id, status: e.target.value as "placed" | "confirmed" | "out_for_delivery" | "delivered" | "cancelled" })}
                  className="rounded-lg border border-[var(--border)] bg-white px-2 py-2 text-sm font-semibold"
                >
                  <option value="placed">Placed</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="out_for_delivery">Out for delivery</option>
                  <option value="delivered">Delivered</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                <label className="sr-only" htmlFor={`ord-pay-${o.id}`}>Payment status for {o.code}</label>
                <select
                  id={`ord-pay-${o.id}`}
                  value={o.paymentStatus}
                  onChange={(e) => mutation.mutate({ id: o.id, paymentStatus: e.target.value as "pending" | "paid" | "cod_pending" })}
                  className="rounded-lg border border-[var(--border)] bg-white px-2 py-2 text-sm font-semibold"
                >
                  <option value="pending">Payment pending</option>
                  <option value="paid">Paid</option>
                  <option value="cod_pending">COD — collect on delivery</option>
                </select>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AdminSection>
  );
}

type ProductDraft = {
  id: number | null;
  name: string;
  category: string;
  packLabel: string;
  eggsCount: string;
  priceRupees: string;
  mrpRupees: string;
  description: string;
  stockStatus: "in_stock" | "low_stock" | "out_of_stock";
  featured: boolean;
  sortOrder: string;
  active: boolean;
  image: { dataBase64: string; mimeType: string } | null;
  imagePreview: string | null;
  removeImage: boolean;
};

const emptyProductDraft: ProductDraft = {
  id: null,
  name: "",
  category: "Desi Eggs",
  packLabel: "Tray of 30",
  eggsCount: "30",
  priceRupees: "",
  mrpRupees: "",
  description: "",
  stockStatus: "in_stock",
  featured: false,
  sortOrder: "0",
  active: true,
  image: null,
  imagePreview: null,
  removeImage: false,
};

function AdminProducts({ token, admin, refresh }: { token: string; admin: AdminData; refresh: () => void }) {
  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error("Nothing to save");
      return api.adminSaveProduct({
        token,
        id: draft.id,
        name: draft.name,
        category: draft.category,
        packLabel: draft.packLabel,
        eggsCount: Number(draft.eggsCount) || 1,
        pricePaise: rupeesToPaise(draft.priceRupees),
        mrpPaise: draft.mrpRupees ? rupeesToPaise(draft.mrpRupees) : null,
        description: draft.description,
        stockStatus: draft.stockStatus,
        featured: draft.featured,
        sortOrder: Number(draft.sortOrder) || 0,
        active: draft.active,
        image: draft.image,
        removeImage: draft.removeImage,
      });
    },
    onSuccess: () => {
      setDraft(null);
      setError("");
      refresh();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not save product."),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.adminDeleteProduct({ token, id }),
    onSuccess: refresh,
    onError: (e) => setError(e instanceof Error ? e.message : "Could not delete product."),
  });
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const startEdit = (p: AdminData["products"][number]) => {
    setError("");
    setDraft({
      id: p.id,
      name: p.name,
      category: p.category,
      packLabel: p.packLabel,
      eggsCount: String(p.eggsCount),
      priceRupees: String(p.pricePaise / 100),
      mrpRupees: p.mrpPaise ? String(p.mrpPaise / 100) : "",
      description: p.description,
      stockStatus: (["in_stock", "low_stock", "out_of_stock"].includes(p.stockStatus) ? p.stockStatus : "in_stock") as ProductDraft["stockStatus"],
      featured: p.featured,
      sortOrder: String(p.sortOrder),
      active: p.active,
      image: null,
      imagePreview: p.imageUrl,
      removeImage: false,
    });
  };

  const onFile = async (file: File | undefined) => {
    if (!file || !draft) return;
    try {
      const { dataBase64, mimeType } = await fileToBase64(file);
      setDraft({ ...draft, image: { dataBase64, mimeType }, imagePreview: URL.createObjectURL(file), removeImage: false });
    } catch {
      setError("That image could not be read. Try a JPG or PNG under 5 MB.");
    }
  };

  return (
    <AdminSection title={`Products (${admin.products.length})`} sub="Yahin se product add hota hai — naam, pack, price, photo sab.">
      {error && <p className="mb-3 rounded-lg bg-[#fbe9ea] px-3 py-2 text-sm font-medium text-[var(--accent-dark)]">{error}</p>}
      {!draft && (
        <button type="button" onClick={() => { setError(""); setDraft({ ...emptyProductDraft }); }} className="min-h-11 rounded-xl bg-[var(--accent)] px-5 text-sm font-bold text-white">
          + Add new product
        </button>
      )}
      {draft && (
        <form
          className="space-y-3 rounded-2xl border border-[var(--gold)] bg-[#fffaf0] p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.name.trim().length < 2) return setError("Product name is too short.");
            if (rupeesToPaise(draft.priceRupees) < 1) return setError("Enter a price above ₹0.");
            saveMutation.mutate();
          }}
        >
          <p className="font-display text-lg font-bold">{draft.id ? "Edit product" : "New product"}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="pd-name" className="mb-1 block text-sm font-semibold">Product name</label>
              <input id="pd-name" className={adminInput} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Brown Desi Eggs" />
            </div>
            <div>
              <label htmlFor="pd-category" className="mb-1 block text-sm font-semibold">Category</label>
              <input id="pd-category" className={adminInput} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="Desi Eggs" />
            </div>
            <div>
              <label htmlFor="pd-pack" className="mb-1 block text-sm font-semibold">Pack label</label>
              <input id="pd-pack" className={adminInput} value={draft.packLabel} onChange={(e) => setDraft({ ...draft, packLabel: e.target.value })} placeholder="Tray of 30" />
            </div>
            <div>
              <label htmlFor="pd-eggs" className="mb-1 block text-sm font-semibold">Eggs in pack</label>
              <input id="pd-eggs" type="number" min={1} className={adminInput} value={draft.eggsCount} onChange={(e) => setDraft({ ...draft, eggsCount: e.target.value })} />
            </div>
            <div>
              <label htmlFor="pd-price" className="mb-1 block text-sm font-semibold">Price (₹)</label>
              <input id="pd-price" type="number" min={0} step="0.01" className={adminInput} value={draft.priceRupees} onChange={(e) => setDraft({ ...draft, priceRupees: e.target.value })} placeholder="e.g. 240" />
            </div>
            <div>
              <label htmlFor="pd-mrp" className="mb-1 block text-sm font-semibold">MRP (₹, optional — shows a strike price)</label>
              <input id="pd-mrp" type="number" min={0} step="0.01" className={adminInput} value={draft.mrpRupees} onChange={(e) => setDraft({ ...draft, mrpRupees: e.target.value })} placeholder="e.g. 300" />
            </div>
            <div>
              <label htmlFor="pd-stock" className="mb-1 block text-sm font-semibold">Stock</label>
              <select id="pd-stock" className={adminInput} value={draft.stockStatus} onChange={(e) => setDraft({ ...draft, stockStatus: e.target.value as ProductDraft["stockStatus"] })}>
                <option value="in_stock">In stock</option>
                <option value="low_stock">Low stock</option>
                <option value="out_of_stock">Out of stock</option>
              </select>
            </div>
            <div>
              <label htmlFor="pd-sort" className="mb-1 block text-sm font-semibold">Display order (lower shows first)</label>
              <input id="pd-sort" type="number" min={0} className={adminInput} value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })} />
            </div>
          </div>
          <div>
            <label htmlFor="pd-desc" className="mb-1 block text-sm font-semibold">Description</label>
            <textarea id="pd-desc" rows={3} className={adminInput} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Farm fresh brown desi eggs, collected this morning…" />
          </div>
          <div>
            <span className="mb-1 block text-sm font-semibold">Product photo</span>
            <div className="flex flex-wrap items-center gap-3">
              {draft.imagePreview && !draft.removeImage && (
                <img src={draft.imagePreview} alt="Product preview" className="h-20 w-20 rounded-xl object-cover" />
              )}
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="Upload product photo" onChange={(e) => void onFile(e.target.files?.[0])} />
              <button type="button" onClick={() => fileRef.current?.click()} className="min-h-10 rounded-lg border border-[var(--border)] bg-white px-4 text-sm font-bold">
                {draft.imagePreview ? "Change photo" : "Upload photo"}
              </button>
              {draft.imagePreview && !draft.removeImage && (
                <button type="button" onClick={() => setDraft({ ...draft, removeImage: true, image: null, imagePreview: null })} className="min-h-10 rounded-lg px-3 text-sm font-bold text-[var(--accent)]">
                  Remove photo
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-[var(--dim)]">No photo? A farm tray photo is shown automatically.</p>
          </div>
          <div className="flex flex-wrap gap-5 text-sm font-medium">
            <label className="flex min-h-9 cursor-pointer items-center gap-2">
              <input type="checkbox" checked={draft.featured} onChange={(e) => setDraft({ ...draft, featured: e.target.checked })} className="h-5 w-5 accent-[#a31621]" />
              Show on home page
            </label>
            <label className="flex min-h-9 cursor-pointer items-center gap-2">
              <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} className="h-5 w-5 accent-[#a31621]" />
              Visible in shop
            </label>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saveMutation.isPending} className="min-h-11 rounded-xl bg-[var(--accent)] px-5 text-sm font-bold text-white disabled:opacity-60">
              {saveMutation.isPending ? "Saving…" : draft.id ? "Save changes" : "Add product"}
            </button>
            <button type="button" onClick={() => setDraft(null)} className="min-h-11 rounded-xl border border-[var(--border)] bg-white px-5 text-sm font-bold">Cancel</button>
          </div>
        </form>
      )}

      {admin.products.length > 0 && (
        <ul className="mt-4 divide-y divide-[var(--border)]">
          {admin.products.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
              <img src={p.imageUrl ?? trayEggsUrl} alt="" className="h-12 w-12 rounded-lg object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{p.name} {!p.active && <span className="text-xs font-bold text-[var(--accent)]">(hidden)</span>}</p>
                <p className="text-sm text-[var(--dim)]">{p.packLabel} · {inr(p.pricePaise)} · {p.stockStatus.replace("_", " ")}</p>
              </div>
              <button type="button" onClick={() => startEdit(p)} className="min-h-9 rounded-lg border border-[var(--border)] bg-white px-3 text-sm font-bold">Edit</button>
              {confirmDelete === p.id ? (
                <>
                  <button type="button" onClick={() => deleteMutation.mutate(p.id)} className="min-h-9 rounded-lg bg-[var(--accent)] px-3 text-sm font-bold text-white">Confirm delete</button>
                  <button type="button" onClick={() => setConfirmDelete(null)} className="min-h-9 rounded-lg px-2 text-sm font-bold">Keep</button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(p.id)} className="min-h-9 rounded-lg px-3 text-sm font-bold text-[var(--accent)]">Delete</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {admin.products.length === 0 && !draft && (
        <p className="mt-3 text-sm text-[var(--dim)]">No products yet — your shop is empty until you add the first tray.</p>
      )}
    </AdminSection>
  );
}

function AdminPlans({ token, admin, refresh }: { token: string; admin: AdminData; refresh: () => void }) {
  const [draft, setDraft] = useState<{ id: number | null; name: string; description: string; traysPerWeek: string; priceRupees: string; active: boolean } | null>(null);
  const [error, setError] = useState("");
  const saveMutation = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error("Nothing to save");
      return api.adminSavePlan({
        token,
        id: draft.id,
        name: draft.name,
        description: draft.description,
        traysPerWeek: Number(draft.traysPerWeek) || 1,
        pricePaise: rupeesToPaise(draft.priceRupees),
        active: draft.active,
        sortOrder: 0,
      });
    },
    onSuccess: () => { setDraft(null); refresh(); },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not save plan."),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.adminDeletePlan({ token, id }),
    onSuccess: refresh,
  });
  return (
    <AdminSection title={`Subscription plans (${admin.plans.length})`} sub="Weekly plans customers see on the Subscriptions page.">
      {error && <p className="mb-3 rounded-lg bg-[#fbe9ea] px-3 py-2 text-sm font-medium text-[var(--accent-dark)]">{error}</p>}
      {!draft && (
        <button type="button" onClick={() => setDraft({ id: null, name: "", description: "", traysPerWeek: "1", priceRupees: "", active: true })} className="min-h-11 rounded-xl bg-[var(--accent)] px-5 text-sm font-bold text-white">
          + Add plan
        </button>
      )}
      {draft && (
        <form className="grid gap-3 rounded-2xl border border-[var(--gold)] bg-[#fffaf0] p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(); }}>
          <div>
            <label htmlFor="pl-name" className="mb-1 block text-sm font-semibold">Plan name</label>
            <input id="pl-name" className={adminInput} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Family Weekly" />
          </div>
          <div>
            <label htmlFor="pl-price" className="mb-1 block text-sm font-semibold">Monthly price (₹)</label>
            <input id="pl-price" type="number" min={0} step="0.01" className={adminInput} value={draft.priceRupees} onChange={(e) => setDraft({ ...draft, priceRupees: e.target.value })} />
          </div>
          <div>
            <label htmlFor="pl-trays" className="mb-1 block text-sm font-semibold">Trays per week</label>
            <input id="pl-trays" type="number" min={1} className={adminInput} value={draft.traysPerWeek} onChange={(e) => setDraft({ ...draft, traysPerWeek: e.target.value })} />
          </div>
          <div>
            <label htmlFor="pl-desc" className="mb-1 block text-sm font-semibold">Description</label>
            <input id="pl-desc" className={adminInput} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Best for a family of four" />
          </div>
          <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} className="h-5 w-5 accent-[#a31621]" />
            Visible to customers
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={saveMutation.isPending} className="min-h-10 rounded-xl bg-[var(--accent)] px-4 text-sm font-bold text-white disabled:opacity-60">Save plan</button>
            <button type="button" onClick={() => setDraft(null)} className="min-h-10 rounded-xl border border-[var(--border)] bg-white px-4 text-sm font-bold">Cancel</button>
          </div>
        </form>
      )}
      {admin.plans.length > 0 && (
        <ul className="mt-4 divide-y divide-[var(--border)]">
          {admin.plans.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="flex-1">
                <p className="font-semibold">{p.name} {!p.active && <span className="text-xs font-bold text-[var(--accent)]">(hidden)</span>}</p>
                <p className="text-sm text-[var(--dim)]">{p.traysPerWeek} tray(s)/week · {inr(p.pricePaise)}/month</p>
              </div>
              <button type="button" onClick={() => setDraft({ id: p.id, name: p.name, description: p.description, traysPerWeek: String(p.traysPerWeek), priceRupees: String(p.pricePaise / 100), active: p.active })} className="min-h-9 rounded-lg border border-[var(--border)] bg-white px-3 text-sm font-bold">Edit</button>
              <button type="button" onClick={() => deleteMutation.mutate(p.id)} className="min-h-9 rounded-lg px-3 text-sm font-bold text-[var(--accent)]">Delete</button>
            </li>
          ))}
        </ul>
      )}
    </AdminSection>
  );
}

function AdminZones({ token, admin, refresh }: { token: string; admin: AdminData; refresh: () => void }) {
  const [draft, setDraft] = useState<{ id: number | null; name: string; distanceKm: string; active: boolean } | null>(null);
  const [error, setError] = useState("");
  const saveMutation = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error("Nothing to save");
      return api.adminSaveZone({ token, id: draft.id, name: draft.name, distanceKm: Number(draft.distanceKm) || 0, active: draft.active });
    },
    onSuccess: () => { setDraft(null); refresh(); },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not save area."),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.adminDeleteZone({ token, id }),
    onSuccess: refresh,
  });
  const s = admin.settings;
  return (
    <AdminSection title={`Delivery areas (${admin.zones.length})`} sub={`Free delivery up to ${s["free_radius_km"] ?? "3"} km, then ₹${(Number(s["per_km_paise"] ?? "1000") / 100).toFixed(0)}/km — change rates in Settings below.`}>
      {error && <p className="mb-3 rounded-lg bg-[#fbe9ea] px-3 py-2 text-sm font-medium text-[var(--accent-dark)]">{error}</p>}
      {!draft && (
        <button type="button" onClick={() => setDraft({ id: null, name: "", distanceKm: "", active: true })} className="min-h-11 rounded-xl bg-[var(--accent)] px-5 text-sm font-bold text-white">
          + Add village / area
        </button>
      )}
      {draft && (
        <form className="grid gap-3 rounded-2xl border border-[var(--gold)] bg-[#fffaf0] p-4 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(); }}>
          <div>
            <label htmlFor="zn-name" className="mb-1 block text-sm font-semibold">Area / village name</label>
            <input id="zn-name" className={adminInput} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Tipra" />
          </div>
          <div>
            <label htmlFor="zn-km" className="mb-1 block text-sm font-semibold">Distance from Kalka (km)</label>
            <input id="zn-km" type="number" min={0} step="0.1" className={adminInput} value={draft.distanceKm} onChange={(e) => setDraft({ ...draft, distanceKm: e.target.value })} />
          </div>
          <div className="flex items-end gap-2">
            <button type="submit" disabled={saveMutation.isPending} className="min-h-10 rounded-xl bg-[var(--accent)] px-4 text-sm font-bold text-white disabled:opacity-60">Save</button>
            <button type="button" onClick={() => setDraft(null)} className="min-h-10 rounded-xl border border-[var(--border)] bg-white px-4 text-sm font-bold">Cancel</button>
          </div>
        </form>
      )}
      {admin.zones.length > 0 && (
        <ul className="mt-4 divide-y divide-[var(--border)]">
          {admin.zones.map((z) => (
            <li key={z.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="flex-1">
                <p className="font-semibold">{z.name} {!z.active && <span className="text-xs font-bold text-[var(--accent)]">(paused)</span>}</p>
                <p className="text-sm text-[var(--dim)]">{z.distanceKm} km away</p>
              </div>
              <button type="button" onClick={() => setDraft({ id: z.id, name: z.name, distanceKm: String(z.distanceKm), active: z.active })} className="min-h-9 rounded-lg border border-[var(--border)] bg-white px-3 text-sm font-bold">Edit</button>
              <button type="button" onClick={() => deleteMutation.mutate(z.id)} className="min-h-9 rounded-lg px-3 text-sm font-bold text-[var(--accent)]">Delete</button>
            </li>
          ))}
        </ul>
      )}
    </AdminSection>
  );
}

function AdminEnquiries({ token, admin, refresh }: { token: string; admin: AdminData; refresh: () => void }) {
  const mutation = useMutation({
    mutationFn: (args: { id: number; handled: boolean }) => api.adminMarkEnquiry({ token, ...args }),
    onSuccess: refresh,
  });
  const open = admin.enquiries.filter((e) => !e.handled);
  const done = admin.enquiries.filter((e) => e.handled);
  const renderList = (list: AdminData["enquiries"]) => (
    <ul className="space-y-2">
      {list.map((e) => (
        <li key={e.id} className="rounded-2xl border border-[var(--border)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">
              {e.name} <span className="ml-1 rounded-full bg-[var(--surface-alt)] px-2 py-0.5 text-xs font-bold uppercase">{e.kind}</span>
            </p>
            <p className="text-sm text-[var(--dim)]">{new Date(e.createdAt).toLocaleString("en-IN")}</p>
          </div>
          <p className="mt-1 text-sm">📞 {e.phone}{e.business ? ` · ${e.business}` : ""}{e.planName ? ` · Plan: ${e.planName}` : ""}</p>
          {e.message && <p className="mt-1 text-sm text-[var(--dim)]">{e.message}</p>}
          <button type="button" onClick={() => mutation.mutate({ id: e.id, handled: !e.handled })} className="mt-2 min-h-9 rounded-lg border border-[var(--border)] bg-white px-3 text-sm font-bold">
            {e.handled ? "Reopen" : "Mark handled ✓"}
          </button>
        </li>
      ))}
    </ul>
  );
  return (
    <AdminSection title={`Enquiries (${open.length} open)`} sub="Bulk, subscription and contact requests from customers.">
      {open.length === 0 && done.length === 0 && <p className="text-sm text-[var(--dim)]">No enquiries yet.</p>}
      {open.length > 0 && renderList(open)}
      {done.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-bold">Handled ({done.length})</summary>
          <div className="mt-3">{renderList(done)}</div>
        </details>
      )}
    </AdminSection>
  );
}

function AdminSettings({ token, admin, refresh }: { token: string; admin: AdminData; refresh: () => void }) {
  const s = admin.settings;
  const [freeKm, setFreeKm] = useState(s["free_radius_km"] ?? "3");
  const [perKm, setPerKm] = useState(String((Number(s["per_km_paise"] ?? "1000") || 0) / 100));
  const [minOrder, setMinOrder] = useState(String((Number(s["min_order_paise"] ?? "0") || 0) / 100));
  const [upiId, setUpiId] = useState(s["upi_id"] ?? "");
  const [upiName, setUpiName] = useState(s["upi_name"] ?? "Red Rooster");
  const [phone, setPhone] = useState(s["store_phone"] ?? "");
  const [whatsapp, setWhatsapp] = useState(s["store_whatsapp"] ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      api.adminSaveSettings({
        token,
        freeRadiusKm: Number(freeKm) || 0,
        perKmRupees: Number(perKm) || 0,
        minOrderRupees: Number(minOrder) || 0,
        upiId,
        upiName,
        storePhone: phone,
        storeWhatsapp: whatsapp,
      }),
    onSuccess: () => { setSaved(true); setError(""); refresh(); },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not save settings."),
  });
  return (
    <AdminSection title="Store settings" sub="Delivery pricing, your UPI ID for payments, and contact numbers.">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); setSaved(false); mutation.mutate(); }}>
        <div>
          <label htmlFor="st-free" className="mb-1 block text-sm font-semibold">Free delivery radius (km)</label>
          <input id="st-free" type="number" min={0} step="0.5" className={adminInput} value={freeKm} onChange={(e) => setFreeKm(e.target.value)} />
        </div>
        <div>
          <label htmlFor="st-perkm" className="mb-1 block text-sm font-semibold">Charge per extra km (₹)</label>
          <input id="st-perkm" type="number" min={0} step="0.5" className={adminInput} value={perKm} onChange={(e) => setPerKm(e.target.value)} />
        </div>
        <div>
          <label htmlFor="st-min" className="mb-1 block text-sm font-semibold">Minimum order (₹, 0 = none)</label>
          <input id="st-min" type="number" min={0} className={adminInput} value={minOrder} onChange={(e) => setMinOrder(e.target.value)} />
        </div>
        <div>
          <label htmlFor="st-upiname" className="mb-1 block text-sm font-semibold">UPI account name</label>
          <input id="st-upiname" className={adminInput} value={upiName} onChange={(e) => setUpiName(e.target.value)} placeholder="Red Rooster" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="st-upi" className="mb-1 block text-sm font-semibold">Your UPI ID (customers pay directly to this ID)</label>
          <input id="st-upi" className={adminInput} value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="e.g. yourname@okhdfcbank" />
          <p className="mt-1 text-xs text-[var(--dim)]">This is your own payment gateway — UPI money lands straight in your bank account. The website never touches or stores anyone&apos;s card or UPI PIN.</p>
        </div>
        <div>
          <label htmlFor="st-phone" className="mb-1 block text-sm font-semibold">Store phone (shown on Contact page)</label>
          <input id="st-phone" className={adminInput} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit number" />
        </div>
        <div>
          <label htmlFor="st-wa" className="mb-1 block text-sm font-semibold">WhatsApp number</label>
          <input id="st-wa" className={adminInput} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="10-digit number" />
        </div>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button type="submit" disabled={mutation.isPending} className="min-h-11 rounded-xl bg-[var(--accent)] px-5 text-sm font-bold text-white disabled:opacity-60">
            {mutation.isPending ? "Saving…" : "Save settings"}
          </button>
          {saved && <span className="text-sm font-bold text-[#2e7d32]">Saved ✓</span>}
        </div>
        {error && <p className="rounded-lg bg-[#fbe9ea] px-3 py-2 text-sm font-medium text-[var(--accent-dark)] sm:col-span-2">{error}</p>}
      </form>
    </AdminSection>
  );
}

function AdminSecurity() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: () => {
      const token = (() => {
        try {
          return localStorage.getItem(ADMIN_TOKEN_KEY) ?? "";
        } catch {
          return "";
        }
      })();
      return api.adminChangePassword({ token, currentPassword: current, newPassword: next });
    },
    onSuccess: (res) => {
      try {
        localStorage.setItem(ADMIN_TOKEN_KEY, res.token);
      } catch {
        /* ignore */
      }
      setCurrent("");
      setNext("");
      setMsg("Password changed. Other sessions are now logged out.");
      setError("");
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not change password."),
  });
  return (
    <AdminSection title="Security" sub="Change your admin password. Passwords are hashed on the server; login attempts are rate-limited.">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}>
        <div>
          <label htmlFor="sec-current" className="mb-1 block text-sm font-semibold">Current password</label>
          <input id="sec-current" type="password" className={adminInput} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </div>
        <div>
          <label htmlFor="sec-new" className="mb-1 block text-sm font-semibold">New password (min 8 characters)</label>
          <input id="sec-new" type="password" className={adminInput} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </div>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button type="submit" disabled={next.length < 8 || mutation.isPending} className="min-h-11 rounded-xl bg-[var(--accent)] px-5 text-sm font-bold text-white disabled:opacity-60">
            Change password
          </button>
          {msg && <span className="text-sm font-bold text-[#2e7d32]">{msg}</span>}
        </div>
        {error && <p className="rounded-lg bg-[#fbe9ea] px-3 py-2 text-sm font-medium text-[var(--accent-dark)] sm:col-span-2">{error}</p>}
      </form>
    </AdminSection>
  );
}

// ------------------------------------------------------------------ shell
const NAV: { route: Route; label: string }[] = [
  { route: { name: "home" }, label: "Home" },
  { route: { name: "shop" }, label: "Shop" },
  { route: { name: "subscriptions" }, label: "Plans" },
  { route: { name: "recipes" }, label: "Recipes" },
  { route: { name: "delivery" }, label: "Delivery" },
  { route: { name: "about" }, label: "About" },
  { route: { name: "contact" }, label: "Contact" },
];

const FOOTER_LINKS: { route: Route; label: string }[] = [
  { route: { name: "shop" }, label: "Shop" },
  { route: { name: "subscriptions" }, label: "Subscription Plans" },
  { route: { name: "quality" }, label: "Our Quality Process" },
  { route: { name: "bulk" }, label: "Bulk Orders (B2B)" },
  { route: { name: "recipes" }, label: "Recipes" },
  { route: { name: "delivery" }, label: "Delivery Areas & Charges" },
  { route: { name: "faq" }, label: "FAQ" },
  { route: { name: "about" }, label: "About Us" },
  { route: { name: "contact" }, label: "Contact" },
  { route: { name: "track" }, label: "Track Order" },
  { route: { name: "admin" }, label: "Owner Admin" },
];

export function App() {
  const [route, setRoute] = useState<Route>({ name: "home" });
  const [cart, setCart] = useState<CartMap>(loadCart);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");

  const storefront = useQuery({
    queryKey: ["storefront"],
    queryFn: () => api.getStorefront({}),
  });

  useEffect(() => {
    try {
      localStorage.setItem("rr-cart", JSON.stringify(cart));
    } catch {
      /* ignore */
    }
  }, [cart]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    setMenuOpen(false);
  }, [route]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const go = (r: Route) => setRoute(r);
  const setQty = (id: number, q: number) => {
    setCart((prev) => {
      const next = { ...prev };
      if (q <= 0) delete next[id];
      else next[id] = Math.min(q, 200);
      return next;
    });
    if (q > 0 && (cart[id] ?? 0) === 0) {
      const p = storefront.data?.products.find((x) => x.id === id);
      if (p) setToast(`${p.name} added to cart`);
    }
  };
  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);
  const cartTotal = storefront.data
    ? storefront.data.products.reduce((sum, p) => sum + p.pricePaise * (cart[p.id] ?? 0), 0)
    : 0;

  const onOrderPlaced = (order: Order) => {
    setCart({});
    try {
      localStorage.setItem("rr-last-code", order.code);
      localStorage.setItem("rr-last-phone", order.phone);
    } catch {
      /* ignore */
    }
  };

  const data = storefront.data;
  const isActive = (r: Route) =>
    r.name === route.name || (r.name === "shop" && route.name === "product");

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg)]/95 pt-safe backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2.5 sm:gap-3">
          <button type="button" onClick={() => go({ name: "home" })} className="flex min-w-0 items-center gap-2.5" aria-label="Red Rooster home">
            <img src={logoUrl} alt="Red Rooster logo" className="h-11 w-11 shrink-0 rounded-full border border-[var(--border)] object-cover" />
            <span className="text-left leading-tight">
              <span className="font-display block truncate text-xl font-extrabold text-[var(--accent)]">Red Rooster</span>
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--dim)]">Brown Desi Eggs · Kalka–Pinjore</span>
            </span>
          </button>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <button type="button" onClick={() => go({ name: "track" })} className="hidden min-h-10 items-center rounded-xl px-3 text-sm font-bold text-[var(--accent)] min-[420px]:flex">
              Track Order
            </button>
            <button
              type="button"
              onClick={() => go({ name: "cart" })}
              className="relative flex min-h-10 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3.5 text-sm font-bold text-white"
              aria-label={`Cart, ${cartCount} items`}
            >
              🛒 Cart
              {cartCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--gold)] px-1 text-xs font-extrabold text-[#2b2118]">{cartCount}</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-expanded={menuOpen}
              aria-label="Open menu"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-xl"
            >
              ☰
            </button>
          </div>
        </div>
        <nav className="hidden border-t border-[var(--border)] lg:block" aria-label="Main">
          <ul className="mx-auto flex max-w-6xl items-center gap-1 px-4">
            {NAV.map((n) => (
              <li key={n.label}>
                <button
                  type="button"
                  onClick={() => go(n.route)}
                  aria-current={isActive(n.route) ? "page" : undefined}
                  className={`min-h-10 px-3.5 text-sm font-semibold ${isActive(n.route) ? "text-[var(--accent)] underline decoration-[var(--gold)] decoration-2 underline-offset-4" : "text-[var(--text)]"}`}
                >
                  {n.label}
                </button>
              </li>
            ))}
            <li className="ml-auto">
              <button type="button" onClick={() => go({ name: "bulk" })} className="min-h-10 px-3.5 text-sm font-semibold">
                Bulk Orders
              </button>
            </li>
            <li>
              <button type="button" onClick={() => go({ name: "faq" })} className="min-h-10 px-3.5 text-sm font-semibold">FAQ</button>
            </li>
            <li>
              <button type="button" onClick={() => go({ name: "quality" })} className="min-h-10 px-3.5 text-sm font-semibold">Quality</button>
            </li>
          </ul>
        </nav>
        {menuOpen && (
          <nav className="border-t border-[var(--border)] bg-[var(--surface)] lg:hidden" aria-label="Menu">
            <ul className="mx-auto grid max-w-6xl grid-cols-2 gap-1 px-4 py-3">
              {FOOTER_LINKS.map((n) => (
                <li key={n.label}>
                  <button type="button" onClick={() => go(n.route)} className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-semibold hover:bg-[var(--surface-alt)]">
                    {n.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>

      {/* Main */}
      <main className="mx-auto max-w-6xl px-4 pb-28 pt-5 lg:pb-14">
        {storefront.isPending && route.name !== "admin" && (
          <p className="py-16 text-center text-sm text-[var(--dim)]">Loading the farm shop…</p>
        )}
        {storefront.isError && route.name !== "admin" && (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-10 text-center">
            <p className="font-semibold">The shop could not load.</p>
            <button type="button" onClick={() => void storefront.refetch()} className="mt-4 min-h-11 rounded-xl bg-[var(--accent)] px-5 text-sm font-bold text-white">
              Try again
            </button>
          </div>
        )}
        {data && route.name === "home" && <HomePage data={data} cart={cart} setQty={setQty} go={go} />}
        {data && route.name === "shop" && <ShopPage data={data} cart={cart} setQty={setQty} go={go} />}
        {data && route.name === "product" && <ProductPage data={data} id={route.id} cart={cart} setQty={setQty} go={go} />}
        {data && route.name === "subscriptions" && <SubscriptionsPage data={data} />}
        {route.name === "about" && <AboutPage />}
        {route.name === "quality" && <QualityPage />}
        {route.name === "bulk" && <BulkPage />}
        {route.name === "recipes" && <RecipesPage />}
        {data && route.name === "delivery" && <DeliveryPage data={data} />}
        {route.name === "faq" && <FaqPage />}
        {data && route.name === "contact" && <ContactPage data={data} />}
        {data && route.name === "cart" && <CartPage data={data} cart={cart} setQty={setQty} go={go} onOrderPlaced={onOrderPlaced} />}
        {route.name === "track" && <TrackPage />}
        {route.name === "admin" && <AdminPage go={go} />}
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] bg-[var(--surface)] pb-24 lg:pb-8">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3">
          <div>
            <div className="flex items-center gap-2.5">
              <img src={logoUrl} alt="" className="h-11 w-11 rounded-full border border-[var(--border)] object-cover" />
              <p className="font-display text-lg font-extrabold text-[var(--accent)]">Red Rooster</p>
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-[var(--dim)]">
              Farm-fresh brown desi eggs from Kalka–Pinjore, delivered to your door. Collected in the
              morning, at your home the same day.
            </p>
          </div>
          <nav aria-label="Footer">
            <p className="text-sm font-bold uppercase tracking-wide text-[var(--dim)]">Explore</p>
            <ul className="mt-3 grid grid-cols-2 gap-x-4">
              {FOOTER_LINKS.map((n) => (
                <li key={n.label}>
                  <button type="button" onClick={() => go(n.route)} className="min-h-9 text-sm font-medium">{n.label}</button>
                </li>
              ))}
            </ul>
          </nav>
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-[var(--dim)]">Delivery promise</p>
            <p className="mt-3 text-sm leading-relaxed text-[var(--dim)]">
              Free delivery within {data?.settings.freeRadiusKm ?? 3} km of Kalka. Serving Kalka,
              Pinjore and nearby villages — morning, midday and evening slots.
            </p>
            <button type="button" onClick={() => go({ name: "track" })} className="mt-3 min-h-9 text-sm font-bold text-[var(--accent)]">
              Track your order →
            </button>
          </div>
        </div>
        <p className="border-t border-[var(--border)] px-4 py-4 text-center text-xs text-[var(--dim)]">
          Red Rooster · Brown desi eggs · Kalka — Pinjore, Haryana
        </p>
      </footer>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-[var(--surface)] pb-safe lg:hidden" aria-label="Bottom">
        <ul className="grid grid-cols-5">
          {[
            { route: { name: "home" } as Route, label: "Home", icon: "🏠" },
            { route: { name: "shop" } as Route, label: "Shop", icon: "🥚" },
            { route: { name: "subscriptions" } as Route, label: "Plans", icon: "📅" },
            { route: { name: "track" } as Route, label: "Track", icon: "🚚" },
            { route: { name: "cart" } as Route, label: "Cart", icon: "🛒" },
          ].map((n) => (
            <li key={n.label}>
              <button
                type="button"
                onClick={() => go(n.route)}
                aria-current={isActive(n.route) ? "page" : undefined}
                className={`relative flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-xs font-semibold ${isActive(n.route) ? "text-[var(--accent)]" : "text-[var(--dim)]"}`}
              >
                <span className="text-lg leading-none" aria-hidden>{n.icon}</span>
                {n.label}
                {n.label === "Cart" && cartCount > 0 && (
                  <span className="absolute right-[18%] top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[11px] font-extrabold text-white">{cartCount}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Sticky cart bar (mobile, when cart has items and not on cart page) */}
      {cartCount > 0 && route.name !== "cart" && route.name !== "admin" && (
        <button
          type="button"
          onClick={() => go({ name: "cart" })}
          className="fixed inset-x-4 bottom-[76px] z-30 flex min-h-13 items-center justify-between rounded-2xl bg-[var(--accent)] px-5 py-3.5 text-white shadow-xl lg:hidden"
          aria-label={`View cart, ${cartCount} items, total ${inr(cartTotal)}`}
        >
          <span className="text-sm font-bold">{cartCount} item{cartCount > 1 ? "s" : ""} · {inr(cartTotal)}</span>
          <span className="text-sm font-extrabold">View Cart →</span>
        </button>
      )}

      {toast && (
        <div className="fixed inset-x-0 bottom-36 z-40 flex justify-center lg:bottom-10" role="status">
          <p className="rounded-full bg-[#2b2118] px-4 py-2 text-sm font-semibold text-white shadow-lg">{toast}</p>
        </div>
      )}
    </div>
  );
}
