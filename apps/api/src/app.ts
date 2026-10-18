import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { config } from "./config/index.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { publicRouter } from "./routes/public.js";
import { staffRouter } from "./routes/staff.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: config.WEB_ORIGIN,
      credentials: true,
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.use("/api", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/public", publicRouter);
  app.use("/api/staff", staffRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
