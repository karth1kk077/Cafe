// Core domain types - money in minor units (INR paise)
export type Role = "CUSTOMER" | "WAITER" | "KITCHEN" | "ADMIN";

export type TableStatus = "AVAILABLE" | "OCCUPIED" | "BILL_REQUESTED" | "PAYMENT_PENDING" | "CLOSED";

export type SessionStatus = "PENDING" | "ACTIVE" | "BILL_REQUESTED" | "PAYMENT_PENDING" | "CLOSED";

// Line-item preparation state (spec 11.1).
export type OrderItemStatus = "QUEUED" | "PREPARING" | "READY" | "SERVED" | "CANCELLED";

// Derived order summary (spec 11.2).
export type OrderStatus =
  | "RECEIVED"
  | "IN_PROGRESS"
  | "PARTIALLY_READY"
  | "READY"
  | "COMPLETED"
  | "CANCELLED";

export type BillStatus = "OPEN" | "PARTIAL" | "PAID" | "VOID";

export type PaymentStatus = "PENDING" | "COMPLETED" | "FAILED" | "REFUNDED";

export type PaymentMethod = "CASH" | "OTHER";

export interface Money {
  minor: number; // integer cents/paise
  currency: "INR";
}

export interface Id {
  id: string;
}
