import { AsyncLocalStorage } from "node:async_hooks";

export interface PrismaOperationTiming {
  key: string;
  ms: number;
}

const prismaOperationTimingStorage = new AsyncLocalStorage<PrismaOperationTiming[]>();

/**
 * Runs the callback with the given array active as the Prisma
 * operation-timing collector; entries recorded while it runs are pushed into
 * it even when the callback throws. Outside a collector the client extension
 * is a pass-through, so steady-state requests pay nothing.
 */
export async function runWithPrismaOperationTimings<TResult>(
  operations: PrismaOperationTiming[],
  run: () => Promise<TResult>,
): Promise<TResult> {
  return prismaOperationTimingStorage.run(operations, run);
}

export function recordPrismaOperationTiming(key: string, ms: number): void {
  prismaOperationTimingStorage.getStore()?.push({ key, ms });
}

export function isPrismaOperationTimingActive(): boolean {
  return prismaOperationTimingStorage.getStore() !== undefined;
}
