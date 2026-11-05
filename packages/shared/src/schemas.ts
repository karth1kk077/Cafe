import { z } from "zod";

export const RoleSchema = z.enum(["CUSTOMER", "WAITER", "KITCHEN", "ADMIN"]);
export const SessionStatusSchema = z.enum(["PENDING", "ACTIVE", "BILL_REQUESTED", "PAYMENT_PENDING", "CLOSED"]);
export const OrderStatusSchema = z.enum([
  "RECEIVED",
  "IN_PROGRESS",
  "PARTIALLY_READY",
  "READY",
  "COMPLETED",
  "CANCELLED",
]);
export const OrderItemStatusSchema = z.enum(["QUEUED", "PREPARING", "READY", "SERVED", "CANCELLED"]);
export const TableStatusSchema = z.enum(["AVAILABLE", "OCCUPIED", "BILL_REQUESTED", "PAYMENT_PENDING", "CLOSED"]);

export const IdSchema = z.string().uuid();

export const MoneySchema = z.object({
  minor: z.number().int().nonnegative(),
  currency: z.literal("INR"),
});

export const OrderItemInputSchema = z.object({
  menuItemId: z.string().uuid(),
  variantId: z.string().uuid().optional(),
  addonIds: z.array(z.string().uuid()).optional(),
  quantity: z.number().int().positive().max(20),
  specialInstructions: z.string().max(200).optional(),
});

export const CreateOrderSchema = z.object({
  // The dining session is derived from the customer's session token, never
  // from a client-supplied table code (spec 1, 6.1).
  items: z.array(OrderItemInputSchema).min(1).max(50),
  idempotencyKey: z.string().min(8).max(200),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(128),
});

export const TableCreateSchema = z.object({
  // Trimmed so " 4 " and "4" are the same label; uniqueness (including
  // case-insensitive duplicates) is enforced server-side on create/rename.
  number: z.string().trim().min(1).max(20),
  seats: z.number().int().min(1).max(50).optional(),
});

export const CloseSessionSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const ReopenSessionSchema = z.object({
  reason: z.string().max(500),
});

export const PaymentRecordSchema = z.object({
  billId: z.string().uuid(),
  amountMinor: z.number().int().positive(),
  method: z.enum(["CASH", "OTHER"]),
  reference: z.string().max(100).optional(),
});

// Staff action on a single order line item (spec 7.2).
export const UpdateOrderItemStatusSchema = z.object({
  status: OrderItemStatusSchema,
  note: z.string().max(200).optional(),
});

export const CancelOrderItemSchema = z.object({
  reason: z.string().max(200).optional(),
});
