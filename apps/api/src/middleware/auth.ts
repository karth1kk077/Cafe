import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config/index.js";
import { ForbiddenError, UnauthorizedError } from "../lib/errors.js";
import type { Role } from "@cafe/shared";

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  name: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const AUTH_COOKIE = "cafe_token";

export function signToken(user: AuthUser): string {
  return jwt.sign(user, config.JWT_SECRET, { expiresIn: "12h" });
}

export function verifyToken(token: string): AuthUser {
  return jwt.verify(token, config.JWT_SECRET) as AuthUser;
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  try {
    const header = req.headers.authorization;
    let token: string | undefined;
    if (header?.startsWith("Bearer ")) token = header.slice(7);
    else if (req.cookies?.[AUTH_COOKIE]) token = req.cookies[AUTH_COOKIE];

    if (!token) throw new UnauthorizedError();
    const user = verifyToken(token);
    if (!user?.id || !user.role) throw new UnauthorizedError("Invalid token payload");
    req.user = user;
    next();
  } catch {
    next(new UnauthorizedError("Invalid or expired token"));
  }
}

export function authorize(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthorizedError());
    if (roles.length && !roles.includes(req.user.role)) {
      return next(new ForbiddenError());
    }
    next();
  };
}
