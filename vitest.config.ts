import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Playwright specs live in e2e/ and must never be collected by Vitest.
    include: ["apps/api/src/**/*.test.ts"],
    exclude: ["e2e/**", "**/node_modules/**", "**/dist/**"],
    globals: true,
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
    pool: "forks",
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/cafe_test_db?schema=public",
      JWT_SECRET: "test-secret-at-least-16-chars-long",
      SESSION_SECRET: "test-session-secret-16-plus",
      COOKIE_SECURE: "false",
      // The integration suite makes many requests from one IP in a single
      // minute; production defaults stay untouched.
      RATE_LIMIT_MAX: "10000",
      ORDER_RATE_LIMIT_MAX: "10000",
      SESSION_RATE_LIMIT_MAX: "10000",
    },
  },
});
