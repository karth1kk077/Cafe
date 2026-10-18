import { Router } from "express";
import rateLimit from "express-rate-limit";
import { LoginSchema } from "@cafe/shared";
import { login } from "../services/authService.js";
import { config } from "../config/index.js";
import { authenticate, AUTH_COOKIE } from "../middleware/auth.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Too many login attempts. Try again later." } },
});

authRouter.post(
  "/login",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const body = LoginSchema.parse(req.body);
    const { token, user } = await login(body.email, body.password);
    res.cookie(AUTH_COOKIE, token, {
      httpOnly: true,
      secure: config.COOKIE_SECURE,
      sameSite: config.COOKIE_SAME_SITE,
      maxAge: 12 * 60 * 60 * 1000,
      path: "/",
    });
    res.json({ token, user });
  })
);

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(AUTH_COOKIE, { path: "/" });
  res.json({ ok: true });
});

authRouter.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user });
  })
);
