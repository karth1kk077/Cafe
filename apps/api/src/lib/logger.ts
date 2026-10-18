import winston from "winston";
import { config } from "../config/index.js";

const redactKeys = ["password", "passwordHash", "token", "authorization", "cookie", "jwt", "secret"];

const redactFormat = winston.format((info) => {
  const redact = (obj: unknown): unknown => {
    if (obj === null || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(redact);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (redactKeys.some((rk) => k.toLowerCase().includes(rk))) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  };
  return redact(info) as winston.Logform.TransformableInfo;
});

export const logger = winston.createLogger({
  level: config.NODE_ENV === "production" ? "info" : "debug",
  format: winston.format.combine(
    winston.format.timestamp(),
    redactFormat(),
    config.NODE_ENV === "production" ? winston.format.json() : winston.format.prettyPrint()
  ),
  transports: [new winston.transports.Console()],
});

export type Logger = typeof logger;
