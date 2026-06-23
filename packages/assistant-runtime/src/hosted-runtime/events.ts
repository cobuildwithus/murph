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
  hydrateHostedExecutionDefaultTarget,
  prepareHostedWakeContext,
} from "./context.ts";
import { createHostedAssistantTurnEnvironment } from "./environment.ts";
import {
  executeHostedAssistantNotificationWake,
  executeHostedMemberActivatedWake,
} from "./events/assistant-notification.ts";
import {
  createNoopMailboxEffect,
  type HostedMailboxOutcome,
} from "./events/mailbox-outcome.ts";
import { executeHostedCodexAuthWake } from "./events/codex-auth.ts";
import { runHostedDeviceSyncWakeLane } from "./maintenance.ts";
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

export { executeHostedAssistantNotificationWake };
export { emitHostedAssistantProviderTraceLog } from "./events/provider-trace-log.ts";

const DIRECT_CONVERSATION_WAKE_ERROR_MESSAGE =
  "Hosted conversation wakes must be imported through mailbox AssistantInputEvent staging.";
export async function executeHostedMailboxEvent(input: {
  wake: HostedExecutionWake;
  executionContext: AssistantExecutionContext;
  forceQueueOnlyAssistantNotification?: boolean;
  operatorHomeRoot?: string | null;
  shouldYieldDeviceSync?: (() => boolean) | null;
  sourceMailboxItemId?: string | null;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
  >;
  runtimeEnv: Readonly<Record<string, string>>;
  vaultRoot: string;
}): Promise<HostedMailboxExecutionMetrics> {
  if (isHostedConversationMessageWake(input.wake)) {
    throw new TypeError(DIRECT_CONVERSATION_WAKE_ERROR_MESSAGE);
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
    runtime: input.runtime,
    runtimeEnv: input.runtimeEnv,
    ...(input.shouldYieldDeviceSync
      ? { shouldYieldDeviceSync: input.shouldYieldDeviceSync }
      : {}),
    sourceMailboxItemId: input.sourceMailboxItemId ?? null,
    vaultRoot: input.vaultRoot,
  });

  return {
    bootstrapResult,
    conversationMetrics: mailboxEffect.conversationMetrics,
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
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
  >;
  runtimeEnv: Readonly<Record<string, string>>;
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
    runtime: input.runtime,
    runtimeEnv: input.runtimeEnv,
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
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "platform" | "platformEnv" | "resolvedConfig"
  >;
  runtimeEnv: Readonly<Record<string, string>>;
  shouldYieldDeviceSync?: (() => boolean) | null;
  sourceMailboxItemId: string | null;
  vaultRoot: string;
}): Promise<HostedMailboxOutcome> {
  switch (input.wake.kind) {
    case "member.activated":
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
    case "member.channels.updated":
      return createNoopMailboxEffect({
        conversationMetrics: null,
        mailboxLane: "member-channels-updated",
      });
    case "assistant.notification.requested":
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
    case "device-sync.wake":
      const deviceSyncMetrics = await runHostedDeviceSyncWakeLane({
        deviceSyncPort: input.runtime.platform.deviceSyncPort ?? null,
        platformEnv: input.runtime.platformEnv,
        runtimeLogPlatform: input.runtime.platform,
        resolvedConfig: input.runtime.resolvedConfig,
        ...(input.shouldYieldDeviceSync
          ? { shouldYieldDeviceSync: input.shouldYieldDeviceSync }
          : {}),
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
    case "runtime.manual-requested":
    case "runtime.browser-vault-refresh-requested":
    case "runtime.device-sync-recovery-requested":
    case "runtime.mailbox-lag-observed":
      return createNoopMailboxEffect({
        conversationMetrics: null,
        mailboxLane: "runtime-control",
      });
    case "runtime.codex-auth-requested":
      return await executeHostedCodexAuthWake({
        operatorHomeRoot: input.operatorHomeRoot,
        platform: input.runtime.platform,
        runtimeEnv: input.runtimeEnv,
        vaultRoot: input.vaultRoot,
        wake: input.wake,
      });
    case "vault-share.delivery":
      // Vault-share deliveries are landed deterministically at mailbox import
      // (vault-share-import.ts) and never enter the system wake execution path.
      throw new TypeError(
        'Hosted vault-share delivery wakes are landed at mailbox import and must never reach system wake execution.',
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
