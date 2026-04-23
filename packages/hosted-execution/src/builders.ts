import type {
  HostedExecutionConversationMessagePayload,
  HostedExecutionConversationMessageWake,
  HostedExecutionAssistantNotificationRequestedPayload,
  HostedExecutionAssistantNotificationRequestedWake,
  HostedExecutionDeviceSyncWake,
  HostedExecutionDeviceSyncWakeEvent,
  HostedExecutionEmailConversationMessagePayload,
  HostedExecutionLinqConversationMessagePayload,
  HostedExecutionLinqConversationMessage,
  HostedExecutionLinqConversationMessagePart,
  HostedExecutionMemberActivatedWake,
  HostedExecutionMemberChannels,
  HostedExecutionMemberChannelsUpdatedWake,
  HostedExecutionRuntimeTimerWake,
  HostedExecutionTelegramMessage,
  HostedExecutionTelegramConversationMessagePayload,
  HostedRunTriggerKind,
  HostedExecutionVaultShareAcceptedEvent,
  HostedExecutionVaultShareAcceptedWake,
  HostedExecutionVaultSyncImportEvent,
  HostedExecutionVaultSyncImportWake,
} from "./contracts.ts";

function cloneLinqMessagePart(
  value: HostedExecutionLinqConversationMessagePart,
): HostedExecutionLinqConversationMessagePart {
  return {
    ...value,
  };
}

function cloneLinqMessage(
  value: HostedExecutionLinqConversationMessage,
): HostedExecutionLinqConversationMessage {
  return {
    ...value,
    parts: value.parts.map((part) => cloneLinqMessagePart(part)),
  };
}

function cloneTelegramMessage(value: HostedExecutionTelegramMessage): HostedExecutionTelegramMessage {
  return {
    ...value,
    ...(value.attachments
      ? {
          attachments: value.attachments.map((attachment) => ({ ...attachment })),
        }
      : {}),
  };
}

function cloneConversationMessagePayload(
  value: HostedExecutionConversationMessagePayload,
): HostedExecutionConversationMessagePayload {
  switch (value.channel) {
    case "linq":
      return {
        ...value,
        linqMessage: cloneLinqMessage(value.linqMessage),
      };
    case "telegram":
      return {
        ...value,
        telegramMessage: cloneTelegramMessage(value.telegramMessage),
      };
    case "email":
      return {
        ...value,
      };
  }
}

export function buildHostedExecutionConversationMessageWake(input: {
  eventId: string;
  message: HostedExecutionConversationMessagePayload;
  occurredAt: string;
  userId: string;
}): HostedExecutionConversationMessageWake {
  return {
    eventId: input.eventId,
    kind: "conversation.message",
    message: cloneConversationMessagePayload(input.message),
    occurredAt: input.occurredAt,
    userId: input.userId,
  };
}

export function buildHostedExecutionLinqConversationMessageWake(input: {
  eventId: string;
  linqMessage: HostedExecutionLinqConversationMessage;
  occurredAt: string;
  phoneLookupKey: string;
  userId: string;
}): HostedExecutionConversationMessageWake & {
  message: HostedExecutionLinqConversationMessagePayload;
} {
  return {
    eventId: input.eventId,
    kind: "conversation.message",
    message: {
      channel: "linq",
      linqMessage: cloneLinqMessage(input.linqMessage),
      phoneLookupKey: input.phoneLookupKey,
    },
    occurredAt: input.occurredAt,
    userId: input.userId,
  };
}

export function buildHostedExecutionTelegramConversationMessageWake(input: {
  eventId: string;
  occurredAt: string;
  telegramMessage: HostedExecutionTelegramMessage;
  userId: string;
}): HostedExecutionConversationMessageWake & {
  message: HostedExecutionTelegramConversationMessagePayload;
} {
  return {
    eventId: input.eventId,
    kind: "conversation.message",
    message: {
      channel: "telegram",
      telegramMessage: cloneTelegramMessage(input.telegramMessage),
    },
    occurredAt: input.occurredAt,
    userId: input.userId,
  };
}

export function buildHostedExecutionEmailConversationMessageWake(input: {
  eventId: string;
  identityId: string | null;
  occurredAt: string;
  rawMessageKey: string;
  selfAddress?: string | null;
  userId: string;
}): HostedExecutionConversationMessageWake & {
  message: HostedExecutionEmailConversationMessagePayload;
} {
  return {
    eventId: input.eventId,
    kind: "conversation.message",
    message: {
      channel: "email",
      identityId: input.identityId,
      rawMessageKey: input.rawMessageKey,
      ...(input.selfAddress === undefined ? {} : { selfAddress: input.selfAddress }),
    },
    occurredAt: input.occurredAt,
    userId: input.userId,
  };
}

export function buildHostedExecutionMemberActivatedWake(input: {
  eventId: string;
  memberChannels: HostedExecutionMemberChannels;
  memberId: string;
  occurredAt: string;
}): HostedExecutionMemberActivatedWake {
  return {
    eventId: input.eventId,
    kind: "member.activated",
    memberChannels: { ...input.memberChannels },
    occurredAt: input.occurredAt,
    userId: input.memberId,
  };
}

function cloneAssistantNotificationPayload(
  value: HostedExecutionAssistantNotificationRequestedPayload,
): HostedExecutionAssistantNotificationRequestedPayload {
  return {
    ...value,
    ...(value.firstContact === undefined
      ? {}
      : { firstContact: value.firstContact ? { ...value.firstContact } : null }),
    ...(value.responsePolicy === undefined
      ? {}
      : { responsePolicy: value.responsePolicy ? { ...value.responsePolicy } : null }),
    route: {
      ...value.route,
      delivery: {
        ...value.route.delivery,
        ...(value.route.delivery.source === undefined
          ? {}
          : {
              source: value.route.delivery.source
                ? { ...value.route.delivery.source }
                : null,
            }),
      },
    },
  };
}

export function buildHostedExecutionAssistantNotificationRequestedWake(input: {
  eventId: string;
  memberId: string;
  notification: HostedExecutionAssistantNotificationRequestedPayload;
  occurredAt: string;
}): HostedExecutionAssistantNotificationRequestedWake {
  return {
    eventId: input.eventId,
    kind: "assistant.notification.requested",
    notification: cloneAssistantNotificationPayload(input.notification),
    occurredAt: input.occurredAt,
    userId: input.memberId,
  };
}

export function buildHostedExecutionMemberChannelsUpdatedWake(input: {
  eventId: string;
  memberChannels: HostedExecutionMemberChannels;
  memberId: string;
  occurredAt: string;
}): HostedExecutionMemberChannelsUpdatedWake {
  return {
    eventId: input.eventId,
    kind: "member.channels.updated",
    memberChannels: { ...input.memberChannels },
    occurredAt: input.occurredAt,
    userId: input.memberId,
  };
}

export function buildHostedExecutionRuntimeTimerWake(input: {
  eventId: string;
  occurredAt: string;
  triggerKind: HostedRunTriggerKind;
  userId: string;
}): HostedExecutionRuntimeTimerWake {
  return {
    eventId: input.eventId,
    kind: "runtime.timer",
    occurredAt: input.occurredAt,
    triggerKind: input.triggerKind,
    userId: input.userId,
  };
}

export function createRuntimeTimerSyntheticWake(input: {
  acquiredAt: string;
  runId: string;
  triggerKind: HostedRunTriggerKind;
  userId: string;
}): HostedExecutionRuntimeTimerWake {
  // Runtime timers are internal continuation context, not persisted ingress rows.
  return buildHostedExecutionRuntimeTimerWake({
    eventId: `hosted-run:${input.runId}`,
    occurredAt: input.acquiredAt,
    triggerKind: input.triggerKind,
    userId: input.userId,
  });
}

export function buildHostedExecutionDeviceSyncWake(input: {
  connectionId?: string | null;
  eventId: string;
  hint?: HostedExecutionDeviceSyncWakeEvent["hint"] | null;
  occurredAt: string;
  provider?: string | null;
  reason: HostedExecutionDeviceSyncWakeEvent["reason"];
  userId: string;
}): HostedExecutionDeviceSyncWake {
  return {
    ...(input.connectionId === undefined ? {} : { connectionId: input.connectionId }),
    eventId: input.eventId,
    ...(input.hint === undefined ? {} : { hint: input.hint }),
    kind: "device-sync.wake",
    occurredAt: input.occurredAt,
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    reason: input.reason,
    userId: input.userId,
  };
}

export function buildHostedExecutionVaultShareAcceptedWake(input: {
  eventId: string;
  memberId: string;
  occurredAt: string;
  share: HostedExecutionVaultShareAcceptedEvent["share"];
}): HostedExecutionVaultShareAcceptedWake {
  return {
    eventId: input.eventId,
    kind: "vault.share.accepted",
    occurredAt: input.occurredAt,
    share: input.share,
    userId: input.memberId,
  };
}

export function buildHostedExecutionVaultSyncImportWake(input: {
  eventId: string;
  memberId: string;
  occurredAt: string;
  vaultSync: HostedExecutionVaultSyncImportEvent["vaultSync"];
}): HostedExecutionVaultSyncImportWake {
  return {
    eventId: input.eventId,
    kind: "vault.sync.import",
    occurredAt: input.occurredAt,
    userId: input.memberId,
    vaultSync: {
      localManifestHash: input.vaultSync.localManifestHash,
      sessionId: input.vaultSync.sessionId,
      ...(input.vaultSync.sourceSchemaVersion === undefined
        ? {}
        : { sourceSchemaVersion: input.vaultSync.sourceSchemaVersion }),
      ...(input.vaultSync.sourceVaultId === undefined
        ? {}
        : { sourceVaultId: input.vaultSync.sourceVaultId }),
      ...(input.vaultSync.sourceVaultTitle === undefined
        ? {}
        : { sourceVaultTitle: input.vaultSync.sourceVaultTitle }),
    },
  };
}
