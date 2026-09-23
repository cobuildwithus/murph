import { AsyncLocalStorage } from "node:async_hooks";

export interface PrismaOperationTiming {
  key: string;
  ms: number;
}

export interface PrismaPoolAcquisitionTiming {
  ms: number;
  idleConnections: number;
  totalConnections: number;
  waitingRequests: number;
}

const prismaOperationTimingStorage = new AsyncLocalStorage<{
  operations: PrismaOperationTiming[];
  poolAcquisitions?: PrismaPoolAcquisitionTiming[];
}>();

/**
 * Runs the callback with the given array active as the Prisma
 * operation-timing collector; entries recorded while it runs are pushed into
 * it even when the callback throws. Outside a collector the client extension
 * is a pass-through, so steady-state requests pay nothing.
 */
export async function runWithPrismaOperationTimings<TResult>(
  operations: PrismaOperationTiming[],
  run: () => Promise<TResult>,
  poolAcquisitions?: PrismaPoolAcquisitionTiming[],
): Promise<TResult> {
  // Prisma promises are lazy thenables: await inside the scope so a callback
  // returning a query directly starts its driver work under this collector.
  return prismaOperationTimingStorage.run({ operations, poolAcquisitions }, async () => await run());
}

export function recordPrismaOperationTiming(key: string, ms: number): void {
  prismaOperationTimingStorage.getStore()?.operations.push({ key, ms });
}

export function isPrismaOperationTimingActive(): boolean {
  return prismaOperationTimingStorage.getStore() !== undefined;
}

/** Capture the requesting scope before pg dispatches a callback from its pool. */
export function startPrismaPoolAcquisitionTiming(
  snapshot: Omit<PrismaPoolAcquisitionTiming, "ms">,
): (() => void) | null {
  const samples = prismaOperationTimingStorage.getStore()?.poolAcquisitions;
  if (!samples) return null;
  const startedAt = performance.now();
  return () => { samples.push({ ...snapshot, ms: performance.now() - startedAt }); };
}
