import http from "http";
import { createApp } from "./app.js";
import { config } from "./config/index.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { initSocket } from "./socket/index.js";
import { closeIdleCustomerSessions } from "./services/sessionService.js";

const app = createApp();
const server = http.createServer(app);
initSocket(server);

// Sweep customer-opened sessions that never produced an order. Runs in-process
// (single API instance); a multi-instance deployment should move this to a
// dedicated worker or a DB advisory lock.
const IDLE_SWEEP_MS = 5 * 60 * 1000;
const idleSweep = setInterval(() => {
  closeIdleCustomerSessions()
    .then((count) => {
      if (count > 0) logger.info("Auto-closed idle customer sessions", { count });
    })
    .catch((error) => logger.error("Idle session sweep failed", { error: String(error) }));
}, IDLE_SWEEP_MS);
idleSweep.unref();

server.listen(config.API_PORT, () => {
  logger.info(`API listening on port ${config.API_PORT}`, { env: config.NODE_ENV });
});

async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => logger.error("Unhandled rejection", { reason: String(reason) }));
