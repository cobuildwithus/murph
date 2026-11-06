import { HOSTED_EXECUTION_TIMESTAMP_HEADER } from "@murphai/hosted-execution/contracts";
import { buildHostedWebhookDbTimingLogDetails } from "../hosted-onboarding/webhook-db-timing";
import { runWithPrismaOperationTimings, type PrismaOperationTiming, type PrismaPoolAcquisitionTiming } from "../prisma-operation-timing";

type WorkspaceReadPhase = "authentication" | "workspace" | "configuration" | "usage" | "response";
const SLOW_READ_MS = 250;
let firstRequestInModule = true;

/** Measure existing work only. Read phases overlap and are not additive. */
export async function runWithHostedWorkspaceReadTiming(
  request: Request,
  run: (timing: {
    measure<T>(phase: WorkspaceReadPhase, operation: () => T | PromiseLike<T>): Promise<T>;
    authenticated(): void;
  }) => Promise<Response>,
): Promise<Response> {
  const firstRequest = firstRequestInModule;
  firstRequestInModule = false;
  const handlerStartedAtMs = Date.now();
  const startedAt = performance.now();
  const phases: Partial<Record<WorkspaceReadPhase, number>> = {};
  const pending = new Set<WorkspaceReadPhase>();
  const operations: PrismaOperationTiming[] = [];
  const poolAcquisitions: PrismaPoolAcquisitionTiming[] = [];
  let signedAt: string | null = null;
  let signedRequestToHandlerMs: number | null = null;
  let failedPhase: WorkspaceReadPhase | null = null;
  let response: Response | undefined;
  try {
    response = await runWithPrismaOperationTimings(operations, () => run({
      async measure(phase, operation) {
        const phaseStartedAt = performance.now();
        pending.add(phase);
        try {
          return await operation();
        } catch (error) {
          failedPhase ??= phase;
          throw error;
        } finally {
          phases[phase] = performance.now() - phaseStartedAt;
          pending.delete(phase);
        }
      },
      authenticated() {
        // Only authenticated timestamps may describe transport/platform age.
        const value = request.headers.get(HOSTED_EXECUTION_TIMESTAMP_HEADER);
        const parsed = value === null ? NaN : Date.parse(value);
        if (Number.isFinite(parsed)) {
          signedAt = new Date(parsed).toISOString();
          signedRequestToHandlerMs = handlerStartedAtMs - parsed;
        }
      },
    }), poolAcquisitions);
    return response;
  } finally {
    const totalMs = Math.round(performance.now() - startedAt);
    const completed = response !== undefined;
    try {
      response?.headers.set("Server-Timing", Object.entries({ ...phases, total: totalMs })
        .map(([key, ms]) => `murph_workspace_${key};dur=${Math.max(0, Math.round(ms))}`).join(", "));
    } catch {
      // An immutable response must still be returned unchanged.
    }
    if (firstRequest || !response || totalMs >= SLOW_READ_MS
      || (signedRequestToHandlerMs ?? 0) >= SLOW_READ_MS) {
      try {
        console.info("Hosted workspace read timing.", {
          event: "hosted-workspace.read.timing",
          completed,
          firstRequestInModule: firstRequest,
          handlerStartedAt: new Date(handlerStartedAtMs).toISOString(),
          signedAt,
          signedRequestToHandlerMs,
          totalMs,
          failedPhase,
          // Promise.all can reject while sibling reads are still in flight.
          pendingPhases: [...pending],
          phaseMs: Object.fromEntries(Object.entries(phases).map(([key, ms]) => [key, Math.round(ms)])),
          poolAcquisitionCount: poolAcquisitions.length,
          poolAcquireMs: poolAcquisitions.slice(0, 24).map(sample => Math.round(sample.ms)),
          poolBeforeAcquire: poolAcquisitions.slice(0, 24).map(({ idleConnections, totalConnections, waitingRequests }) =>
            ({ idleConnections, totalConnections, waitingRequests })),
          poolAcquireTotalMs: Math.round(poolAcquisitions.reduce((sum, sample) => sum + sample.ms, 0)),
          ...buildHostedWebhookDbTimingLogDetails(operations),
        });
      } catch {
        // Logging cannot replace the authenticated response or original failure.
      }
    }
  }
}
