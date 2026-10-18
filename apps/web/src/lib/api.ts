const BASE = "/api";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
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
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
};

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
      dietaryTags: string[];
      allergens: string[];
      variants: Array<{ id: string; name: string; priceDeltaMinor: number }>;
      addons: Array<{ id: string; name: string; priceMinor: number }>;
    }>;
  }>;
  settings: { cafeName: string; currency: string };
}

export interface TableResponse {
  table: { id: string; number: string; status: string };
  session: { id: string; status: string; openedAt: string } | null;
  canOrder: boolean;
}

export interface OrderResponse {
  order: {
    id: string;
    orderNumber: string;
    status: string;
    totalMinor: number;
    createdAt: string;
    items: Array<{
      id: string;
      nameSnapshot: string;
      quantity: number;
      unitPriceMinor: number;
      lineTotalMinor: number;
      specialInstructions?: string;
      addons: Array<{ nameSnapshot: string; priceSnapshotMinor: number }>;
    }>;
  };
}

export interface SessionOrdersResponse {
  session: { id: string; status: string };
  orders: Array<{
    id: string;
    orderNumber: string;
    status: string;
    totalMinor: number;
    createdAt: string;
    items: Array<{ id: string; nameSnapshot: string; quantity: number; lineTotalMinor: number }>;
  }>;
}

export function formatMoney(minor: number, currency = "INR"): string {
  const symbol = currency === "INR" ? "\u20b9" : "";
  return `${symbol}${(minor / 100).toFixed(2)}`;
}
