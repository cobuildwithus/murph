import "server-only";

import {
  listConfiguredDeviceSyncReconnectTargets,
  readConfiguredDeviceSyncConnectTargetConfigs,
} from "@murphai/device-syncd/connect-config";
import type { PublicDeviceSyncAccount } from "@murphai/device-syncd/public-ingress";
import {
  buildHostedExecutionAssistantNotificationRequestedWake,
} from "@murphai/hosted-execution";

import {
  appendHostedMailboxEnvelopeTx,
  readHostedMailboxItemByDedupeKey,
} from "../hosted-mailbox/store";
import { readHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import { readHostedMemberRoutingState } from "../hosted-onboarding/hosted-member-routing-store";
import {
  resolveHostedMemberAssistantNotificationRoute,
  resolveHostedMemberMessagingState,
} from "../hosted-onboarding/messaging-state";
import {
  signalHostedMailboxAppendRuntime,
} from "../hosted-orchestration/signal-runtime";
import {
  formatHostedExecutionSafeLogErrorDetails,
} from "../hosted-execution/logging";
import { recordHostedRuntimeLogTx } from "../hosted-workspace/store";
import {
  createHostedDeviceConnectIntentTx,
  HOSTED_DEVICE_RECONNECT_NOTICE_INTENT_TTL_MS,
} from "./connect-intents";
import {
  resolveHostedDeviceSyncConnectTargetForConnection,
} from "./settings-surface";
import { resolveHostedDeviceSyncBrowserProviderLabel } from "./provider-label";
import type { HostedPrismaTransactionClient } from "./prisma-store";

interface HostedDeviceSyncReconnectNoticeAppendResult {
  inserted: boolean;
  mailboxItemId: string | null;
  outcome: "duplicate" | "inserted" | "skipped_no_route" | "skipped_no_target";
}

export async function appendHostedDeviceSyncReconnectNoticeTx(input: {
  appliedAt: string;
  connection: PublicDeviceSyncAccount;
  failureCode: string | null;
  observedTokenVersion: number | null;
  request: Request;
  tx: HostedPrismaTransactionClient;
  userId: string;
}): Promise<HostedDeviceSyncReconnectNoticeAppendResult> {
  const eventId = buildHostedDeviceSyncReconnectNoticeEventId(input);
  const existing = await readHostedMailboxItemByDedupeKey({
    dedupeKey: eventId,
    prisma: input.tx,
    userId: input.userId,
  });

  if (existing) {
    await recordHostedDeviceSyncReconnectNoticeLogTx({
      connection: input.connection,
      eventCode: "device-sync.reconnect_notice_duplicate",
      failureCode: input.failureCode,
      outcome: "duplicate",
      tx: input.tx,
      userId: input.userId,
    });
    return {
      inserted: false,
      mailboxItemId: existing.id,
      outcome: "duplicate",
    };
  }

  const target = resolveHostedDeviceSyncReconnectTarget(input.connection);
  if (!target) {
    await recordHostedDeviceSyncReconnectNoticeLogTx({
      connection: input.connection,
      eventCode: "device-sync.reconnect_notice_skipped",
      failureCode: input.failureCode,
      outcome: "skipped_no_target",
      tx: input.tx,
      userId: input.userId,
    });
    return {
      inserted: false,
      mailboxItemId: null,
      outcome: "skipped_no_target",
    };
  }

  const [identity, routing] = await Promise.all([
    readHostedMemberIdentity({
      memberId: input.userId,
      prisma: input.tx,
    }),
    readHostedMemberRoutingState({
      memberId: input.userId,
      prisma: input.tx,
    }),
  ]);
  const messaging = resolveHostedMemberMessagingState({
    identity,
    routing,
  });
  const route = resolveHostedMemberAssistantNotificationRoute({
    linqChatId: routing?.linqChatId ?? null,
    linqContactLookupKey: routing?.pendingLinqParticipantContact?.lookupKey ?? null,
    linqRecipientPhone: routing?.linqRecipientPhone ?? null,
    memberId: input.userId,
    memberPhoneNumber: identity?.phoneNumber ?? null,
    messaging,
  });

  if (!route) {
    await recordHostedDeviceSyncReconnectNoticeLogTx({
      connection: input.connection,
      eventCode: "device-sync.reconnect_notice_skipped",
      failureCode: input.failureCode,
      outcome: "skipped_no_route",
      tx: input.tx,
      userId: input.userId,
    });
    return {
      inserted: false,
      mailboxItemId: null,
      outcome: "skipped_no_route",
    };
  }

  const intent = await createHostedDeviceConnectIntentTx({
    connectSourceId: target.connectSourceId,
    connectTarget: target.connectTarget,
    memberId: input.userId,
    now: new Date(),
    provider: target.provider,
    request: input.request,
    sourceProviderSlug: target.sourceProviderSlug ?? null,
    ttlMs: HOSTED_DEVICE_RECONNECT_NOTICE_INTENT_TTL_MS,
    tx: input.tx,
  });
  const message = buildHostedDeviceSyncReconnectNoticeMessage({
    providerLabel: resolveHostedDeviceSyncReconnectNoticeProviderLabel(input.connection),
    url: intent.connectUrl,
  });
  const wake = buildHostedExecutionAssistantNotificationRequestedWake({
    eventId,
    memberId: input.userId,
    notification: {
      deliveryDedupeToken: eventId,
      deliveryDispatchMode: "queue-only",
      deliveryIdempotencyKey: eventId,
      instructions: buildHostedDeviceSyncReconnectNoticeInstructions(),
      responsePolicy: {
        kind: "require_send_exact_text",
        text: message,
      },
      route,
    },
    occurredAt: input.appliedAt,
  });
  const append = await appendHostedMailboxEnvelopeTx({
    envelope: wake,
    tx: input.tx,
  });

  await recordHostedDeviceSyncReconnectNoticeLogTx({
    channel: route.channel,
    connection: input.connection,
    eventCode: "device-sync.reconnect_notice_created",
    failureCode: input.failureCode,
    outcome: append.inserted ? "inserted" : "duplicate",
    target,
    tx: input.tx,
    userId: input.userId,
  });

  return {
    inserted: append.inserted,
    mailboxItemId: append.item.id,
    outcome: append.inserted ? "inserted" : "duplicate",
  };
}

export async function startHostedDeviceSyncReconnectNoticeWorkflowBestEffort(
  mailboxItemId: string,
): Promise<void> {
  try {
    await signalHostedMailboxAppendRuntime({
      mailboxItemId,
    });
  } catch (error) {
    console.warn("Hosted device-sync reconnect notice Temporal signal failed after mailbox append.", {
      ...formatHostedExecutionSafeLogErrorDetails(error, {
        code: "HOSTED_DEVICE_SYNC_RECONNECT_NOTICE_TEMPORAL_SIGNAL_FAILED",
      }),
      mailboxItemIdPresent: mailboxItemId.length > 0,
    });
  }
}

function resolveHostedDeviceSyncReconnectTarget(connection: PublicDeviceSyncAccount) {
  const targets = listConfiguredDeviceSyncReconnectTargets(
    readConfiguredDeviceSyncConnectTargetConfigs(process.env),
  );

  return resolveHostedDeviceSyncConnectTargetForConnection({
    connection,
    targets,
    upstreamSources: connection.sources ?? [],
  });
}

function resolveHostedDeviceSyncReconnectNoticeProviderLabel(connection: PublicDeviceSyncAccount): string {
  return resolveHostedDeviceSyncBrowserProviderLabel({
    metadata: connection.metadata,
    provider: connection.provider,
    upstreamSources: connection.sources ?? [],
  });
}

function buildHostedDeviceSyncReconnectNoticeEventId(input: {
  connection: PublicDeviceSyncAccount;
  failureCode: string | null;
  observedTokenVersion: number | null;
}): string {
  const tokenVersion = input.observedTokenVersion === null ? "none" : String(input.observedTokenVersion);
  const failedAt = input.connection.lastSyncErrorAt ?? "unknown";
  const failureCode = input.failureCode ?? input.connection.lastErrorCode ?? "unknown";
  return [
    "assistant.notification.requested:device-sync-reconnect",
    input.connection.id,
    tokenVersion,
    failedAt,
    failureCode,
  ].join(":");
}

function buildHostedDeviceSyncReconnectNoticeMessage(input: {
  providerLabel: string;
  url: string;
}): string {
  return `Murph needs you to reconnect ${input.providerLabel} so your wearable data can sync again: ${input.url}`;
}

function buildHostedDeviceSyncReconnectNoticeInstructions(): string {
  return [
    "The next user-facing account-action reply is the text in responsePolicy.",
    "Do not add health details, provider diagnostics, or extra commentary.",
  ].join("\n\n");
}

async function recordHostedDeviceSyncReconnectNoticeLogTx(input: {
  channel?: string | null;
  connection: PublicDeviceSyncAccount;
  eventCode: string;
  failureCode: string | null;
  outcome: string;
  target?: {
    connectSourceId: string;
    connectTarget: string;
    provider: string;
    sourceProviderSlug?: string | null;
  } | null;
  tx: HostedPrismaTransactionClient;
  userId: string;
}): Promise<void> {
  try {
    await recordHostedRuntimeLogTx({
      at: new Date().toISOString(),
      component: "device-sync",
      errorCode: input.failureCode ?? null,
      eventCode: input.eventCode,
      level: input.outcome.startsWith("skipped") ? "warn" : "info",
      phase: "invoke",
      redacted: {
        ...(input.channel ? { channel: input.channel } : {}),
        ...(input.target
          ? {
              connectSourceId: input.target.connectSourceId,
              connectTarget: input.target.connectTarget,
              sourceProviderSlug: input.target.sourceProviderSlug ?? null,
              targetProvider: input.target.provider,
            }
          : {}),
        failureCode: input.failureCode,
        outcome: input.outcome,
        provider: input.connection.provider,
        status: input.connection.status,
      },
      tx: input.tx,
      userId: input.userId,
    });
  } catch (error) {
    const eventCode = input.eventCode;
    console.warn("Hosted device-sync reconnect notice diagnostic log write failed.", {
      ...formatHostedExecutionSafeLogErrorDetails(error, {
        code: "HOSTED_DEVICE_SYNC_RECONNECT_NOTICE_LOG_WRITE_FAILED",
      }),
      eventCode,
    });
  }
}
