import { AsyncLocalStorage } from "node:async_hooks";

export interface PrismaOperationTiming {
  key: string;
  ms: number;
  startMs?: number;
}

export interface PrismaQueryTiming {
  startMs: number;
  ms: number;
  failed: boolean;
}

export interface PrismaPoolAcquisitionTiming {
  startMs?: number;
  ms: number;
  idleConnections: number;
  totalConnections: number;
  waitingRequests: number;
}

const prismaOperationTimingStorage = new AsyncLocalStorage<{
  startedAt: number;
  operations: PrismaOperationTiming[];
  queries?: PrismaQueryTiming[];
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
  queries?: PrismaQueryTiming[],
): Promise<TResult> {
  // Prisma promises are lazy thenables: await inside the scope so a callback
  // returning a query directly starts its driver work under this collector.
  return prismaOperationTimingStorage.run({ startedAt: performance.now(), operations, poolAcquisitions, queries }, async () => await run());
}

export function recordPrismaOperationTiming(key: string, ms: number, startedAt?: number): void {
  const scope = prismaOperationTimingStorage.getStore();
  scope?.operations.push({ key, ms, ...(startedAt === undefined ? {} : { startMs: startedAt - scope.startedAt }) });
}

/** The driver round trip starts after checkout and includes response decoding. */
export function startPrismaQueryTiming(): ((failed: boolean) => void) | null {
  const scope = prismaOperationTimingStorage.getStore();
  const samples = scope?.queries;
  if (!samples) return null;
  const startedAt = performance.now();
  const startMs = startedAt - scope.startedAt;
  return failed => { samples.push({ startMs, ms: performance.now() - startedAt, failed }); };
}

export function isPrismaOperationTimingActive(): boolean {
  return prismaOperationTimingStorage.getStore() !== undefined;
}

/** Capture the requesting scope before pg dispatches a callback from its pool. */
export function startPrismaPoolAcquisitionTiming(
  snapshot: Omit<PrismaPoolAcquisitionTiming, "ms">,
): (() => void) | null {
  const scope = prismaOperationTimingStorage.getStore();
  const samples = scope?.poolAcquisitions;
  if (!samples) return null;
  const startedAt = performance.now();
  const startMs = startedAt - scope.startedAt;
  return () => { samples.push({ ...snapshot, startMs, ms: performance.now() - startedAt }); };
}
