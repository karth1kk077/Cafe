import { config } from "../config/index.js";

/**
 * Canonical public URL encoded into a table's QR code.
 *
 * Built from the configured public base URL (never a hard-coded host) plus the
 * table's opaque token. The URL carries no internal database IDs, table/session
 * status, or authorization data: eligibility is resolved server-side on every
 * lookup and order submission.
 */
export function buildTableQrUrl(qrToken: string): string {
  const base = config.PUBLIC_APP_BASE_URL.replace(/\/+$/, "");
  return `${base}/t/${qrToken}`;
}
