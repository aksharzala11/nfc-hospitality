import { PrismaClient } from "@prisma/client";

// Re-use a single Prisma client across hot reloads in development so we don't
// exhaust the (small) connection pool on the Lightsail database.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
