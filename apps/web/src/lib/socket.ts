import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(token?: string): Socket {
  if (socket) return socket;
  socket = io("/", {
    auth: token ? { token } : undefined,
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: Infinity,
  });
  return socket;
}

export function reconnectWithToken(token: string) {
  if (socket) {
    socket.auth = { token };
    socket.disconnect().connect();
  } else {
    getSocket(token);
  }
}

export const SOCKET_EVENTS = {
  ORDER_CREATED: "order:created",
  ORDER_STATUS: "order:status",
  BILL_REQUESTED: "bill:requested",
  SESSION_CLOSED: "session:closed",
  ASSISTANCE_REQUESTED: "assistance:requested",
} as const;
