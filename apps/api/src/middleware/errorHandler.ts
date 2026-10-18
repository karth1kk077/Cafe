import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { Prisma } from "@prisma/client";

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Endpoint not found" } });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "Invalid request", details: err.flatten() },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      res.status(409).json({ error: { code: "DUPLICATE", message: "Resource already exists" } });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found" } });
      return;
    }
  }

  logger.error("Unhandled error", { message: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong" } });
}
