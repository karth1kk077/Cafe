import { z } from "zod";

export const RoleSchema = z.enum(["CUSTOMER", "WAITER", "KITCHEN", "ADMIN"]);
export const SessionStatusSchema = z.enum(["ACTIVE", "BILL_REQUESTED", "PAYMENT_PENDING", "CLOSED"]);
export const OrderStatusSchema = z.enum(["PENDING", "ACCEPTED", "PREPARING", "READY", "SERVED", "CANCELLED"]);
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
  tableCode: z.string().min(8).max(64),
  items: z.array(OrderItemInputSchema).min(1).max(50),
  idempotencyKey: z.string().min(8).max(200),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(128),
});

export const TableCreateSchema = z.object({
  number: z.string().min(1).max(20),
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
