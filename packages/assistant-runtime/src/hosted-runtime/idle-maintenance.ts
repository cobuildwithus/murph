import {
  compactWarmCodexThread,
  type CodexWarmThreadCompactionOutcome,
} from "@murphai/assistant-engine/assistant-codex";
import {
  buildAssistantMaintenanceUsageRecord,
  type AssistantUsageCredentialSource,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import {
  normalizeHostedAiUsageAllowancePricedModelId,
} from "@murphai/hosted-execution/runtime-control";

import type { RuntimeWakeSignal } from "./runtime-wake.ts";

// Compact only when the saving clears the measured post-compaction floor
// (~40k tokens); below this the compact call costs more than it recovers.
export const HOSTED_IDLE_COMPACT_MIN_THREAD_TOKENS = 100_000;
export const HOSTED_IDLE_COMPACT_TIMEOUT_MS = 120_000;

export type HostedIdleMaintenanceOutcome =
  | CodexWarmThreadCompactionOutcome
  | { kind: "failed"; reason: "exception"; threadContextTokensBefore: null }
  | {
      kind: "skipped";
      reason: "missing_model" | "pending_work" | "shutdown" | "unpriced_model";
      threadContextTokensBefore: null;
    };

// One idle-checkpoint maintenance step: opportunistic, fail-open thread
// compaction. Runs only on TTL idle shutdown (never deploy evacuation), and a
// pending wake aborts it immediately — the engine kills the warm process on
// abort, so a wake can never queue behind an in-flight compaction. Future
// idle-time maintenance belongs here as additional plain statements.
export async function runHostedIdleCheckpointMaintenance(input: {
  credentialSource: AssistantUsageCredentialSource;
  memberId: string;
  model: string | null;
  pendingWork: boolean;
  recordUsage: ((record: AssistantUsageRecord) => Promise<void>) | null;
  resolveAssistantSessionId: ((codexThreadId: string) => Promise<string | null>) | null;
  shutdownSignal: AbortSignal | null;
  wakeSignal: RuntimeWakeSignal | null;
}): Promise<HostedIdleMaintenanceOutcome> {
  if (input.shutdownSignal?.aborted) {
    return { kind: "skipped", reason: "shutdown", threadContextTokensBefore: null };
  }
  if (input.pendingWork) {
    // The checkpoint is on a prompt-return path (mailbox budget exhausted or
    // an imminent projected wake); a compact here would delay member-visible
    // work, which is exactly what this feature must never do.
    return { kind: "skipped", reason: "pending_work", threadContextTokensBefore: null };
  }
  // Without a priced hosted model id the compact call's usage cannot be
  // accounted against the member's allowance, so do not spend unattributable
  // tokens. The two reasons are distinct on purpose: missing_model means a
  // misconfigured runtime; unpriced_model means a deliberate unsupported model.
  if (!input.model) {
    return { kind: "skipped", reason: "missing_model", threadContextTokensBefore: null };
  }
  if (!normalizeHostedAiUsageAllowancePricedModelId(input.model)) {
    return { kind: "skipped", reason: "unpriced_model", threadContextTokensBefore: null };
  }

  const abortController = new AbortController();
  const onShutdownAbort = () => abortController.abort();
  input.shutdownSignal?.addEventListener("abort", onShutdownAbort, { once: true });
  const wakeWatchAbort = new AbortController();
  const wakeWatch = input.wakeSignal
    ?.wait(wakeWatchAbort.signal)
    .then(() => {
      abortController.abort();
      // Waiting consumed the wake notification; re-notify so the idle loop's
      // pending-wake check after maintenance still observes it.
      input.wakeSignal?.notify();
    })
    .catch(() => undefined);

  try {
    // Structurally fail-open: the runtime seam must not assume the engine
    // helper can never throw — an exception here aborts idle maintenance,
    // never the checkpoint.
    let outcome: CodexWarmThreadCompactionOutcome;
    try {
      outcome = await compactWarmCodexThread({
        minThreadTokens: HOSTED_IDLE_COMPACT_MIN_THREAD_TOKENS,
        signal: abortController.signal,
        timeoutMs: HOSTED_IDLE_COMPACT_TIMEOUT_MS,
      });
    } catch {
      return { kind: "failed", reason: "exception", threadContextTokensBefore: null };
    }

    if (
      outcome.kind === "compacted"
      && outcome.usage
      && input.recordUsage
      && input.resolveAssistantSessionId
    ) {
      // The entire accounting path (session resolution + record write) is
      // fire-and-forget: billing telemetry must never break the idle
      // checkpoint nor delay a pending wake.
      const { recordUsage, resolveAssistantSessionId } = input;
      const { threadId, usage } = outcome;
      const model = input.model;
      void (async () => {
        const assistantSessionId = await resolveAssistantSessionId(threadId);
        if (!assistantSessionId) {
          // No matching session: skip rather than write an ambiguous identity.
          return;
        }
        await recordUsage(
          buildAssistantMaintenanceUsageRecord({
            assistantSessionId,
            codexThreadId: threadId,
            credentialSource: input.credentialSource,
            featureKey: "assistant_idle_compact",
            memberId: input.memberId,
            model,
            triggerKind: "automation_idle_compact",
            usage,
          }),
        );
      })().catch(() => undefined);
    }

    return outcome;
  } finally {
    input.shutdownSignal?.removeEventListener("abort", onShutdownAbort);
    wakeWatchAbort.abort();
    await wakeWatch;
  }
}
