import type {
  HostedExecutionConversationMessagePayload,
  HostedExecutionConversationMessageWake,
  HostedExecutionAssistantNotificationRequestedPayload,
  HostedExecutionAssistantNotificationRequestedWake,
  HostedExecutionDeviceSyncWake,
  HostedExecutionDeviceSyncWakeEvent,
  HostedExecutionGroupNewsletterEmailNeededWake,
  HostedExecutionEmailConversationMessagePayload,
  HostedExecutionLinqConversationMessagePayload,
  HostedExecutionLinqConversationMessage,
  HostedExecutionLinqConversationMessagePart,
  HostedExecutionLinqConversationContactKind,
  HostedExecutionExternalThreadRouteAuthority,
  HostedExecutionLinqExternalThreadRouteAuthority,
  HostedExecutionMemberActivationSignupWelcome,
  HostedExecutionMemberActivatedWake,
  HostedExecutionMemberChannels,
  HostedExecutionMemberChannelsUpdatedWake,
  HostedExecutionRuntimeTimerWake,
  HostedExecutionRuntimeControlWake,
  HostedExecutionPlainRuntimeControlWakeKind,
  HostedExecutionCodexAuthRequestedWake,
  HostedCodexAuthAction,
  HostedExecutionTelegramMessage,
  HostedExecutionVaultShareDeliveryWake,
  HostedExecutionVaultShareRevokeWake,
  HostedExecutionTelegramConversationMessagePayload,
  HostedExecutionWhatsAppMessage,
  HostedExecutionWhatsAppConversationMessagePayload,
  HostedRuntimeTimerTriggerKind,
} from "./contracts.ts";
import {
  parseHostedVaultShareDeliveryPayload,
  parseHostedVaultShareRevokePayload,
  type HostedVaultShareDeliveryPayload,
  type HostedVaultShareRevokePayload,
} from "./vault-share.ts";

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

function cloneExternalThreadRouteAuthority<TAuthority extends HostedExecutionExternalThreadRouteAuthority>(
  value: TAuthority,
): TAuthority {
  return {
    ...value,
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

function cloneWhatsAppMessage(value: HostedExecutionWhatsAppMessage): HostedExecutionWhatsAppMessage {
  return {
    ...value,
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
        ...(value.routeAuthority === undefined
          ? {}
          : {
              routeAuthority: value.routeAuthority === null
                ? null
                : cloneExternalThreadRouteAuthority(value.routeAuthority),
            }),
      };
    case "telegram":
      return {
        ...value,
        telegramMessage: cloneTelegramMessage(value.telegramMessage),
      };
    case "whatsapp":
      return {
        ...value,
        whatsappMessage: cloneWhatsAppMessage(value.whatsappMessage),
      };
    case "email":
      return {
        ...value,
        ...(value.attachmentSummaries
          ? {
              attachmentSummaries: value.attachmentSummaries.map((attachment) => ({
                ...attachment,
              })),
            }
          : {}),
        ...(value.cc ? { cc: [...value.cc] } : {}),
        ...(value.to ? { to: [...value.to] } : {}),
      };
  }
}

type HostedExecutionMemberOwnedWake =
  | HostedExecutionAssistantNotificationRequestedWake
  | HostedExecutionMemberActivatedWake
  | HostedExecutionMemberChannelsUpdatedWake
  | HostedExecutionGroupNewsletterEmailNeededWake
  | HostedExecutionVaultShareDeliveryWake
  | HostedExecutionVaultShareRevokeWake;

function buildHostedExecutionMemberOwnedWakeBase<
  TKind extends HostedExecutionMemberOwnedWake["kind"],
>(input: {
  eventId: string;
  kind: TKind;
  memberId: string;
  occurredAt: string;
}): {
  eventId: string;
  kind: TKind;
  occurredAt: string;
  userId: string;
} {
  return {
    eventId: input.eventId,
    kind: input.kind,
    occurredAt: input.occurredAt,
    userId: input.memberId,
  };
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
  accountLookupKey?: string | null;
  contactKind?: HostedExecutionLinqConversationContactKind;
  contactLookupKey?: string;
  eventId: string;
  linqMessage: HostedExecutionLinqConversationMessage;
  occurredAt: string;
  phoneLookupKey?: string | null;
  routeAuthority?: HostedExecutionLinqExternalThreadRouteAuthority | null;
  userId: string;
}): HostedExecutionConversationMessageWake & {
  message: HostedExecutionLinqConversationMessagePayload;
} {
  const contactKind = input.contactKind ?? "phone";
  const contactLookupKey = input.contactLookupKey ?? input.phoneLookupKey;
  if (!contactLookupKey) {
    throw new TypeError("Hosted Linq conversation wake requires a contact lookup key.");
  }

  return {
    eventId: input.eventId,
    kind: "conversation.message",
    message: {
      ...(input.accountLookupKey === undefined
        ? {}
        : { accountLookupKey: input.accountLookupKey }),
      channel: "linq",
      contactKind,
      contactLookupKey,
      linqMessage: cloneLinqMessage(input.linqMessage),
      ...(input.phoneLookupKey === undefined
        ? {}
        : { phoneLookupKey: input.phoneLookupKey }),
      ...(input.routeAuthority === undefined
        ? {}
        : {
            routeAuthority: input.routeAuthority === null
              ? null
              : cloneExternalThreadRouteAuthority(input.routeAuthority),
          }),
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

export function buildHostedExecutionWhatsAppConversationMessageWake(input: {
  eventId: string;
  occurredAt: string;
  userId: string;
  whatsappMessage: HostedExecutionWhatsAppMessage;
}): HostedExecutionConversationMessageWake & {
  message: HostedExecutionWhatsAppConversationMessagePayload;
} {
  return {
    eventId: input.eventId,
    kind: "conversation.message",
    message: {
      channel: "whatsapp",
      whatsappMessage: cloneWhatsAppMessage(input.whatsappMessage),
    },
    occurredAt: input.occurredAt,
    userId: input.userId,
  };
}

export function buildHostedExecutionEmailConversationMessageWake(input: {
  attachmentSummaries?: HostedExecutionEmailConversationMessagePayload["attachmentSummaries"];
  cc?: string[];
  eventId: string;
  from?: string | null;
  identityId: string | null;
  messageId?: string | null;
  occurredAt: string;
  rawMessageKey: string;
  selfAddress?: string | null;
  subject?: string | null;
  textPreview?: string | null;
  threadKey?: string | null;
  threadTarget?: string | null;
  to?: string[];
  userId: string;
}): HostedExecutionConversationMessageWake & {
  message: HostedExecutionEmailConversationMessagePayload;
} {
  return {
    eventId: input.eventId,
    kind: "conversation.message",
    message: {
      ...(input.attachmentSummaries === undefined
        ? {}
        : {
            attachmentSummaries: input.attachmentSummaries.map((attachment) => ({
              ...attachment,
            })),
          }),
      channel: "email",
      ...(input.cc === undefined ? {} : { cc: [...input.cc] }),
      ...(input.from === undefined ? {} : { from: input.from }),
      identityId: input.identityId,
      ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
      rawMessageKey: input.rawMessageKey,
      ...(input.selfAddress === undefined ? {} : { selfAddress: input.selfAddress }),
      ...(input.subject === undefined ? {} : { subject: input.subject }),
      ...(input.textPreview === undefined ? {} : { textPreview: input.textPreview }),
      ...(input.threadKey === undefined ? {} : { threadKey: input.threadKey }),
      ...(input.threadTarget === undefined ? {} : { threadTarget: input.threadTarget }),
      ...(input.to === undefined ? {} : { to: [...input.to] }),
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
  signupWelcome?: HostedExecutionMemberActivationSignupWelcome | null;
  timeZone?: string | null;
}): HostedExecutionMemberActivatedWake {
  return {
    ...buildHostedExecutionMemberOwnedWakeBase({
      eventId: input.eventId,
      kind: "member.activated",
      memberId: input.memberId,
      occurredAt: input.occurredAt,
    }),
    memberChannels: { ...input.memberChannels },
    ...(input.signupWelcome === undefined
      ? {}
      : {
          signupWelcome: input.signupWelcome
            ? cloneMemberActivationSignupWelcome(input.signupWelcome)
            : null,
        }),
    ...(input.timeZone ? { timeZone: input.timeZone } : {}),
  };
}

function cloneMemberActivationSignupWelcome(
  value: HostedExecutionMemberActivationSignupWelcome,
): HostedExecutionMemberActivationSignupWelcome {
  return {
    route: cloneAssistantNotificationRoute(value.route),
    text: value.text,
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
    route: cloneAssistantNotificationRoute(value.route),
  };
}

function cloneAssistantNotificationRoute(
  value: HostedExecutionAssistantNotificationRequestedPayload["route"],
): HostedExecutionAssistantNotificationRequestedPayload["route"] {
  return {
    ...value,
    delivery: {
      ...value.delivery,
      ...(value.delivery.source === undefined
        ? {}
        : {
            source: value.delivery.source
              ? { ...value.delivery.source }
              : null,
          }),
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
    ...buildHostedExecutionMemberOwnedWakeBase({
      eventId: input.eventId,
      kind: "assistant.notification.requested",
      memberId: input.memberId,
      occurredAt: input.occurredAt,
    }),
    notification: cloneAssistantNotificationPayload(input.notification),
  };
}

export function buildHostedExecutionVaultShareDeliveryWake(input: {
  delivery: HostedVaultShareDeliveryPayload;
  eventId: string;
  memberId: string;
}): HostedExecutionVaultShareDeliveryWake {
  const delivery = parseHostedVaultShareDeliveryPayload(input.delivery);

  return {
    ...buildHostedExecutionMemberOwnedWakeBase({
      eventId: input.eventId,
      kind: "vault-share.delivery",
      memberId: input.memberId,
      // The envelope occurredAt becomes the plaintext occurred_at mailbox column. Deriving
      // it from the parsed record (parser-pinned to the night date for sleep-times) makes
      // the pin authoritative for every caller instead of trusting a separate input.
      occurredAt: delivery.record.occurredAt,
    }),
    delivery,
  };
}

export function buildHostedExecutionVaultShareRevokeWake(input: {
  eventId: string;
  memberId: string;
  revoke: HostedVaultShareRevokePayload;
}): HostedExecutionVaultShareRevokeWake {
  const revoke = parseHostedVaultShareRevokePayload(input.revoke);

  return {
    ...buildHostedExecutionMemberOwnedWakeBase({
      eventId: input.eventId,
      kind: "vault-share.revoke",
      memberId: input.memberId,
      occurredAt: revoke.revokedAt,
    }),
    revoke,
  };
}

export function buildHostedExecutionMemberChannelsUpdatedWake(input: {
  eventId: string;
  memberChannels: HostedExecutionMemberChannels;
  memberId: string;
  occurredAt: string;
}): HostedExecutionMemberChannelsUpdatedWake {
  return {
    ...buildHostedExecutionMemberOwnedWakeBase({
      eventId: input.eventId,
      kind: "member.channels.updated",
      memberId: input.memberId,
      occurredAt: input.occurredAt,
    }),
    memberChannels: { ...input.memberChannels },
  };
}

export function buildHostedExecutionRuntimeTimerWake(input: {
  eventId: string;
  occurredAt: string;
  triggerKind: HostedRuntimeTimerTriggerKind;
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

export function buildHostedExecutionRuntimeControlWake(input: {
  eventId: string;
  kind: HostedExecutionPlainRuntimeControlWakeKind;
  occurredAt: string;
  userId: string;
}): HostedExecutionRuntimeControlWake {
  return {
    eventId: input.eventId,
    kind: input.kind,
    occurredAt: input.occurredAt,
    userId: input.userId,
  };
}

export function buildHostedExecutionCodexAuthRequestedWake(input: {
  action: HostedCodexAuthAction;
  attemptId: string;
  eventId: string;
  occurredAt: string;
  userId: string;
}): HostedExecutionCodexAuthRequestedWake {
  return {
    action: input.action,
    attemptId: input.attemptId,
    eventId: input.eventId,
    kind: "runtime.codex-auth-requested",
    occurredAt: input.occurredAt,
    userId: input.userId,
  };
}

export function createRuntimeTimerSyntheticWake(input: {
  acquiredAt: string;
  timerId: string;
  triggerKind: HostedRuntimeTimerTriggerKind;
  userId: string;
}): HostedExecutionRuntimeTimerWake {
  // Runtime timers are internal continuation context, not persisted mailbox rows.
  return buildHostedExecutionRuntimeTimerWake({
    eventId: `hosted-runtime-timer:${input.timerId}`,
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

export function buildHostedExecutionGroupNewsletterEmailNeededWake(input: {
  directRoute?: HostedExecutionGroupNewsletterEmailNeededWake["directRoute"];
  eventId: string;
  groupDisplayName: string | null;
  groupId: string;
  memberId: string;
  occurredAt: string;
}): HostedExecutionGroupNewsletterEmailNeededWake {
  return {
    ...buildHostedExecutionMemberOwnedWakeBase({
      eventId: input.eventId,
      kind: "group-newsletter.email-needed",
      memberId: input.memberId,
      occurredAt: input.occurredAt,
    }),
    ...(input.directRoute === undefined ? {} : { directRoute: input.directRoute }),
    groupDisplayName: input.groupDisplayName,
    groupId: input.groupId,
  };
}
