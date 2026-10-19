import type { Role } from "@cafe/shared";

// Per-line-item preparation states (spec 11.1).
export type ItemStatus = "QUEUED" | "PREPARING" | "READY" | "SERVED" | "CANCELLED";

// Derived order-level summary (spec 11.2).
export type OrderSummary =
  | "RECEIVED"
  | "IN_PROGRESS"
  | "PARTIALLY_READY"
  | "READY"
  | "COMPLETED"
  | "CANCELLED";

/**
 * Central transition table for order line items (spec 7.2 / 11.1).
 *
 * The frontend never decides which transitions are legal: this map encodes both
 * the legal target states and the roles allowed to perform them.
 *
 *   QUEUED    -> PREPARING (kitchen), CANCELLED (kitchen/waiter/admin)
 *   PREPARING -> READY     (kitchen), CANCELLED (waiter/admin)
 *   READY     -> SERVED    (waiter),  CANCELLED (admin override)
 *   SERVED    -> (terminal)
 *   CANCELLED -> (terminal)
 *
 * Cancellation after preparation has begun requires supervisor authorization
 * (waiter/admin), matching the safe default for the spec's open question (§21).
 */
export const ITEM_TRANSITIONS: Record<ItemStatus, Partial<Record<ItemStatus, Role[]>>> = {
  QUEUED: {
    PREPARING: ["KITCHEN", "ADMIN"],
    CANCELLED: ["KITCHEN", "WAITER", "ADMIN"],
  },
  PREPARING: {
    READY: ["KITCHEN", "ADMIN"],
    CANCELLED: ["WAITER", "ADMIN"],
  },
  READY: {
    SERVED: ["WAITER", "ADMIN"],
    CANCELLED: ["ADMIN"],
  },
  SERVED: {},
  CANCELLED: {},
};

export function allowedTargets(from: ItemStatus): ItemStatus[] {
  return Object.keys(ITEM_TRANSITIONS[from] ?? {}) as ItemStatus[];
}

export function isTransitionAllowed(from: ItemStatus, to: ItemStatus): boolean {
  return Boolean(ITEM_TRANSITIONS[from]?.[to]);
}

export function canRoleTransition(role: Role | string, from: ItemStatus, to: ItemStatus): boolean {
  const roles = ITEM_TRANSITIONS[from]?.[to];
  return Boolean(roles && roles.includes(role as Role));
}

/** Timestamp field to stamp when an item enters a given state. */
export function timestampFieldFor(status: ItemStatus): "preparingAt" | "readyAt" | "servedAt" | "cancelledAt" | null {
  switch (status) {
    case "PREPARING":
      return "preparingAt";
    case "READY":
      return "readyAt";
    case "SERVED":
      return "servedAt";
    case "CANCELLED":
      return "cancelledAt";
    default:
      return null;
  }
}

/**
 * Derive the order-level summary from its line items (spec 11.2).
 *
 * Rules (evaluated over non-cancelled items):
 *  - no items at all                 -> CANCELLED (empty orders are prevented upstream)
 *  - every non-cancelled item SERVED -> COMPLETED
 *  - every non-cancelled READY/SERVED-> READY
 *  - some (but not all) READY/SERVED -> PARTIALLY_READY
 *  - otherwise some item PREPARING   -> IN_PROGRESS
 *  - otherwise (all still QUEUED)    -> RECEIVED
 */
export function deriveOrderSummary(items: Array<{ status: ItemStatus }>): OrderSummary {
  if (items.length === 0) return "CANCELLED";
  const active = items.filter((i) => i.status !== "CANCELLED");
  if (active.length === 0) return "CANCELLED";
  if (active.every((i) => i.status === "SERVED")) return "COMPLETED";
  if (active.every((i) => i.status === "READY" || i.status === "SERVED")) return "READY";
  if (active.some((i) => i.status === "READY" || i.status === "SERVED")) return "PARTIALLY_READY";
  if (active.some((i) => i.status === "PREPARING")) return "IN_PROGRESS";
  return "RECEIVED";
}
