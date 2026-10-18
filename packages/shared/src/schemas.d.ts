import { z } from "zod";
export declare const RoleSchema: z.ZodEnum<{
    CUSTOMER: "CUSTOMER";
    WAITER: "WAITER";
    KITCHEN: "KITCHEN";
    ADMIN: "ADMIN";
}>;
export declare const SessionStatusSchema: z.ZodEnum<{
    BILL_REQUESTED: "BILL_REQUESTED";
    PAYMENT_PENDING: "PAYMENT_PENDING";
    CLOSED: "CLOSED";
    ACTIVE: "ACTIVE";
}>;
export declare const OrderStatusSchema: z.ZodEnum<{
    PENDING: "PENDING";
    ACCEPTED: "ACCEPTED";
    PREPARING: "PREPARING";
    READY: "READY";
    SERVED: "SERVED";
    CANCELLED: "CANCELLED";
}>;
export declare const TableStatusSchema: z.ZodEnum<{
    AVAILABLE: "AVAILABLE";
    OCCUPIED: "OCCUPIED";
    BILL_REQUESTED: "BILL_REQUESTED";
    PAYMENT_PENDING: "PAYMENT_PENDING";
    CLOSED: "CLOSED";
}>;
export declare const IdSchema: z.ZodString;
export declare const MoneySchema: z.ZodObject<{
    minor: z.ZodNumber;
    currency: z.ZodLiteral<"INR">;
}, z.core.$strip>;
export declare const OrderItemInputSchema: z.ZodObject<{
    menuItemId: z.ZodString;
    variantId: z.ZodOptional<z.ZodString>;
    addonIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    quantity: z.ZodNumber;
    specialInstructions: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const CreateOrderSchema: z.ZodObject<{
    tableCode: z.ZodString;
    items: z.ZodArray<z.ZodObject<{
        menuItemId: z.ZodString;
        variantId: z.ZodOptional<z.ZodString>;
        addonIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
        quantity: z.ZodNumber;
        specialInstructions: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    idempotencyKey: z.ZodString;
}, z.core.$strip>;
export declare const LoginSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
}, z.core.$strip>;
export declare const TableCreateSchema: z.ZodObject<{
    number: z.ZodString;
}, z.core.$strip>;
export declare const CloseSessionSchema: z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const ReopenSessionSchema: z.ZodObject<{
    reason: z.ZodString;
}, z.core.$strip>;
export declare const PaymentRecordSchema: z.ZodObject<{
    billId: z.ZodString;
    amountMinor: z.ZodNumber;
    method: z.ZodEnum<{
        CASH: "CASH";
        OTHER: "OTHER";
    }>;
    reference: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
//# sourceMappingURL=schemas.d.ts.map