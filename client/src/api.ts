// Typed API client for the plain Render server.
//
// Same method names and response shapes as the original space actions.
// Each call POSTs its args as JSON to /api/<action> and returns the
// parsed response, or throws an Error with the server's message.
// No server code is imported here — the client bundle stays browser-only.

export interface ProductOut {
  id: number;
  name: string;
  category: string;
  packLabel: string;
  eggsCount: number;
  pricePaise: number;
  mrpPaise: number | null;
  description: string;
  imageUrl: string | null;
  stockStatus: string;
  featured: boolean;
  sortOrder: number;
  active: boolean;
}

export interface PlanOut {
  id: number;
  name: string;
  description: string;
  traysPerWeek: number;
  pricePaise: number;
}

export interface AdminPlanOut extends PlanOut {
  active: boolean;
}

export interface ZoneOut {
  id: number;
  name: string;
  distanceKm: number;
  feePaise: number;
}

export interface AdminZoneOut {
  id: number;
  name: string;
  distanceKm: number;
  active: boolean;
}

export interface Storefront {
  products: ProductOut[];
  plans: PlanOut[];
  zones: ZoneOut[];
  settings: {
    freeRadiusKm: number;
    perKmPaise: number;
    minOrderPaise: number;
    upiId: string;
    upiName: string;
    storePhone: string;
    storeWhatsapp: string;
  };
}

export interface OrderItem {
  productId: number;
  name: string;
  packLabel: string;
  qty: number;
  unitPricePaise: number;
}

export interface OrderOut {
  id: number;
  code: string;
  customerName: string;
  phone: string;
  address: string;
  zoneName: string;
  slot: string;
  items: OrderItem[];
  subtotalPaise: number;
  deliveryFeePaise: number;
  totalPaise: number;
  paymentMethod: string;
  paymentStatus: string;
  upiRef: string | null;
  status: string;
  note: string;
  createdAt: string;
}

export interface EnquiryOut {
  id: number;
  kind: string;
  name: string;
  phone: string;
  business: string;
  planName: string;
  message: string;
  handled: boolean;
  createdAt: string;
}

export interface AdminDataOut {
  products: ProductOut[];
  plans: AdminPlanOut[];
  zones: AdminZoneOut[];
  settings: Record<string, string>;
  orders: OrderOut[];
  enquiries: EnquiryOut[];
}

export interface AdminSaveProductArgs {
  token: string;
  id: number | null;
  name: string;
  category: string;
  packLabel: string;
  eggsCount: number;
  pricePaise: number;
  mrpPaise: number | null;
  description: string;
  stockStatus: "in_stock" | "low_stock" | "out_of_stock";
  featured: boolean;
  sortOrder: number;
  active: boolean;
  image: { dataBase64: string; mimeType: string } | null;
  removeImage: boolean;
}

export interface AdminSaveSettingsArgs {
  token: string;
  freeRadiusKm: number;
  perKmRupees: number;
  minOrderRupees: number;
  upiId: string;
  upiName: string;
  storePhone: string;
  storeWhatsapp: string;
}

async function call<T>(name: string, args: unknown): Promise<T> {
  const res = await fetch(`/api/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args ?? {}),
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : "Something went wrong. Please try again.";
    throw new Error(message);
  }
  return data as T;
}

export const api = {
  getStorefront: (args: Record<string, never>): Promise<Storefront> =>
    call("getStorefront", args),
  placeOrder: (args: {
    customerName: string;
    phone: string;
    address: string;
    zoneId: number;
    slot: string;
    items: { productId: number; qty: number }[];
    paymentMethod: "upi" | "cod";
    note: string;
  }): Promise<{ order: OrderOut }> => call("placeOrder", args),
  getUpiPayment: (args: { code: string; phone: string }): Promise<{
    upiId: string;
    upiName: string;
    amountPaise: number;
    upiUrl: string;
    qrSvg: string | null;
  }> => call("getUpiPayment", args),
  submitUpiRef: (args: { code: string; phone: string; upiRef: string }): Promise<{ ok: true }> =>
    call("submitUpiRef", args),
  trackOrder: (args: { code: string; phone: string }): Promise<{ order: OrderOut }> =>
    call("trackOrder", args),
  submitEnquiry: (args: {
    kind: "bulk" | "subscription" | "contact";
    name: string;
    phone: string;
    business: string;
    planId: number | null;
    message: string;
  }): Promise<{ ok: true }> => call("submitEnquiry", args),
  adminStatus: (args: { token?: string }): Promise<{ hasAccount: boolean; authed: boolean }> =>
    call("adminStatus", args),
  adminSetup: (args: { password: string }): Promise<{ token: string }> =>
    call("adminSetup", args),
  adminLogin: (args: { password: string }): Promise<{ token: string }> =>
    call("adminLogin", args),
  adminChangePassword: (args: {
    token: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<{ token: string }> => call("adminChangePassword", args),
  adminData: (args: { token: string }): Promise<AdminDataOut> => call("adminData", args),
  adminSaveProduct: (args: AdminSaveProductArgs): Promise<{ id: number }> =>
    call("adminSaveProduct", args),
  adminDeleteProduct: (args: { token: string; id: number }): Promise<{ ok: true }> =>
    call("adminDeleteProduct", args),
  adminSavePlan: (args: {
    token: string;
    id: number | null;
    name: string;
    description: string;
    traysPerWeek: number;
    pricePaise: number;
    active: boolean;
    sortOrder: number;
  }): Promise<{ id: number }> => call("adminSavePlan", args),
  adminDeletePlan: (args: { token: string; id: number }): Promise<{ ok: true }> =>
    call("adminDeletePlan", args),
  adminSaveZone: (args: {
    token: string;
    id: number | null;
    name: string;
    distanceKm: number;
    active: boolean;
  }): Promise<{ id: number }> => call("adminSaveZone", args),
  adminDeleteZone: (args: { token: string; id: number }): Promise<{ ok: true }> =>
    call("adminDeleteZone", args),
  adminSaveSettings: (args: AdminSaveSettingsArgs): Promise<{ ok: true }> =>
    call("adminSaveSettings", args),
  adminUpdateOrder: (args: {
    token: string;
    id: number;
    status?: "placed" | "confirmed" | "out_for_delivery" | "delivered" | "cancelled";
    paymentStatus?: "pending" | "paid" | "cod_pending";
  }): Promise<{ ok: true }> => call("adminUpdateOrder", args),
  adminMarkEnquiry: (args: { token: string; id: number; handled: boolean }): Promise<{ ok: true }> =>
    call("adminMarkEnquiry", args),
};

// Response type helper, same shape as before so App.tsx types still work:
//   type Storefront = ApiResponse<typeof api, "getStorefront">;
export type ApiResponse<T, K extends keyof T> = T[K] extends (...args: never[]) => Promise<infer R>
  ? R
  : never;
export type ApiRequest<T, K extends keyof T> = T[K] extends (args: infer A) => unknown ? A : never;

/** Read a File (product photo) as base64 for upload to the server. */
export function fileToBase64(file: File): Promise<{ dataBase64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const dataBase64 = result.includes(",") ? (result.split(",")[1] ?? "") : result;
      resolve({ dataBase64, mimeType: file.type });
    };
    reader.onerror = () => reject(new Error("Could not read that image file."));
    reader.readAsDataURL(file);
  });
}
