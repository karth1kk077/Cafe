// Core domain types - money in minor units (INR paise)
export type Role = "CUSTOMER" | "WAITER" | "KITCHEN" | "ADMIN";

export type TableStatus = "AVAILABLE" | "OCCUPIED" | "BILL_REQUESTED" | "PAYMENT_PENDING" | "CLOSED";

export type SessionStatus = "ACTIVE" | "BILL_REQUESTED" | "PAYMENT_PENDING" | "CLOSED";

export type OrderStatus = "PENDING" | "ACCEPTED" | "PREPARING" | "READY" | "SERVED" | "CANCELLED";

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
