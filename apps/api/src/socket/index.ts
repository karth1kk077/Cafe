import { Server as HttpServer } from "http";
import { Server as SocketServer, type Socket } from "socket.io";
import { verifyToken } from "../middleware/auth.js";
import { config } from "../config/index.js";
import { logger } from "../lib/logger.js";

let io: SocketServer | null = null;

export const SOCKET_EVENTS = {
  ORDER_CREATED: "order:created",
  ORDER_STATUS: "order:status",
  BILL_REQUESTED: "bill:requested",
  SESSION_CLOSED: "session:closed",
  ASSISTANCE_REQUESTED: "assistance:requested",
  MENU_UPDATED: "menu:updated",
} as const;

export function initSocket(server: HttpServer): SocketServer {
  io = new SocketServer(server, {
    cors: { origin: config.WEB_ORIGIN, credentials: true },
  });

  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ??
        socket.handshake.headers.authorization?.toString().replace("Bearer ", "");
      if (!token) return next(new Error("UNAUTHORIZED"));
      const user = verifyToken(token);
      (socket.data as { user?: unknown }).user = user;
      next();
    } catch {
      next(new Error("UNAUTHORIZED"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const user = (socket.data as { user?: { id: string; role: string } }).user;
    logger.info("Socket connected", { userId: user?.id, role: user?.role });

    // Staff roles join role rooms for live ops.
    if (user?.role) socket.join(`role:${user.role}`);
    if (user?.id) socket.join(`user:${user.id}`);

    // Room subscriptions must be authorized by role, never trusted blindly.
    socket.on("subscribe:table", (tableCode: string) => {
      const user2 = (socket.data as { user?: { role: string } }).user;
      if (user2?.role === "CUSTOMER" || user2?.role === "WAITER" || user2?.role === "ADMIN") {
        socket.join(`table:${tableCode}`);
      } else {
        socket.emit("error", { code: "FORBIDDEN", message: "Not allowed to subscribe" });
      }
    });

    socket.on("subscribe:kitchen", () => {
      const user2 = (socket.data as { user?: { role: string } }).user;
      if (user2?.role === "KITCHEN" || user2?.role === "ADMIN") socket.join("role:KITCHEN");
      else socket.emit("error", { code: "FORBIDDEN", message: "Not allowed" });
    });

    socket.on("disconnect", () => logger.debug("Socket disconnected", { userId: user?.id }));
  });

  return io;
}

function emitToStaffAndRole(event: string, payload: unknown, roles: string[]) {
  if (!io) return;
  for (const role of roles) io.to(`role:${role}`).emit(event, payload);
}

export function emitOrderCreated(order: Record<string, unknown>, tableCode?: string) {
  if (!io) return;
  if (tableCode) io.to(`table:${tableCode}`).emit(SOCKET_EVENTS.ORDER_CREATED, order);
  emitToStaffAndRole(SOCKET_EVENTS.ORDER_CREATED, order, ["KITCHEN", "WAITER", "ADMIN"]);
}

export function emitOrderStatus(order: unknown, tableCode?: string) {
  if (!io) return;
  if (tableCode) io.to(`table:${tableCode}`).emit(SOCKET_EVENTS.ORDER_STATUS, order);
  emitToStaffAndRole(SOCKET_EVENTS.ORDER_STATUS, order, ["KITCHEN", "WAITER", "ADMIN"]);
}

export function emitBillRequested(payload: unknown, tableCode?: string) {
  if (!io) return;
  if (tableCode) io.to(`table:${tableCode}`).emit(SOCKET_EVENTS.BILL_REQUESTED, payload);
  emitToStaffAndRole(SOCKET_EVENTS.BILL_REQUESTED, payload, ["WAITER", "ADMIN"]);
}

export function emitSessionClosed(payload: unknown, tableCode?: string) {
  if (!io) return;
  if (tableCode) io.to(`table:${tableCode}`).emit(SOCKET_EVENTS.SESSION_CLOSED, payload);
  emitToStaffAndRole(SOCKET_EVENTS.SESSION_CLOSED, payload, ["KITCHEN", "WAITER", "ADMIN"]);
}

export function emitAssistance(payload: unknown, tableCode?: string) {
  if (!io) return;
  if (tableCode) io.to(`table:${tableCode}`).emit(SOCKET_EVENTS.ASSISTANCE_REQUESTED, payload);
  emitToStaffAndRole(SOCKET_EVENTS.ASSISTANCE_REQUESTED, payload, ["WAITER", "ADMIN"]);
}
