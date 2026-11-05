/**
 * Persist the session-scoped customer credential per table. Storing both the
 * token and the session id lets the menu and order-tracking screens share the
 * same authorization, and lets the tracking screen keep working (read-only)
 * after the session has been closed. A saved QR page that belongs to a closed
 * session is rejected by the server with a 409 SESSION_CLOSED.
 */
export interface StoredSession {
  token: string;
  sessionId: string;
}

const KEY = (tableCode: string) => `cafe_session:${tableCode}`;
const CART_KEY = (tableCode: string) => `cafe_cart:${tableCode}`;

export interface StoredCartLine {
  key: string;
  menuItemId: string;
  name: string;
  variantId?: string;
  variantName?: string;
  addonIds: string[];
  addonNames: string[];
  unitPriceMinor: number;
  quantity: number;
  specialInstructions?: string;
}

export function saveCart(tableCode: string, cart: StoredCartLine[]): void {
  try {
    if (cart.length) localStorage.setItem(CART_KEY(tableCode), JSON.stringify(cart));
    else localStorage.removeItem(CART_KEY(tableCode));
  } catch {
    /* storage unavailable */
  }
}

export function loadCart(tableCode: string): StoredCartLine[] {
  try {
    const raw = localStorage.getItem(CART_KEY(tableCode));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredCartLine[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSession(tableCode: string, session: StoredSession | null): void {
  try {
    if (session) localStorage.setItem(KEY(tableCode), JSON.stringify(session));
    else localStorage.removeItem(KEY(tableCode));
  } catch {
    /* storage unavailable */
  }
}

export function loadSession(tableCode: string): StoredSession | null {
  try {
    const raw = localStorage.getItem(KEY(tableCode));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.token || !parsed?.sessionId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearSession(tableCode: string): void {
  saveSession(tableCode, null);
}
