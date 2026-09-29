import { HOSTED_EXECUTION_TIMESTAMP_HEADER } from "@murphai/hosted-execution/contracts";
import { buildHostedWebhookDbTimingLogDetails } from "../hosted-onboarding/webhook-db-timing";
import { runWithPrismaOperationTimings, type PrismaOperationTiming, type PrismaPoolAcquisitionTiming } from "../prisma-operation-timing";

const SLOW_CALLBACK_MS = 250;

/** Request-local attribution only; never cache authority or add control work. */
export function createHostedRuntimeCallbackTiming(route: "owner" | "checkpoint") {
  let firstRequestInModule = true;
  return async function runWithTiming<T>(
    request: Request,
    run: (timing: { authenticated(): void }) => Promise<T>,
  ): Promise<T> {
    const firstRequest = firstRequestInModule;
    firstRequestInModule = false;
    const handlerStartedAtMs = Date.now();
    const startedAt = performance.now();
    const operations: PrismaOperationTiming[] = [];
    const poolAcquisitions: PrismaPoolAcquisitionTiming[] = [];
    let authenticatedAt: number | null = null;
    let signedRequestToHandlerMs: number | null = null;
    let completed = false;
    const execute = () => run({
      authenticated() {
        authenticatedAt = performance.now();
        // Read only after signature/nonce verification. Transport, startup and
        // cross-host clock skew all contribute; this is not cold-start duration.
        const value = request.headers.get(HOSTED_EXECUTION_TIMESTAMP_HEADER);
        const signedAt = value === null ? NaN : Date.parse(value);
        if (Number.isFinite(signedAt)) signedRequestToHandlerMs = handlerStartedAtMs - signedAt;
      },
    });
    try {
      // Checkpoint publication already owns its nested database collector.
      const result = route === "owner"
        ? await runWithPrismaOperationTimings(operations, execute, poolAcquisitions)
        : await execute();
      completed = true;
      return result;
    } finally {
      const finishedAt = performance.now();
      const totalMs = Math.round(finishedAt - startedAt);
      if (firstRequest || !completed || totalMs >= SLOW_CALLBACK_MS
        || (signedRequestToHandlerMs ?? 0) >= SLOW_CALLBACK_MS) {
        try {
          console.info("Hosted runtime callback timing.", {
            route,
            completed,
            firstRequestInModule: firstRequest,
            handlerStartedAt: new Date(handlerStartedAtMs).toISOString(),
            signedRequestToHandlerMs,
            totalMs,
            authenticationMs: Math.round((authenticatedAt ?? finishedAt) - startedAt),
            workMs: authenticatedAt === null ? null : Math.round(finishedAt - authenticatedAt),
            ...(route === "owner" ? {
              ...buildHostedWebhookDbTimingLogDetails(operations),
              poolAcquisitionCount: poolAcquisitions.length,
              poolAcquireMs: poolAcquisitions.slice(0, 24).map(sample => Math.round(sample.ms)),
              poolBeforeAcquire: poolAcquisitions.slice(0, 24).map(({ idleConnections, totalConnections, waitingRequests }) =>
                ({ idleConnections, totalConnections, waitingRequests })),
            } : {}),
          });
        } catch {
          // Diagnostics cannot replace the response or the original failure.
        }
      }
    }
  };
}
