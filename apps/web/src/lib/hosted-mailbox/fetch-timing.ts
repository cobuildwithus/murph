import { HOSTED_EXECUTION_TIMESTAMP_HEADER } from "@murphai/hosted-execution/contracts";
import { buildHostedWebhookDbTimingLogDetails } from "../hosted-onboarding/webhook-db-timing";
import { runWithPrismaOperationTimings, type PrismaOperationTiming, type PrismaPoolAcquisitionTiming } from "../prisma-operation-timing";

type MailboxFetchPhase =
  | "authentication" | "parse" | "transaction_acquire" | "authority"
  | "member" | "access" | "mailbox" | "usage" | "projection"
  | "transaction_finish" | "group_presentation" | "ingress_context" | "serialize";

const SLOW_FETCH_MS = 250;
let firstRequestInModule = true;

/** One content-free record, with no additional database or network work. */
export async function runWithHostedMailboxFetchTiming<T>(
  request: Request,
  run: (timing: {
    start(phase: MailboxFetchPhase): void;
    authenticated(): void;
    failed(): void;
  }) => Promise<T>,
  reportServerTiming?: (value: string) => void,
): Promise<T> {
  const firstRequest = firstRequestInModule;
  firstRequestInModule = false;
  const handlerStartedAtMs = Date.now();
  const startedAt = performance.now();
  const phases: Partial<Record<MailboxFetchPhase, number>> = {};
  const operations: PrismaOperationTiming[] = [];
  const poolAcquisitions: PrismaPoolAcquisitionTiming[] = [];
  let phase: MailboxFetchPhase = "authentication";
  let phaseStartedAt = startedAt;
  let signedAt: string | null = null;
  let signedRequestToHandlerMs: number | null = null;
  let completed = false;
  let failedPhase: MailboxFetchPhase | null = null;
  const finishPhase = () => {
    const now = performance.now();
    phases[phase] = (phases[phase] ?? 0) + now - phaseStartedAt;
    phaseStartedAt = now;
  };
  try {
    const result = await runWithPrismaOperationTimings(operations, () => run({
      start(next) { finishPhase(); phase = next; },
      failed() { failedPhase ??= phase; },
      authenticated() {
        // Read only after signature and nonce verification. This spans transport,
        // platform startup and clock skew; it is not a cold-start measurement.
        const timestamp = request.headers.get(HOSTED_EXECUTION_TIMESTAMP_HEADER);
        const parsed = timestamp === null ? NaN : Date.parse(timestamp);
        if (Number.isFinite(parsed)) {
          signedAt = new Date(parsed).toISOString();
          signedRequestToHandlerMs = handlerStartedAtMs - parsed;
        }
      },
    }), poolAcquisitions);
    completed = true;
    return result;
  } catch (error) {
    failedPhase ??= phase;
    throw error;
  } finally {
    finishPhase();
    const totalMs = Math.round(performance.now() - startedAt);
    // Keep the existing Worker header contract while sharing the log's clock.
    const headerPhases = {
      auth: phases.authentication, parse: phases.parse,
      transaction_start: phases.transaction_acquire, fence: phases.authority,
      member: phases.member, access: phases.access, projection: phases.mailbox,
      usage: phases.usage,
      transaction_finish: (phases.projection ?? 0) + (phases.transaction_finish ?? 0),
      group: phases.group_presentation, crypto: phases.ingress_context,
      serialize: phases.serialize, total: totalMs,
    };
    reportServerTiming?.(Object.entries(headerPhases)
      .filter((entry): entry is [string, number] => entry[1] !== undefined)
      .map(([key, ms]) => `murph_mailbox_${key};dur=${Math.max(0, Math.round(ms))}`).join(", "));
    if (firstRequest || !completed || totalMs >= SLOW_FETCH_MS
      || (signedRequestToHandlerMs ?? 0) >= SLOW_FETCH_MS) {
      try {
        console.info("Hosted mailbox fetch timing.", {
          event: "hosted-mailbox.fetch.timing",
          completed,
          firstRequestInModule: firstRequest,
          handlerStartedAt: new Date(handlerStartedAtMs).toISOString(),
          signedAt,
          signedRequestToHandlerMs,
          totalMs,
          lastPhase: phase,
          failedPhase,
          phaseMs: Object.fromEntries(Object.entries(phases).map(([key, ms]) => [key, Math.round(ms)])),
          poolAcquisitionCount: poolAcquisitions.length,
          poolAcquireMs: poolAcquisitions.slice(0, 24).map(sample => Math.round(sample.ms)),
          poolBeforeAcquire: poolAcquisitions.slice(0, 24).map(({ idleConnections, totalConnections, waitingRequests }) =>
            ({ idleConnections, totalConnections, waitingRequests })),
          poolAcquireTotalMs: Math.round(poolAcquisitions.reduce((sum, sample) => sum + sample.ms, 0)),
          ...buildHostedWebhookDbTimingLogDetails(operations),
        });
      } catch {
        // Diagnostics cannot change the authenticated response or its failure.
      }
    }
  }
}
