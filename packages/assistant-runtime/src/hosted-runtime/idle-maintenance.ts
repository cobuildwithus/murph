import {
  compactWarmCodexThread,
  type CodexWarmThreadCompactionOutcome,
} from "@murphai/assistant-engine/assistant-codex";
import {
  runAssistantTranscriptContentRetention,
} from "@murphai/assistant-engine/assistant-store";
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
  resolveAssistantCodexUsageProviderName,
} from "@murphai/operator-config/assistant/target-runtime";
import {
  buildHostedExecutionSafeErrorDiagnostics,
  emitHostedExecutionStructuredLog,
  readHostedExecutionSafeErrorName,
} from "@murphai/hosted-execution";
import {
  archiveClosedIntegrationIngestShards,
  runGeneratedImageCaptureRetention,
  type ArchiveClosedIntegrationIngestShardsResult,
  type RunGeneratedImageCaptureRetentionResult,
} from "@murphai/core";
import {
  runInboxMediaRetention,
  runInboxEnvelopeMigration,
  runInboxTextRetention,
  type InboxMediaRetentionMaterializeResult,
  type InboxMediaRetentionResult,
  type InboxTextRetentionResult,
} from "@murphai/inboxd/retention";

import type { RuntimeWakeSignal } from "./runtime-wake.ts";
import {
  HOSTED_GROUP_IDLE_COMPACT_MIN_THREAD_TOKENS,
  HOSTED_IDLE_COMPACT_MIN_THREAD_TOKENS,
  HOSTED_IDLE_COMPACT_TIMEOUT_MS,
  HOSTED_INTEGRATION_INGEST_ARCHIVE_TIMEOUT_MS,
} from "./idle-maintenance-limits.ts";
import {
  runHostedPendingAssistantInputContentRetention,
} from "./pending-input-index.ts";

export {
  HOSTED_GROUP_IDLE_COMPACT_MIN_THREAD_TOKENS,
  HOSTED_IDLE_COMPACT_MIN_THREAD_TOKENS,
  HOSTED_IDLE_COMPACT_TIMEOUT_MS,
  HOSTED_INTEGRATION_INGEST_ARCHIVE_TIMEOUT_MS,
} from "./idle-maintenance-limits.ts";

// Personal threads keep the measured post-compaction floor (~40k tokens).
// Group threads can accumulate many messages between turns and amortize a
// lower threshold. Keep both below the hosted Codex auto-compact ceiling so
// idle shutdown can compact large-but-below-ceiling threads before the next
// wake pays the full resend cost.
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
      threadContextTokensBefore: number | null;
    } & HostedIdleMaintenanceWake);

// One idle-checkpoint maintenance step: bounded media retention, abortable
// integration-ingest archiving, and opportunistic fail-open thread compaction.
// Runs only on TTL idle shutdown (never deploy evacuation). A pending wake
// aborts it immediately; the engine kills the warm process before returning,
// so the idle checkpoint that snapshots the Codex home never captures a rollout
// mid-teardown. Future idle-time maintenance belongs here as additional plain
// statements.
export async function runHostedIdleCheckpointMaintenance(input: {
  credentialSource: AssistantUsageCredentialSource;
  materializeRetentionCandidatePaths?: ((
    storedPaths: readonly string[]
  ) => Promise<InboxMediaRetentionMaterializeResult | void>) | null;
  memberId: string;
  model: string | null;
  pendingWork: boolean;
  persistGeneratedImageRetention?: (<T>(write: () => Promise<T>) => Promise<T>) | null;
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
      const vaultRoot = input.vaultRoot;
      try {
        const pendingInputRetention =
          await runHostedPendingAssistantInputContentRetention({
            signal: abortController.signal,
            vaultRoot: input.vaultRoot,
          });
        retentionWake = resolveAssistantTranscriptRetentionWake(
          pendingInputRetention.nextEligibleAt,
        );
        const transcriptRetention =
          await runAssistantTranscriptContentRetention({
            signal: abortController.signal,
            vault: input.vaultRoot,
          });
        retentionWake = mergeInboxRetentionWakes(
          retentionWake,
          resolveAssistantTranscriptRetentionWake(
            transcriptRetention.nextEligibleAt,
          ),
        );
        const retentionResult = await runInboxMediaRetention({
          materializeCandidatePaths: input.materializeRetentionCandidatePaths ?? undefined,
          ...(input.pendingWork ? { maxAttachments: 1 } : {}),
          protectedAttachmentIds: input.protectedAttachmentIds,
          protectedCaptureIds: input.protectedCaptureIds,
          protectedStoredPaths: input.protectedStoredPaths,
          signal: abortController.signal,
          vaultRoot: input.vaultRoot,
        });
        retentionWake = mergeInboxRetentionWakes(
          retentionWake,
          resolveInboxMediaRetentionWake(retentionResult),
        );
        const retireGeneratedImages = () => runGeneratedImageCaptureRetention({
          materializeCandidatePaths:
            input.materializeRetentionCandidatePaths ?? undefined,
          ...(input.pendingWork ? { maxCaptures: 1 } : {}),
          protectedCaptureIds: input.protectedCaptureIds,
          protectedStoredPaths: input.protectedStoredPaths,
          signal: abortController.signal,
          vaultRoot,
        });
        const generatedImageRetention = input.persistGeneratedImageRetention
          ? await input.persistGeneratedImageRetention(retireGeneratedImages)
          : await retireGeneratedImages();
        if (generatedImageRetention.blockedCaptureCount > 0) {
          emitGeneratedImageRetentionBlockedLog({
            memberId: input.memberId,
            result: generatedImageRetention,
          });
        }
        retentionWake = mergeInboxRetentionWakes(
          retentionWake,
          resolveGeneratedImageRetentionWake(generatedImageRetention),
        );
        const envelopeMigration = await runInboxEnvelopeMigration({
          apply: true,
          ...(input.pendingWork ? { maxFiles: 1 } : {}),
          signal: abortController.signal,
          vaultRoot: input.vaultRoot,
        });
        if (envelopeMigration.hasMore) {
          retentionWake = mergeInboxRetentionWakes(
            retentionWake,
            resolveInboxMediaRetentionImmediateWake(),
          );
        }
        // Text retention runs after the media pass and shares its wake pointer:
        // both expire inbound content on the same 14-day clock, so a second
        // pointer would only create two schedules to keep in agreement.
        const textRetentionResult = await runInboxTextRetention({
          ...(input.pendingWork ? { maxCaptures: 1 } : {}),
          signal: abortController.signal,
          vaultRoot: input.vaultRoot,
        });
        retentionWake = mergeInboxRetentionWakes(
          retentionWake,
          resolveInboxTextRetentionWake(textRetentionResult),
        );
      } catch (error) {
        if (isInboxRetentionAbortError(error, abortController.signal)) {
          return buildInterruptedMaintenanceOutcome({
            shutdownSignal: input.shutdownSignal,
            vaultRoot: input.vaultRoot,
            wakeInterrupted,
          });
        }
        // Retention is opportunistic maintenance; a cleanup miss must not block
        // checkpointing or member-visible wake handling. Emit the failure
        // through the shared structured-log boundary so the cause is not
        // silently dropped (Observability And Bounded Growth invariant: error
        // logs must include both a stable code and a redacted cause).
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
      // but archive or Codex compaction would delay member-visible work.
      return attachInboxMediaRetentionWake(
        { kind: "skipped", reason: "pending_work", threadContextTokensBefore: null },
        retentionWake,
      );
    }
    if (input.vaultRoot) {
      const archiveSignal = AbortSignal.any([
        abortController.signal,
        AbortSignal.timeout(HOSTED_INTEGRATION_INGEST_ARCHIVE_TIMEOUT_MS),
      ]);
      try {
        const archiveResult = await archiveClosedIntegrationIngestShards({
          signal: archiveSignal,
          vaultRoot: input.vaultRoot,
        });
        if (
          archiveResult.archivedShardCount > 0
          || archiveResult.repairedShardCount > 0
          || archiveResult.blockedShardCount > 0
        ) {
          emitIntegrationIngestArchiveLog({
            memberId: input.memberId,
            result: archiveResult,
          });
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          return buildInterruptedMaintenanceOutcome({
            retentionWake,
            shutdownSignal: input.shutdownSignal,
            vaultRoot: input.vaultRoot,
            wakeInterrupted,
          });
        }
        emitIntegrationIngestArchiveFailureLog({
          error,
          memberId: input.memberId,
        });
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
    const routedProviderName = input.providerName?.trim() || null;
    if (!routedProviderName) {
      return attachInboxMediaRetentionWake(
        { kind: "skipped", reason: "missing_provider", threadContextTokensBefore: null },
        retentionWake,
      );
    }
    const usageProviderName = resolveAssistantCodexUsageProviderName(
      routedProviderName,
    );
    // Structurally fail-open: the runtime seam must not assume the engine
    // helper can never throw — an exception here aborts idle maintenance,
    // never the checkpoint.
    let outcome: CodexWarmThreadCompactionOutcome;
    const compactStartedAt = new Date().toISOString();
    try {
      outcome = await compactWarmCodexThread({
        canAccountForModel: (model) =>
          model !== null &&
          normalizeHostedAiUsageAllowancePricedModelId(model) !== null,
        groupMinThreadTokens: HOSTED_GROUP_IDLE_COMPACT_MIN_THREAD_TOKENS,
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

    if (outcome.kind === "skipped" && outcome.reason === "model_not_accountable") {
      return attachInboxMediaRetentionWake(
        {
          kind: "skipped",
          reason: outcome.model ? "unpriced_model" : "missing_model",
          threadContextTokensBefore: outcome.threadContextTokensBefore,
        },
        retentionWake,
      );
    }

    const boundModel = outcome.kind === "compacted"
      ? outcome.model
      : null;
    if (
      outcome.kind === "compacted"
      && boundModel
      && input.recordUsage
      && input.resolveAssistantSessionId
    ) {
      // The entire accounting path (session resolution + record write) is
      // fire-and-forget: billing telemetry must never break the idle
      // checkpoint nor delay a pending wake.
      const { recordUsage, resolveAssistantSessionId } = input;
      const { threadId, usage } = outcome;
      const model = boundModel;
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
          providerName: usageProviderName,
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
            occurredAt: compactStartedAt,
            providerName: usageProviderName,
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

function emitGeneratedImageRetentionBlockedLog(input: {
  memberId: string;
  result: RunGeneratedImageCaptureRetentionResult;
}): void {
  emitHostedExecutionStructuredLog({
    component: "runtime",
    details: {
      failureCode: "generated_image_retention_capture_blocked",
      generatedImageRetentionBlockedCaptures: input.result.blockedCaptureCount,
      generatedImageRetentionRetiredCaptures: input.result.retiredCaptureCount,
    },
    level: "warn",
    message:
      "Hosted idle maintenance retired valid generated images, but one or more captures require repair.",
    phase: "checkpoint",
    userId: input.memberId,
  });
}

function emitIntegrationIngestArchiveLog(input: {
  memberId: string;
  result: ArchiveClosedIntegrationIngestShardsResult;
}): void {
  const blocked = input.result.blockedShardCount > 0;
  emitHostedExecutionStructuredLog({
    component: "runtime",
    details: {
      integrationIngestArchiveBytes: input.result.archivedByteCount,
      integrationIngestArchiveRepairedShards: input.result.repairedShardCount,
      integrationIngestArchiveSourceBytes: input.result.sourceByteCount,
      integrationIngestArchivedShards: input.result.archivedShardCount,
      integrationIngestBlockedShards: input.result.blockedShardCount,
      integrationIngestScannedShards: input.result.scannedShardCount,
    },
    level: blocked ? "warn" : "info",
    message: blocked
      ? "Hosted idle maintenance archived eligible integration ingest shards, but one or more shards require repair."
      : "Hosted idle maintenance archived eligible integration ingest shards.",
    phase: "checkpoint",
    userId: input.memberId,
  });
}

function emitIntegrationIngestArchiveFailureLog(input: {
  error: unknown;
  memberId: string;
}): void {
  const diagnostics = buildHostedExecutionSafeErrorDiagnostics(input.error);
  emitHostedExecutionStructuredLog({
    component: "runtime",
    details: {
      failureCode: "integration_ingest_archive_failed",
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
      "Hosted idle maintenance could not archive closed integration ingest shards; checkpointing will continue.",
    phase: "checkpoint",
    userId: input.memberId,
  });
}

function isInboxRetentionAbortError(
  error: unknown,
  signal: AbortSignal,
): boolean {
  if (!signal.aborted) {
    return false;
  }
  if (signal.reason instanceof Error) {
    return error === signal.reason;
  }

  return error instanceof Error
    && (
      error.message === "Inbox media retention aborted."
      || error.message === "Inbox text retention aborted."
    );
}

function resolveInboxTextRetentionWake(
  result: InboxTextRetentionResult,
): HostedIdleMaintenanceWake {
  if (result.hasMoreEligibleCaptures) {
    return resolveInboxMediaRetentionImmediateWake();
  }

  if (result.nextEligibleAt) {
    return {
      nextWakeAt: result.nextEligibleAt,
      nextWakeReason: "inbox_media_retention",
    };
  }

  if (result.legacyCapturesSkipped > 0) {
    return resolveInboxMediaRetentionFailureWake();
  }

  return {};
}

function resolveGeneratedImageRetentionWake(
  result: RunGeneratedImageCaptureRetentionResult,
): HostedIdleMaintenanceWake {
  if (result.hasMoreEligibleCaptures) {
    return resolveInboxMediaRetentionImmediateWake();
  }

  return resolveAssistantTranscriptRetentionWake(result.nextEligibleAt);
}

function resolveAssistantTranscriptRetentionWake(
  nextEligibleAt: string | null,
): HostedIdleMaintenanceWake {
  return nextEligibleAt
    ? {
        nextWakeAt: nextEligibleAt,
        nextWakeReason: "inbox_media_retention",
      }
    : {};
}

/** Keep the earlier of two retention wakes so neither pass is scheduled late. */
function mergeInboxRetentionWakes(
  left: HostedIdleMaintenanceWake,
  right: HostedIdleMaintenanceWake,
): HostedIdleMaintenanceWake {
  if (!left.nextWakeAt) {
    return right;
  }
  if (!right.nextWakeAt) {
    return left;
  }

  return Date.parse(right.nextWakeAt) < Date.parse(left.nextWakeAt) ? right : left;
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
