import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { config } from "../config/index.js";
import { signToken, type AuthUser } from "../middleware/auth.js";
import { UnauthorizedError } from "../lib/errors.js";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, config.BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function login(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) throw new UnauthorizedError("Invalid credentials");

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new UnauthorizedError("Invalid credentials");

  const authUser: AuthUser = { id: user.id, email: user.email, role: user.role as AuthUser["role"], name: user.name };
  return { token: signToken(authUser), user: authUser };
}
