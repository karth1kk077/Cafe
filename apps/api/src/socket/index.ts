import { Server as HttpServer } from "http";
import { Server as SocketServer, type Socket } from "socket.io";
import { verifyToken, type AuthUser } from "../middleware/auth.js";
import { verifyCustomerSessionToken, type CustomerSessionClaim } from "../lib/customerSession.js";
import { prisma } from "../lib/prisma.js";
import { config } from "../config/index.js";
import { logger } from "../lib/logger.js";

let io: SocketServer | null = null;

// Application event contracts (spec 13).
export const SOCKET_EVENTS = {
  ORDER_CREATED: "order.created",
  ORDER_UPDATED: "order.updated",
  ITEM_STATUS: "order_item.status_changed",
  ITEM_READY: "order_item.ready",
  ITEM_SERVED: "order_item.served",
  BILL_REQUESTED: "bill.requested",
  SESSION_CLOSED: "session.closed",
  SESSION_REOPENED: "session.reopened",
  ASSISTANCE_REQUESTED: "assistance_request.created",
  MENU_UPDATED: "menu.updated",
} as const;

type SocketData = {
  user?: AuthUser;
  customer?: CustomerSessionClaim;
};

export function initSocket(server: HttpServer): SocketServer {
  io = new SocketServer(server, {
    cors: { origin: config.WEB_ORIGIN, credentials: true },
  });

  // Every connection must authenticate as either staff or a customer session.
  // A client-provided room name is never trusted as proof of access (spec 13).
  io.use(async (socket, next) => {
    const data = socket.data as SocketData;
    const token =
      socket.handshake.auth?.token ??
      socket.handshake.auth?.sessionToken ??
      socket.handshake.headers.authorization?.toString().replace("Bearer ", "");

    if (typeof token === "string" && token.length > 0) {
      try {
        const decoded = verifyToken(token) as AuthUser;
        // Only accept as staff when the payload actually carries a staff identity.
        if (decoded?.id && decoded?.role) {
          // Revalidate against the database, matching HTTP auth: deactivated
          // accounts and role changes take effect without waiting for expiry.
          const user = await prisma.user.findUnique({
            where: { id: decoded.id },
            select: { id: true, email: true, name: true, role: true, isActive: true },
          });
          if (!user || !user.isActive) return next(new Error("UNAUTHORIZED"));
          data.user = {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role as AuthUser["role"],
          };
          return next();
        }
      } catch {
        /* not a staff token — fall through to customer session */
      }
      try {
        data.customer = verifyCustomerSessionToken(token);
        return next();
      } catch {
        /* invalid */
      }
    }
    next(new Error("UNAUTHORIZED"));
  });

  io.on("connection", (socket: Socket) => {
    const data = socket.data as SocketData;

    if (data.user) {
      const { id, role } = data.user;
      logger.info("Staff socket connected", { userId: id, role });
      socket.join(`role:${role}`);
      socket.join(`user:${id}`);
    }

    if (data.customer) {
      const { sessionId, tableId } = data.customer;
      logger.debug("Customer socket connected", { sessionId, tableId });
      // Server-derived rooms only — never named by the client.
      socket.join(`session:${sessionId}`);
      socket.join(`table:${tableId}`);
    }

    // Kitchen staff may opt into their role room (already auto-joined above).
    socket.on("subscribe:kitchen", () => {
      if (data.user?.role === "KITCHEN" || data.user?.role === "ADMIN") socket.join("role:KITCHEN");
      else socket.emit("error", { code: "FORBIDDEN", message: "Not allowed" });
    });

    socket.on("disconnect", () => logger.debug("Socket disconnected", { userId: data.user?.id }));
  });

  return io;
}

function emitToStaff(event: string, payload: unknown, roles: string[]) {
  if (!io) return;
  for (const role of roles) io.to(`role:${role}`).emit(event, payload);
}

function emitToSession(event: string, payload: unknown, sessionId?: string) {
  if (!io || !sessionId) return;
  io.to(`session:${sessionId}`).emit(event, payload);
}

const STAFF = ["KITCHEN", "WAITER", "ADMIN"];

export function emitOrderCreated(payload: Record<string, unknown>, sessionId?: string) {
  emitToSession(SOCKET_EVENTS.ORDER_CREATED, payload, sessionId);
  emitToStaff(SOCKET_EVENTS.ORDER_CREATED, payload, STAFF);
}

export function emitOrderUpdated(payload: Record<string, unknown>, sessionId?: string) {
  emitToSession(SOCKET_EVENTS.ORDER_UPDATED, payload, sessionId);
  emitToStaff(SOCKET_EVENTS.ORDER_UPDATED, payload, STAFF);
}

/** Emit the granular item-level events a chef/waiter/customer view reacts to. */
export function emitItemStatus(payload: Record<string, unknown>, sessionId?: string) {
  emitToSession(SOCKET_EVENTS.ITEM_STATUS, payload, sessionId);
  emitToStaff(SOCKET_EVENTS.ITEM_STATUS, payload, STAFF);
  if (payload.toStatus === "READY") {
    emitToStaff(SOCKET_EVENTS.ITEM_READY, payload, ["WAITER", "ADMIN"]);
    emitToSession(SOCKET_EVENTS.ITEM_READY, payload, sessionId);
  }
  if (payload.toStatus === "SERVED") {
    emitToStaff(SOCKET_EVENTS.ITEM_SERVED, payload, ["WAITER", "ADMIN", "KITCHEN"]);
    emitToSession(SOCKET_EVENTS.ITEM_SERVED, payload, sessionId);
  }
}

export function emitBillRequested(payload: unknown, sessionId?: string) {
  emitToSession(SOCKET_EVENTS.BILL_REQUESTED, payload, sessionId);
  emitToStaff(SOCKET_EVENTS.BILL_REQUESTED, payload, ["WAITER", "ADMIN"]);
}

export function emitSessionClosed(payload: unknown, sessionId?: string) {
  emitToSession(SOCKET_EVENTS.SESSION_CLOSED, payload, sessionId);
  emitToStaff(SOCKET_EVENTS.SESSION_CLOSED, payload, STAFF);
}

export function emitSessionReopened(payload: unknown, sessionId?: string) {
  emitToSession(SOCKET_EVENTS.SESSION_REOPENED, payload, sessionId);
  emitToStaff(SOCKET_EVENTS.SESSION_REOPENED, payload, STAFF);
}

export function emitAssistance(payload: unknown, sessionId?: string) {
  emitToSession(SOCKET_EVENTS.ASSISTANCE_REQUESTED, payload, sessionId);
  emitToStaff(SOCKET_EVENTS.ASSISTANCE_REQUESTED, payload, ["WAITER", "ADMIN"]);
}

export function emitMenuUpdated(payload: unknown) {
  if (!io) return;
  // Menu availability is public, so refresh every connected screen (staff and
  // customers) in one broadcast; it keeps "86'd" items from lingering in carts.
  io.emit(SOCKET_EVENTS.MENU_UPDATED, payload);
}
