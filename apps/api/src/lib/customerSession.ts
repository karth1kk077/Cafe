import jwt from "jsonwebtoken";
import { config } from "../config/index.js";
import { UnauthorizedError } from "./errors.js";

/**
 * A session-scoped, account-less credential handed to a customer after the
 * QR table context is resolved. It binds the browser to exactly one dining
 * session so that:
 *   - an order can only ever target the session it was authorized for, and
 *   - a page holding a stale (closed) session's token can never be silently
 *     reused for the next group at the same table (spec 1, 6.1, 11.4).
 */
export interface CustomerSessionClaim {
  scope: "customer";
  sessionId: string;
  tableId: string;
}

export function signCustomerSessionToken(sessionId: string, tableId: string): string {
  const claim: CustomerSessionClaim = { scope: "customer", sessionId, tableId };
  return jwt.sign(claim, config.JWT_SECRET, { expiresIn: "6h" });
}

export function verifyCustomerSessionToken(token: string): CustomerSessionClaim {
  const decoded = jwt.verify(token, config.JWT_SECRET) as Partial<CustomerSessionClaim>;
  if (decoded?.scope !== "customer" || typeof decoded.sessionId !== "string" || typeof decoded.tableId !== "string") {
    throw new UnauthorizedError("Invalid session token");
  }
  return { scope: "customer", sessionId: decoded.sessionId, tableId: decoded.tableId };
}

/** Read a customer session token from the `x-session-token` header. */
export function readCustomerSessionToken(header: unknown): string | null {
  if (typeof header === "string" && header.length > 0) return header;
  return null;
}
