import dotenv from "dotenv";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

// Resolve the monorepo root .env regardless of the process working directory.
function loadEnv() {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      dotenv.config({ path: p });
      return;
    }
  }
  dotenv.config();
}
loadEnv();

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL required"),
  API_PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 chars"),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 chars"),
  COOKIE_SECURE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
  BCRYPT_ROUNDS: z.coerce.number().default(12),
  CAFE_NAME: z.string().default("Smart Café"),
  CURRENCY: z.string().length(3).default("INR"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  ORDER_RATE_LIMIT_MAX: z.coerce.number().default(30),
  // Public origin encoded into table QR codes (e.g. https://cafe.example).
  // Optional: falls back to WEB_ORIGIN so dev/test need no extra config, but
  // production should set it explicitly to the URL customers scan.
  PUBLIC_APP_BASE_URL: z.string().url().optional(),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  PUBLIC_APP_BASE_URL: parsed.data.PUBLIC_APP_BASE_URL ?? parsed.data.WEB_ORIGIN,
};
export type AppConfig = typeof config;
