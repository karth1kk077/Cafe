const BASE = "/api";

interface RequestOptions extends RequestInit {
  /** Session-scoped customer token, sent as `x-session-token`. */
  sessionToken?: string | null;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { sessionToken, ...init } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) || {}),
  };
  if (sessionToken) headers["x-session-token"] = sessionToken;

  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    ...init,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: { message?: string } })?.error?.message || `Request failed (${res.status})`;
    const err = new Error(msg) as Error & { status?: number; code?: string };
    err.status = res.status;
    err.code = (data as { error?: { code?: string } })?.error?.code;
    throw err;
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, sessionToken?: string | null) => request<T>(path, { sessionToken }),
  post: <T>(path: string, body?: unknown, sessionToken?: string | null) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined, sessionToken }),
  patch: <T>(path: string, body?: unknown, sessionToken?: string | null) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined, sessionToken }),
};

export type OrderItemStatus = "QUEUED" | "PREPARING" | "READY" | "SERVED" | "CANCELLED";
export type OrderStatus =
  | "RECEIVED"
  | "IN_PROGRESS"
  | "PARTIALLY_READY"
  | "READY"
  | "COMPLETED"
  | "CANCELLED";

export interface PublicMenuResponse {
  categories: Array<{
    id: string;
    name: string;
    items: Array<{
      id: string;
      name: string;
      description?: string;
      priceMinor: number;
      imageUrl?: string;
      isAvailable?: boolean;
      dietaryTags: string[];
      allergens: string[];
      variants: Array<{ id: string; name: string; priceDeltaMinor: number }>;
      addons: Array<{ id: string; name: string; priceMinor: number }>;
    }>;
  }>;
  settings: { cafeName: string; currency: string };
}

export type PublicMenuCategory = PublicMenuResponse["categories"][number];
export type PublicMenuItem = PublicMenuCategory["items"][number];

export interface TableResponse {
  /** Internal IDs are never exposed on public endpoints. */
  table: { number: string; status: string };
  session: { id: string; status: string; openedAt: string } | null;
  canOrder: boolean;
  /** An AVAILABLE table can be ordered from; the session opens on first order. */
  orderable?: boolean;
  /** Present only when the table has an orderable session. */
  sessionToken: string | null;
}

export interface CustomerBillResponse {
  bill: {
    id: string | null;
    billNumber: string | null;
    status: string;
    subtotalMinor: number;
    taxMinor: number;
    serviceChargeMinor: number;
    discountMinor: number;
    roundingMinor: number;
    totalMinor: number;
    currency: string;
    createdAt: string;
    lineItems: Array<{
      id: string;
      nameSnapshot: string;
      quantity: number;
      unitPriceMinor: number;
      lineTotalMinor: number;
    }>;
    payments: Array<{ id: string; amountMinor: number; method: string; status: string; createdAt: string }>;
  };
  paidMinor: number;
  dueMinor: number;
  isPreview: boolean;
  settings: { cafeName: string; currency: string; upiId: string | null };
}

export interface OrderItemResponse {
  id: string;
  nameSnapshot: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  status: OrderItemStatus;
  specialInstructions?: string | null;
  readyAt?: string | null;
  servedAt?: string | null;
  addons: Array<{ nameSnapshot: string; priceSnapshotMinor: number }>;
}

export interface OrderResponse {
  order: {
    id: string;
    orderNumber: string;
    status: OrderStatus;
    totalMinor: number;
    createdAt: string;
    items: OrderItemResponse[];
  };
}

export interface SessionOrdersResponse {
  session: { id: string; status: string };
  orders: Array<{
    id: string;
    orderNumber: string;
    status: OrderStatus;
    totalMinor: number;
    createdAt: string;
    items: Array<{
      id: string;
      nameSnapshot: string;
      quantity: number;
      lineTotalMinor: number;
      status: OrderItemStatus;
    }>;
  }>;
}

export function formatMoney(minor: number, currency = "INR"): string {
  const symbol = currency === "INR" ? "\u20b9" : "";
  return `${symbol}${(minor / 100).toFixed(2)}`;
}
