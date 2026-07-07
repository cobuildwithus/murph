import {
  compactWarmCodexThread,
  type CodexWarmThreadCompactionOutcome,
} from "@murphai/assistant-engine/assistant-codex";
import {
  ASSISTANT_IDLE_COMPACTION_USAGE_ESTIMATE_SOURCE_PATH,
  ASSISTANT_IDLE_COMPACTION_USAGE_ESTIMATE_VERSION,
  buildAssistantMaintenanceUsageRecord,
  type AssistantUsageCredentialSource,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import {
  normalizeHostedAiUsageAllowancePricedModelId,
  resolveHostedAiUsageTokenPricingBasis,
} from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedExecutionSafeErrorDiagnostics,
  emitHostedExecutionStructuredLog,
  readHostedExecutionSafeErrorName,
} from "@murphai/hosted-execution";
import {
  runInboxMediaRetention,
  type InboxMediaRetentionMaterializeResult,
  type InboxMediaRetentionResult,
} from "@murphai/inboxd/runtime";

import type { RuntimeWakeSignal } from "./runtime-wake.ts";

// Compact only when the saving clears the measured post-compaction floor
// (~40k tokens); below this the compact call costs more than it recovers. Keep
// this below the hosted Codex auto-compact ceiling because idle shutdown runs
// off the reply path and can compact large-but-below-ceiling threads before the
// next wake pays the full resend cost.
export const HOSTED_IDLE_COMPACT_MIN_THREAD_TOKENS = 100_000;
export const HOSTED_IDLE_COMPACT_TIMEOUT_MS = 120_000;
export const HOSTED_INBOX_MEDIA_RETENTION_RETRY_DELAY_MS = 5 * 60 * 1000;

type HostedIdleMaintenanceWake = {
  nextWakeAt?: string;
  nextWakeReason?: "inbox_media_retention";
};

export type HostedIdleMaintenanceOutcome =
  | (CodexWarmThreadCompactionOutcome & HostedIdleMaintenanceWake)
  | ({ kind: "failed"; reason: "exception"; threadContextTokensBefore: null } & HostedIdleMaintenanceWake)
  | ({
      kind: "skipped";
      reason:
        | "missing_model"
        | "missing_provider"
        | "pending_work"
        | "shutdown"
        | "unpriced_model";
      threadContextTokensBefore: null;
    } & HostedIdleMaintenanceWake);

// One idle-checkpoint maintenance step: opportunistic, fail-open thread
// compaction. Runs only on TTL idle shutdown (never deploy evacuation). A
// pending wake aborts it immediately; the engine kills the warm process before
// returning, so the idle checkpoint that snapshots the Codex home never
// captures a rollout mid-teardown. Future idle-time maintenance belongs here
// as additional plain statements.
export async function runHostedIdleCheckpointMaintenance(input: {
  credentialSource: AssistantUsageCredentialSource;
  materializeRetentionCandidatePaths?: ((
    storedPaths: readonly string[]
  ) => Promise<InboxMediaRetentionMaterializeResult | void>) | null;
  memberId: string;
  model: string | null;
  pendingWork: boolean;
  protectedAttachmentIds?: readonly string[];
  protectedCaptureIds?: readonly string[];
  protectedStoredPaths?: readonly string[];
  providerName: string | null;
  recordUsage: ((record: AssistantUsageRecord) => Promise<void>) | null;
  resolveAssistantSessionId: ((codexThreadId: string) => Promise<string | null>) | null;
  shutdownSignal: AbortSignal | null;
  vaultRoot?: string | null;
  wakeSignal: RuntimeWakeSignal | null;
}): Promise<HostedIdleMaintenanceOutcome> {
  if (input.shutdownSignal?.aborted) {
    return buildInterruptedMaintenanceOutcome({
      shutdownSignal: input.shutdownSignal,
      vaultRoot: input.vaultRoot ?? null,
      wakeInterrupted: false,
    });
  }

  const abortController = new AbortController();
  let wakeInterrupted = false;
  const onShutdownAbort = () => abortController.abort(input.shutdownSignal?.reason);
  input.shutdownSignal?.addEventListener("abort", onShutdownAbort, { once: true });
  const wakeWatchAbort = new AbortController();
  const wakeWatch = input.wakeSignal
    ?.wait(wakeWatchAbort.signal)
    .then((notification) => {
      wakeInterrupted = true;
      abortController.abort();
      // Waiting consumed the wake notification; re-notify so the idle loop's
      // pending-wake check after maintenance still observes it.
      input.wakeSignal?.notify(notification.notifiedAtEpochMs);
    })
    .catch(() => undefined);

  try {
    let retentionWake: HostedIdleMaintenanceWake = {};
    if (input.vaultRoot) {
      try {
        const retentionResult = await runInboxMediaRetention({
          materializeCandidatePaths: input.materializeRetentionCandidatePaths ?? undefined,
          ...(input.pendingWork ? { maxAttachments: 1 } : {}),
          protectedAttachmentIds: input.protectedAttachmentIds,
          protectedCaptureIds: input.protectedCaptureIds,
          protectedStoredPaths: input.protectedStoredPaths,
          signal: abortController.signal,
          vaultRoot: input.vaultRoot,
        });
        retentionWake = resolveInboxMediaRetentionWake(retentionResult);
      } catch (error) {
        if (isInboxMediaRetentionAbortError(error, abortController.signal)) {
          return buildInterruptedMaintenanceOutcome({
            shutdownSignal: input.shutdownSignal,
            vaultRoot: input.vaultRoot,
            wakeInterrupted,
          });
        }
        // Retention is opportunistic maintenance; a cleanup miss must not block
        // checkpointing or member-visible wake handling. Emit the failure
        // through the shared structured-log boundary so the cause is not
        // silently dropped (Observability And Logging invariant: error logs
        // must include both a stable code and a redacted cause).
        emitInboxMediaRetentionFailureLog({
          error,
          memberId: input.memberId,
        });
        retentionWake = resolveInboxMediaRetentionFailureWake();
      }
    }
    if (abortController.signal.aborted) {
      return buildInterruptedMaintenanceOutcome({
        retentionWake,
        shutdownSignal: input.shutdownSignal,
        vaultRoot: input.vaultRoot,
        wakeInterrupted,
      });
    }
    if (input.pendingWork) {
      // The checkpoint is on a prompt-return path (mailbox budget exhausted or
      // an imminent projected wake); retention is bounded and privacy-critical,
      // but Codex compaction would delay member-visible work.
      return attachInboxMediaRetentionWake(
        { kind: "skipped", reason: "pending_work", threadContextTokensBefore: null },
        retentionWake,
      );
    }
    // Without a priced hosted model id the compact call's usage cannot be
    // accounted against the member's allowance, so do not spend unattributable
    // tokens. The two reasons are distinct on purpose: missing_model means a
    // misconfigured runtime; unpriced_model means a deliberate unsupported model.
    if (!input.model) {
      return attachInboxMediaRetentionWake(
        { kind: "skipped", reason: "missing_model", threadContextTokensBefore: null },
        retentionWake,
      );
    }
    const providerName = input.providerName?.trim() || null;
    if (!providerName) {
      return attachInboxMediaRetentionWake(
        { kind: "skipped", reason: "missing_provider", threadContextTokensBefore: null },
        retentionWake,
      );
    }
    if (!normalizeHostedAiUsageAllowancePricedModelId(input.model)) {
      return attachInboxMediaRetentionWake(
        { kind: "skipped", reason: "unpriced_model", threadContextTokensBefore: null },
        retentionWake,
      );
    }

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
      return attachInboxMediaRetentionWake(
        { kind: "failed", reason: "exception", threadContextTokensBefore: null },
        retentionWake,
      );
    }

    if (
      outcome.kind === "compacted"
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
        const usageExtraction = usage.source === "estimated"
          ? {
              usageExtractionSourcePath:
                ASSISTANT_IDLE_COMPACTION_USAGE_ESTIMATE_SOURCE_PATH,
              usageExtractionVersion: ASSISTANT_IDLE_COMPACTION_USAGE_ESTIMATE_VERSION,
            }
          : {};
        const tokenPricingBasis = resolveHostedAiUsageTokenPricingBasis({
          model,
          providerName,
          serviceTier: outcome.serviceTier,
        });
        await recordUsage(
          buildAssistantMaintenanceUsageRecord({
            assistantSessionId,
            codexThreadId: threadId,
            credentialSource: input.credentialSource,
            featureKey: "assistant_idle_compact",
            memberId: input.memberId,
            model,
            providerName,
            tokenPricingBasis,
            triggerKind: "automation_idle_compact",
            usage,
            ...usageExtraction,
          }),
        );
      })().catch(() => undefined);
    }

    return attachInboxMediaRetentionWake(outcome, retentionWake);
  } finally {
    input.shutdownSignal?.removeEventListener("abort", onShutdownAbort);
    wakeWatchAbort.abort();
    await wakeWatch;
  }
}

function isInboxMediaRetentionAbortError(
  error: unknown,
  signal: AbortSignal,
): boolean {
  if (!signal.aborted) {
    return false;
  }
  if (signal.reason instanceof Error) {
    return error === signal.reason;
  }

  return error instanceof Error && error.message === "Inbox media retention aborted.";
}

function resolveInboxMediaRetentionFailureWake(): HostedIdleMaintenanceWake {
  return {
    nextWakeAt: new Date(Date.now() + HOSTED_INBOX_MEDIA_RETENTION_RETRY_DELAY_MS).toISOString(),
    nextWakeReason: "inbox_media_retention",
  };
}

function emitInboxMediaRetentionFailureLog(input: {
  error: unknown;
  memberId: string;
}): void {
  const diagnostics = buildHostedExecutionSafeErrorDiagnostics(input.error);
  emitHostedExecutionStructuredLog({
    component: "runtime",
    details: {
      failureCode: "inbox_media_retention_failed",
      ...(typeof diagnostics?.errorCode === "string"
        ? { failureErrorCode: diagnostics.errorCode }
        : {}),
      ...(typeof diagnostics?.errorName === "string"
        ? { failureErrorName: diagnostics.errorName }
        : {}),
      failureErrorDetailPresent: typeof diagnostics?.errorDetail === "string",
      ...(typeof diagnostics?.errorStatus === "number"
        ? { failureErrorStatus: diagnostics.errorStatus }
        : {}),
      failureMessagePresent:
        input.error instanceof Error && input.error.message.trim().length > 0,
      failureName: readHostedExecutionSafeErrorName(input.error) ?? null,
    },
    error: input.error,
    level: "warn",
    message:
      "Hosted idle maintenance could not run inbox media retention; retrying at the failure-backoff wake.",
    phase: "checkpoint",
    userId: input.memberId,
  });
}

function resolveInboxMediaRetentionImmediateWake(): HostedIdleMaintenanceWake {
  return {
    nextWakeAt: new Date().toISOString(),
    nextWakeReason: "inbox_media_retention",
  };
}

function resolveInboxMediaRetentionWake(
  result: InboxMediaRetentionResult,
): HostedIdleMaintenanceWake {
  if (result.hasMoreEligibleAttachments) {
    return resolveInboxMediaRetentionImmediateWake();
  }

  if (result.nextEligibleAt) {
    return {
      nextWakeAt: result.nextEligibleAt,
      nextWakeReason: "inbox_media_retention",
    };
  }

  return {};
}

function attachInboxMediaRetentionWake(
  outcome: HostedIdleMaintenanceOutcome,
  wake: HostedIdleMaintenanceWake,
): HostedIdleMaintenanceOutcome {
  if (!wake.nextWakeAt) {
    return outcome;
  }

  return {
    ...outcome,
    nextWakeAt: wake.nextWakeAt,
    nextWakeReason: wake.nextWakeReason,
  };
}

function buildInterruptedMaintenanceOutcome(input: {
  retentionWake?: HostedIdleMaintenanceWake;
  shutdownSignal: AbortSignal | null;
  vaultRoot?: string | null;
  wakeInterrupted: boolean;
}): HostedIdleMaintenanceOutcome {
  const outcome: HostedIdleMaintenanceOutcome = {
    kind: "skipped",
    reason: input.shutdownSignal?.aborted && !input.wakeInterrupted
      ? "shutdown"
      : "pending_work",
    threadContextTokensBefore: null,
  };

  if (!input.shutdownSignal?.aborted || input.wakeInterrupted || !input.vaultRoot) {
    return outcome;
  }

  if (input.retentionWake?.nextWakeAt) {
    return attachInboxMediaRetentionWake(outcome, input.retentionWake);
  }

  return attachInboxMediaRetentionWake(
    outcome,
    resolveInboxMediaRetentionFailureWake(),
  );
}
