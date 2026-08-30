import { PrismaClient } from '@prisma/client';

/**
 * A single client for the process. `tsx watch` re-evaluates modules on change,
 * so the instance is cached on globalThis to avoid exhausting the connection
 * pool during development.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
