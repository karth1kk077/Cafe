import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;
let currentToken: string | undefined;

/**
 * Connect (or reuse) the realtime socket. The token may be either a staff JWT
 * or a customer session token; the server distinguishes them and joins the
 * appropriate, server-derived rooms.
 */
export function getSocket(token?: string): Socket {
  if (socket) {
    if (token && token !== currentToken) {
      currentToken = token;
      socket.auth = { token, sessionToken: token };
      socket.disconnect().connect();
    }
    return socket;
  }
  currentToken = token;
  socket = io("/", {
    auth: token ? { token, sessionToken: token } : undefined,
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: Infinity,
  });
  return socket;
}

export function reconnectWithToken(token: string) {
  getSocket(token);
}

// Event contract shared with the API (spec 13).
export const SOCKET_EVENTS = {
  ORDER_CREATED: "order.created",
  ORDER_UPDATED: "order.updated",
  ITEM_STATUS: "order_item.status_changed",
  ITEM_READY: "order_item.ready",
  ITEM_SERVED: "order_item.served",
  BILL_REQUESTED: "bill.requested",
  SESSION_OPENED: "session.opened",
  SESSION_CLOSED: "session.closed",
  SESSION_REOPENED: "session.reopened",
  ASSISTANCE_REQUESTED: "assistance_request.created",
  MENU_UPDATED: "menu.updated",
} as const;
