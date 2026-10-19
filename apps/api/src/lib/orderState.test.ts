import { describe, it, expect } from "vitest";
import {
  canRoleTransition,
  deriveOrderSummary,
  isTransitionAllowed,
  timestampFieldFor,
  type ItemStatus,
} from "./orderState.js";

describe("orderState transitions", () => {
  it("allows the documented forward path", () => {
    expect(isTransitionAllowed("QUEUED", "PREPARING")).toBe(true);
    expect(isTransitionAllowed("PREPARING", "READY")).toBe(true);
    expect(isTransitionAllowed("READY", "SERVED")).toBe(true);
  });

  it("rejects skipping stages", () => {
    expect(isTransitionAllowed("QUEUED", "READY")).toBe(false);
    expect(isTransitionAllowed("QUEUED", "SERVED")).toBe(false);
    expect(isTransitionAllowed("PREPARING", "SERVED")).toBe(false);
  });

  it("treats SERVED and CANCELLED as terminal", () => {
    expect(isTransitionAllowed("SERVED", "CANCELLED")).toBe(false);
    expect(isTransitionAllowed("CANCELLED", "QUEUED")).toBe(false);
    expect(isTransitionAllowed("CANCELLED", "PREPARING")).toBe(false);
  });

  it("gates transitions by role", () => {
    expect(canRoleTransition("KITCHEN", "QUEUED", "PREPARING")).toBe(true);
    expect(canRoleTransition("WAITER", "QUEUED", "PREPARING")).toBe(false);
    expect(canRoleTransition("KITCHEN", "READY", "SERVED")).toBe(false);
    expect(canRoleTransition("WAITER", "READY", "SERVED")).toBe(true);
    expect(canRoleTransition("ADMIN", "READY", "SERVED")).toBe(true);
    // Cancellation after prep has begun requires supervisor authorization.
    expect(canRoleTransition("KITCHEN", "PREPARING", "CANCELLED")).toBe(false);
    expect(canRoleTransition("WAITER", "PREPARING", "CANCELLED")).toBe(true);
  });

  it("maps states to their timestamp field", () => {
    expect(timestampFieldFor("PREPARING")).toBe("preparingAt");
    expect(timestampFieldFor("READY")).toBe("readyAt");
    expect(timestampFieldFor("SERVED")).toBe("servedAt");
    expect(timestampFieldFor("CANCELLED")).toBe("cancelledAt");
    expect(timestampFieldFor("QUEUED")).toBeNull();
  });
});

describe("deriveOrderSummary", () => {
  const items = (...statuses: ItemStatus[]) => statuses.map((status) => ({ status }));

  it("returns RECEIVED when nothing has started", () => {
    expect(deriveOrderSummary(items("QUEUED", "QUEUED"))).toBe("RECEIVED");
  });

  it("returns IN_PROGRESS once any item is being prepared", () => {
    expect(deriveOrderSummary(items("QUEUED", "PREPARING"))).toBe("IN_PROGRESS");
  });

  it("returns PARTIALLY_READY when only some items are ready", () => {
    expect(deriveOrderSummary(items("READY", "QUEUED"))).toBe("PARTIALLY_READY");
    expect(deriveOrderSummary(items("READY", "PREPARING"))).toBe("PARTIALLY_READY");
  });

  it("returns READY when all active items are ready or served", () => {
    expect(deriveOrderSummary(items("READY", "READY"))).toBe("READY");
    expect(deriveOrderSummary(items("READY", "SERVED"))).toBe("READY");
  });

  it("returns COMPLETED when every active item is served", () => {
    expect(deriveOrderSummary(items("SERVED", "SERVED"))).toBe("COMPLETED");
  });

  it("ignores cancelled items", () => {
    expect(deriveOrderSummary(items("SERVED", "CANCELLED"))).toBe("COMPLETED");
    expect(deriveOrderSummary(items("READY", "CANCELLED"))).toBe("READY");
  });

  it("returns CANCELLED when there is nothing left to serve", () => {
    expect(deriveOrderSummary(items("CANCELLED", "CANCELLED"))).toBe("CANCELLED");
    expect(deriveOrderSummary([])).toBe("CANCELLED");
  });
});
