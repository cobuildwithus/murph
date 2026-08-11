import type {
  HostedExecutionSystemWake,
  HostedExecutionWake,
} from "@murphai/hosted-execution";
import {
  scheduleDeviceActivityTriggeredAutomations,
  type AssistantExecutionContext,
} from "@murphai/assistant-engine";
import {
  emitHostedExecutionStructuredLog,
  isHostedConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  applyHostedMemberPreferences,
  hydrateHostedExecutionDefaultTarget,
  prepareHostedWakeContext,
} from "./context.ts";
import { createHostedAssistantTurnEnvironment } from "./environment.ts";
import {
  createNoopMailboxEffect,
  type HostedMailboxOutcome,
} from "./events/mailbox-outcome.ts";
import {
  isHostedDeviceSyncMaintenanceModuleLoadError,
  loadHostedDeviceSyncMaintenanceModule,
} from "./device-sync-maintenance-import.ts";
import {
  loadHostedClinicalRecordsMaintenanceModule,
} from "./clinical-records-maintenance-import.ts";
import type {
  HostedMailboxExecutionMetrics,
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";
import {
  HOSTED_ASSISTANT_WAKE_REASON,
  HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
  createHostedRuntimeWakeCandidate,
  selectHostedRuntimeWakeCandidate,
} from "./wake-candidates.ts";

export { emitHostedAssistantProviderTraceLog } from "./events/provider-trace-log.ts";

const DIRECT_CONVERSATION_WAKE_ERROR_MESSAGE =
  "Hosted conversation wakes must be imported through mailbox AssistantInputEvent staging.";
export async function executeHostedMailboxEvent(input: {
  wake: HostedExecutionWake;
  executionContext: AssistantExecutionContext;
  forceQueueOnlyAssistantNotification?: boolean;
  operatorHomeRoot?: string | null;
  preferenceAppliedAt?: string;
  preferenceCausalSeq?: string;
  shouldYieldAssistantAskCompletion?: (() => boolean) | null;
  shouldYieldClinicalRecords?: (() => boolean) | null;
  shouldYieldDeviceSync?: (() => boolean) | null;
  sourceMailboxItemId?: string | null;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
  > & Partial<Pick<NormalizedHostedAssistantRuntimeConfig, "parserToolchain">>;
  runtimeEnv: Readonly<Record<string, string>>;
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<HostedMailboxExecutionMetrics> {
  if (isHostedConversationMessageWake(input.wake)) {
    throw new TypeError(DIRECT_CONVERSATION_WAKE_ERROR_MESSAGE);
  }
  if (input.wake.kind === "runtime.pending-effects-reconcile-requested") {
    return {
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "runtime-control",
      nextWakeAt: null,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    };
  }

  const bootstrapResult = await prepareHostedWakeContext(
    input.vaultRoot,
    input.wake,
    input.runtimeEnv,
    input.runtime.resolvedConfig,
    {
      operatorHomeRoot: input.operatorHomeRoot ?? null,
    },
  );
  const bootstrappedExecutionContext = await hydrateHostedExecutionDefaultTarget(
    input.executionContext,
    {
      homeDirectory: input.operatorHomeRoot ?? undefined,
      runtimeEnv: input.runtimeEnv,
    },
  );
  const mailboxEffect = await handleHostedMailboxEvent({
    wake: input.wake,
    executionContext: bootstrappedExecutionContext,
    forceQueueOnlyAssistantNotification: input.forceQueueOnlyAssistantNotification === true,
    operatorHomeRoot: input.operatorHomeRoot ?? null,
    preferenceAppliedAt: input.preferenceAppliedAt,
    preferenceCausalSeq: input.preferenceCausalSeq,
    runtime: input.runtime,
    runtimeEnv: input.runtimeEnv,
    signal: input.signal ?? null,
    ...(input.shouldYieldClinicalRecords
      ? { shouldYieldClinicalRecords: input.shouldYieldClinicalRecords }
      : {}),
    ...(input.shouldYieldAssistantAskCompletion
      ? { shouldYieldAssistantAskCompletion: input.shouldYieldAssistantAskCompletion }
      : {}),
    ...(input.shouldYieldDeviceSync
      ? { shouldYieldDeviceSync: input.shouldYieldDeviceSync }
      : {}),
    sourceMailboxItemId: input.sourceMailboxItemId ?? null,
    vaultRoot: input.vaultRoot,
  });

  return {
    bootstrapResult,
    conversationMetrics: mailboxEffect.conversationMetrics,
    ...(mailboxEffect.deliveryIntentIds === undefined
      ? {}
      : { deliveryIntentIds: mailboxEffect.deliveryIntentIds }),
    mailboxLane: mailboxEffect.mailboxLane,
    nextWakeAt: mailboxEffect.nextWakeAt,
    ...(Object.hasOwn(mailboxEffect, "nextWakeReason")
      ? { nextWakeReason: mailboxEffect.nextWakeReason ?? null }
      : {}),
    postCheckpointRecord: mailboxEffect.postCheckpointRecord,
    redactedLogEntries: mailboxEffect.redactedLogEntries ?? [],
  };
}

async function handleHostedMailboxEvent(input: {
  wake: HostedExecutionWake;
  executionContext: AssistantExecutionContext;
  forceQueueOnlyAssistantNotification: boolean;
  operatorHomeRoot: string | null;
  preferenceAppliedAt?: string;
  preferenceCausalSeq?: string;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
  > & Partial<Pick<NormalizedHostedAssistantRuntimeConfig, "parserToolchain">>;
  runtimeEnv: Readonly<Record<string, string>>;
  signal: AbortSignal | null;
  shouldYieldAssistantAskCompletion?: (() => boolean) | null;
  shouldYieldClinicalRecords?: (() => boolean) | null;
  shouldYieldDeviceSync?: (() => boolean) | null;
  sourceMailboxItemId: string | null;
  vaultRoot: string;
}): Promise<HostedMailboxOutcome> {
  if (isHostedConversationMessageWake(input.wake)) {
    throw new TypeError(DIRECT_CONVERSATION_WAKE_ERROR_MESSAGE);
  }

  return executeHostedSystemWake({
    wake: input.wake,
    executionContext: input.executionContext,
    forceQueueOnlyAssistantNotification: input.forceQueueOnlyAssistantNotification,
    operatorHomeRoot: input.operatorHomeRoot,
    preferenceAppliedAt: input.preferenceAppliedAt,
    preferenceCausalSeq: input.preferenceCausalSeq,
    runtime: input.runtime,
    runtimeEnv: input.runtimeEnv,
    signal: input.signal,
    ...(input.shouldYieldClinicalRecords
      ? { shouldYieldClinicalRecords: input.shouldYieldClinicalRecords }
      : {}),
    ...(input.shouldYieldAssistantAskCompletion
      ? { shouldYieldAssistantAskCompletion: input.shouldYieldAssistantAskCompletion }
      : {}),
    ...(input.shouldYieldDeviceSync
      ? { shouldYieldDeviceSync: input.shouldYieldDeviceSync }
      : {}),
    sourceMailboxItemId: input.sourceMailboxItemId,
    vaultRoot: input.vaultRoot,
  });
}

async function executeHostedSystemWake(input: {
  wake: HostedExecutionSystemWake;
  executionContext: AssistantExecutionContext;
  forceQueueOnlyAssistantNotification: boolean;
  operatorHomeRoot: string | null;
  preferenceAppliedAt?: string;
  preferenceCausalSeq?: string;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "platform" | "platformEnv" | "resolvedConfig"
  > & Partial<Pick<NormalizedHostedAssistantRuntimeConfig, "parserToolchain">>;
  runtimeEnv: Readonly<Record<string, string>>;
  signal: AbortSignal | null;
  shouldYieldAssistantAskCompletion?: (() => boolean) | null;
  shouldYieldClinicalRecords?: (() => boolean) | null;
  shouldYieldDeviceSync?: (() => boolean) | null;
  sourceMailboxItemId: string | null;
  vaultRoot: string;
}): Promise<HostedMailboxOutcome> {
  switch (input.wake.kind) {
    case "member.activated": {
      const { executeHostedMemberActivatedWake } = await import(
        "./events/assistant-notification.ts"
      );
      return executeHostedMemberActivatedWake({
        wake: input.wake,
        executionContext: input.executionContext,
        sourceMailboxItemId: input.sourceMailboxItemId,
        turnEnvironment: createHostedAssistantTurnEnvironment({
          operatorHomeRoot: input.operatorHomeRoot,
          runtimeEnv: input.runtimeEnv,
          vaultRoot: input.vaultRoot,
        }),
        vaultRoot: input.vaultRoot,
      });
    }
    case "member.channels.updated":
      return createNoopMailboxEffect({
        conversationMetrics: null,
        mailboxLane: "member-channels-updated",
      });
    case "member.preferences.updated":
      await applyHostedMemberPreferences(
        input.vaultRoot,
        input.wake,
        input.preferenceCausalSeq ?? "0",
        input.preferenceAppliedAt,
      );
      return createNoopMailboxEffect({
        conversationMetrics: null,
        mailboxLane: "member-preferences-updated",
      });
    case "assistant.notification.requested": {
      const { executeHostedAssistantNotificationWake } = await import(
        "./events/assistant-notification.ts"
      );
      return executeHostedAssistantNotificationWake({
        wake: input.wake,
        executionContext: input.executionContext,
        forceQueueOnly: input.forceQueueOnlyAssistantNotification,
        sourceMailboxItemId: input.sourceMailboxItemId,
        turnEnvironment: createHostedAssistantTurnEnvironment({
          operatorHomeRoot: input.operatorHomeRoot,
          runtimeEnv: input.runtimeEnv,
          vaultRoot: input.vaultRoot,
        }),
        vaultRoot: input.vaultRoot,
      });
    }
    case "assistant.ask.completed": {
      const { executeHostedAssistantAskCompletedWake } = await import(
        "./events/assistant-ask-completion.ts"
      );
      return executeHostedAssistantAskCompletedWake({
        wake: input.wake,
        executionContext: input.executionContext,
        shouldYield: input.shouldYieldAssistantAskCompletion ?? null,
        signal: input.signal,
        sourceMailboxItemId: input.sourceMailboxItemId,
        turnEnvironment: createHostedAssistantTurnEnvironment({
          operatorHomeRoot: input.operatorHomeRoot,
          runtimeEnv: input.runtimeEnv,
          vaultRoot: input.vaultRoot,
        }),
        vaultRoot: input.vaultRoot,
      });
    }
    case "clinical-records.sync-requested": {
      const {
        runHostedClinicalRecordsSyncWakeLane,
      } = await loadHostedClinicalRecordsMaintenanceModule();
      const clinicalRecordsMetrics = await runHostedClinicalRecordsSyncWakeLane({
        clinicalRecordsPort: input.runtime.platform.clinicalRecordsPort ?? null,
        ...(input.shouldYieldClinicalRecords
          ? { shouldYieldClinicalRecords: input.shouldYieldClinicalRecords }
          : {}),
        signal: input.signal,
        vaultRoot: input.vaultRoot,
        wake: input.wake,
      });
      return createNoopMailboxEffect({
        conversationMetrics: null,
        mailboxLane: "clinical-records",
        ...(clinicalRecordsMetrics.outcome
          ? {
              postCheckpointRecord: {
                kind: "clinical-records.outcome-recorded",
                request: clinicalRecordsMetrics.outcome,
              },
            }
          : {}),
      });
    }
    case "device-sync.wake":
      const {
        runHostedDeviceSyncWakeLane,
      } = await loadHostedDeviceSyncMaintenanceModule().catch((error: unknown) => {
        emitHostedDeviceSyncMaintenanceModuleLoadFailureLog({
          error,
          wake: input.wake,
        });
        throw error;
      });
      const deviceSyncMetrics = await runHostedDeviceSyncWakeLane({
        deviceSyncPort: input.runtime.platform.deviceSyncPort ?? null,
        platformEnv: input.runtime.platformEnv,
        runtimeLogPlatform: input.runtime.platform,
        resolvedConfig: input.runtime.resolvedConfig,
        ...(input.shouldYieldDeviceSync
          ? { shouldYieldDeviceSync: input.shouldYieldDeviceSync }
          : {}),
        ...(input.signal ? { signal: input.signal } : {}),
        timeoutMs: input.runtime.commitTimeoutMs,
        vaultRoot: input.vaultRoot,
        wake: input.wake,
      });
      const activityAutomation = input.shouldYieldDeviceSync?.() === true
        ? { matched: 0, nextWakeAt: null, scheduled: 0 }
        : await scheduleDeviceActivityTriggeredAutomations({
          vault: input.vaultRoot,
        }).catch((error: unknown) => {
          emitHostedDeviceActivityAutomationFailureLog({
            error,
            wake: input.wake,
          });
          return { matched: 0, nextWakeAt: null, scheduled: 0 };
        });
      const nextWake = selectHostedRuntimeWakeCandidate([
        createHostedRuntimeWakeCandidate(
          deviceSyncMetrics.nextWakeAt,
          deviceSyncMetrics.nextWakeReason ?? HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
        ),
        createHostedRuntimeWakeCandidate(
          activityAutomation.nextWakeAt,
          HOSTED_ASSISTANT_WAKE_REASON,
        ),
      ]);
      return createNoopMailboxEffect({
        conversationMetrics: null,
        mailboxLane: "device-sync",
        nextWakeAt: nextWake.at,
        ...(nextWake.reason ? { nextWakeReason: nextWake.reason } : {}),
        postCheckpointRecord: deviceSyncMetrics.postCheckpointRecord ?? null,
      });
    case "environment-voice.captured": {
      const { executeHostedEnvironmentVoiceWake } = await import(
        "./events/environment-voice.ts"
      );
      return await executeHostedEnvironmentVoiceWake({
        executionContext: input.executionContext,
        runtime: input.runtime,
        signal: input.signal,
        turnEnvironment: createHostedAssistantTurnEnvironment({
          operatorHomeRoot: input.operatorHomeRoot,
          runtimeEnv: input.runtimeEnv,
          vaultRoot: input.vaultRoot,
        }),
        vaultRoot: input.vaultRoot,
        wake: input.wake,
      });
    }
    case "runtime.manual-requested":
    case "runtime.pending-effects-reconcile-requested":
    case "runtime.maintenance-requested":
    case "runtime.browser-vault-refresh-requested":
    case "runtime.device-sync-recovery-requested":
    case "runtime.mailbox-lag-observed":
      return createNoopMailboxEffect({
        conversationMetrics: null,
        mailboxLane: "runtime-control",
      });
    case "runtime.codex-auth-requested": {
      const { executeHostedCodexAuthWake } = await import(
        "./events/codex-auth.ts"
      );
      return await executeHostedCodexAuthWake({
        operatorHomeRoot: input.operatorHomeRoot,
        platform: input.runtime.platform,
        runtimeEnv: input.runtimeEnv,
        vaultRoot: input.vaultRoot,
        wake: input.wake,
      });
    }
    case "assistant.ask.requested":
      // The detached controller is the only owner of requested asks. Running
      // one through serial foreground maintenance would grant reply authority
      // to a background read and violate the single-writer boundary.
      throw new TypeError(
        "Hosted assistant ask request wakes must run through the detached read-only controller.",
      );
    case "vault-share.delivery":
      // The retired mailbox route skips legacy vault-share deliveries before
      // payload resolution; they must never enter system wake execution.
      throw new TypeError(
        "Retired hosted vault-share delivery wakes must never reach system wake execution.",
      );
    case "vault-share.revoke":
      // The retired mailbox route skips legacy vault-share revokes before
      // payload resolution; they must never enter system wake execution.
      throw new TypeError(
        "Retired hosted vault-share revoke wakes must never reach system wake execution.",
      );
    case "group-newsletter.email-needed":
      // Group newsletter email-needed wakes stage a private system note at
      // mailbox import and never enter the system wake execution path.
      throw new TypeError(
        'Hosted group newsletter email-needed wakes are staged at mailbox import and must never reach system wake execution.',
      );
    case "meal-photo.captured":
      // Meal photos become canonical meal records at mailbox import so their
      // staged object can be cleaned up only after the workspace checkpoint.
      throw new TypeError(
        "Hosted meal-photo wakes are landed at mailbox import and must never reach system wake execution.",
      );
  }

  const exhaustiveWake: never = input.wake;
  void exhaustiveWake;
  throw new TypeError('Unsupported hosted system wake kind.');
}

function emitHostedDeviceActivityAutomationFailureLog(input: {
  error: unknown;
  wake: HostedExecutionSystemWake;
}): void {
  emitHostedExecutionStructuredLog({
    component: "runtime",
    details: {
      eventCode: "assistant.device_activity_automation_failed",
    },
    error: input.error,
    level: "warn",
    message: "Hosted device activity automation pass failed; continuing device-sync wake.",
    phase: "wake.running",
    wake: input.wake,
  });
}

function emitHostedDeviceSyncMaintenanceModuleLoadFailureLog(input: {
  error: unknown;
  wake: HostedExecutionSystemWake;
}): void {
  emitHostedExecutionStructuredLog({
    component: "runtime",
    details: {
      eventCode: "device-sync.module_load_failed",
      moduleLoadError: isHostedDeviceSyncMaintenanceModuleLoadError(input.error),
    },
    error: input.error,
    level: "error",
    message: "Hosted device-sync wake failed to load the maintenance module.",
    phase: "wake.running",
    wake: input.wake,
  });
}
