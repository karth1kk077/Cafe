import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config/index.js";
import { ForbiddenError, UnauthorizedError } from "../lib/errors.js";
import {
  readCustomerSessionToken,
  verifyCustomerSessionToken,
  type CustomerSessionClaim,
} from "../lib/customerSession.js";
import type { Role } from "@cafe/shared";
import { prisma } from "../lib/prisma.js";

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
      customerSession?: CustomerSessionClaim;
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

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    let token: string | undefined;
    if (header?.startsWith("Bearer ")) token = header.slice(7);
    else if (req.cookies?.[AUTH_COOKIE]) token = req.cookies[AUTH_COOKIE];

    if (!token) throw new UnauthorizedError();
    const claims = verifyToken(token);
    if (!claims?.id || !claims.role) throw new UnauthorizedError("Invalid token payload");

    // Re-check the account on every request: a deactivated staff member or a
    // changed role must take effect immediately, not in up to 12 hours.
    const user = await prisma.user.findUnique({
      where: { id: claims.id },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
    if (!user || !user.isActive) throw new UnauthorizedError("Account is deactivated");

    req.user = { id: user.id, email: user.email, name: user.name, role: user.role as Role };
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

/**
 * Require a valid, session-scoped customer token. When `param` is given the
 * token's session must match that route parameter, so a customer can never
 * read or mutate another table's session by swapping an id in the URL.
 */
export function requireCustomerSession(param = "sessionId") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const token = readCustomerSessionToken(req.headers["x-session-token"]);
      if (!token) throw new UnauthorizedError("A session token is required");
      const claim = verifyCustomerSessionToken(token);
      const routeSession = String(req.params?.[param] ?? "");
      if (routeSession && routeSession !== claim.sessionId) {
        throw new UnauthorizedError("Session token does not match");
      }
      req.customerSession = claim;
      next();
    } catch {
      next(new UnauthorizedError("Invalid or expired session token"));
    }
  };
}
