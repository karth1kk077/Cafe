import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
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
    },
  },
});
