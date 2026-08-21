import type {
  MemberActionOutcomeV1,
  MemberActionRequestV1,
} from "@murphai/contracts";
import {
  parseMemberActionOutcomeV1,
  parseMemberActionRequestV1,
} from "@murphai/contracts";
import type {
  HostedExecutionAssistantAskCompletedPayload,
  HostedExecutionAssistantAskCompletedWake,
  HostedExecutionAssistantAskRequestedPayload,
  HostedExecutionAssistantAskRequestedWake,
  HostedExecutionConversationMessagePayload,
  HostedExecutionConversationMessageWake,
  HostedExecutionAssistantNotificationRequestedPayload,
  HostedExecutionAssistantNotificationRequestedWake,
  HostedExecutionAssistantNotificationRoute,
  HostedExecutionDeviceSyncWake,
  HostedExecutionDeviceSyncWakeEvent,
  HostedExecutionDailyMetricReportedWake,
  HostedExecutionEnvironmentVoiceCapturedWake,
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
  HostedExecutionMemberPreferences,
  HostedExecutionMemberPreferencesUpdatedWake,
  HostedExecutionMealPhotoCapturedWake,
  HostedExecutionMemberActionRequestedWake,
  HostedExecutionMemberActionCompletedWake,
  HostedExecutionRuntimeTimerWake,
  HostedExecutionRuntimeControlWake,
  HostedExecutionPlainRuntimeControlWakeKind,
  HostedExecutionPendingEffectsReconcileRequestedWake,
  HostedExecutionCodexAuthRequestedWake,
  HostedCodexAuthAction,
  HostedExecutionTelegramMessage,
  HostedExecutionTelegramExternalThreadRouteAuthority,
  HostedExecutionVaultShareDeliveryWake,
  HostedExecutionVaultShareRevokeWake,
  HostedExecutionTelegramConversationMessagePayload,
  HostedRuntimeTimerTriggerKind,
} from "./contracts.ts";
import {
  HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
  HOSTED_EXECUTION_LINQ_GROUP_REACTION_CONTEXT_MAX_CHARS,
} from "./contracts.ts";
import {
  parseHostedExecutionAssistantAskCompletedPayload,
  parseHostedExecutionAssistantAskRequestedPayload,
  parseHostedExecutionAssistantAskTimestamp,
} from "./assistant-ask-payload.ts";
import {
  parseHostedVaultShareDeliveryPayload,
  parseHostedVaultShareRevokePayload,
  type HostedVaultShareDeliveryPayload,
  type HostedVaultShareRevokePayload,
} from "./vault-share.ts";
import {
  parseHostedExecutionInitialGroupRoomModelMarkdown,
} from "./pending-group-setup.ts";
import {
  parseHostedExecutionDailyMetricReportedPayload,
} from "./daily-metric.ts";

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

function requireHostedExecutionLinqGroupReactionContext(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length === 0
    || normalized.length > HOSTED_EXECUTION_LINQ_GROUP_REACTION_CONTEXT_MAX_CHARS
  ) {
    throw new TypeError("Hosted Linq group reaction context is invalid.");
  }
  return normalized;
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
        ...(value.routeAuthority === undefined
          ? {}
          : {
              routeAuthority: value.routeAuthority === null
                ? null
                : cloneExternalThreadRouteAuthority(value.routeAuthority),
            }),
        telegramMessage: cloneTelegramMessage(value.telegramMessage),
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
  | HostedExecutionAssistantAskCompletedWake
  | HostedExecutionAssistantAskRequestedWake
  | HostedExecutionAssistantNotificationRequestedWake
  | HostedExecutionMemberActivatedWake
  | HostedExecutionMemberChannelsUpdatedWake
  | HostedExecutionMemberPreferencesUpdatedWake
  | HostedExecutionMemberActionRequestedWake
  | HostedExecutionMemberActionCompletedWake
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
  assertHostedExecutionConversationMessageWorkspaceTarget({
    message: input.message,
    userId: input.userId,
  });
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
  groupParticipantAdded?: true;
  groupReactionContext?: string;
  linqMessage: HostedExecutionLinqConversationMessage;
  occurredAt: string;
  phoneLookupKey?: string | null;
  routeAuthority?: HostedExecutionLinqExternalThreadRouteAuthority | null;
  senderMemberId?: string;
  userId: string;
}): HostedExecutionConversationMessageWake & {
  message: HostedExecutionLinqConversationMessagePayload;
} {
  const contactKind = input.contactKind ?? "phone";
  const contactLookupKey = input.contactLookupKey ?? input.phoneLookupKey;
  if (!contactLookupKey) {
    throw new TypeError("Hosted Linq conversation wake requires a contact lookup key.");
  }

  assertHostedExecutionLinqConversationMessageWorkspaceTarget({
    linqMessage: input.linqMessage,
    routeAuthority: input.routeAuthority,
    senderMemberId: input.senderMemberId,
    userId: input.userId,
  });

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
      ...(input.groupParticipantAdded === true
        ? { groupParticipantAdded: true as const }
        : {}),
      ...(input.groupReactionContext === undefined
        ? {}
        : {
            groupReactionContext: requireHostedExecutionLinqGroupReactionContext(
              input.groupReactionContext,
            ),
          }),
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
      ...(input.senderMemberId === undefined
        ? {}
        : { senderMemberId: input.senderMemberId }),
    },
    occurredAt: input.occurredAt,
    userId: input.userId,
  };
}

function assertHostedExecutionConversationMessageWorkspaceTarget(input: {
  message: HostedExecutionConversationMessagePayload;
  userId: string;
}): void {
  if (input.message.channel === "linq") {
    assertHostedExecutionLinqConversationMessageWorkspaceTarget({
      linqMessage: input.message.linqMessage,
      routeAuthority: input.message.routeAuthority,
      senderMemberId: input.message.senderMemberId,
      userId: input.userId,
    });
  } else if (input.message.channel === "telegram") {
    assertHostedExecutionTelegramConversationMessageWorkspaceTarget({
      routeAuthority: input.message.routeAuthority,
      senderMemberId: input.message.senderMemberId,
      telegramMessage: input.message.telegramMessage,
      userId: input.userId,
    });
  }
}

function assertHostedExecutionLinqConversationMessageWorkspaceTarget(input: {
  linqMessage: HostedExecutionLinqConversationMessage;
  routeAuthority?: HostedExecutionLinqExternalThreadRouteAuthority | null;
  senderMemberId?: string;
  userId: string;
}): void {
  assertHostedExecutionGroupSenderMemberId(input.senderMemberId);
  if (input.linqMessage.threadIsDirect !== false) {
    if (input.senderMemberId !== undefined) {
      throw new TypeError(
        "Hosted direct Linq conversation wake must not carry a group sender member.",
      );
    }
    return;
  }

  if (!input.routeAuthority) {
    throw new TypeError(
      "Hosted non-direct Linq conversation wake requires thread route authority.",
    );
  }
  if (input.routeAuthority.channel !== "linq") {
    throw new TypeError(
      "Hosted non-direct Linq conversation wake route authority must be Linq.",
    );
  }
  if (input.routeAuthority.containerMemberId !== input.userId) {
    throw new TypeError(
      "Hosted non-direct Linq conversation wake must target its route container.",
    );
  }
  if (input.routeAuthority.threadId !== input.linqMessage.chatId) {
    throw new TypeError(
      "Hosted non-direct Linq conversation wake route authority must match its chat.",
    );
  }
}

export function buildHostedExecutionTelegramConversationMessageWake(input: {
  eventId: string;
  occurredAt: string;
  routeAuthority?: HostedExecutionTelegramExternalThreadRouteAuthority | null;
  senderMemberId?: string;
  telegramMessage: HostedExecutionTelegramMessage;
  userId: string;
}): HostedExecutionConversationMessageWake & {
  message: HostedExecutionTelegramConversationMessagePayload;
} {
  assertHostedExecutionTelegramConversationMessageWorkspaceTarget({
    routeAuthority: input.routeAuthority,
    senderMemberId: input.senderMemberId,
    telegramMessage: input.telegramMessage,
    userId: input.userId,
  });
  return {
    eventId: input.eventId,
    kind: "conversation.message",
    message: {
      channel: "telegram",
      ...(input.routeAuthority === undefined
        ? {}
        : {
            routeAuthority: input.routeAuthority === null
              ? null
              : cloneExternalThreadRouteAuthority(input.routeAuthority),
          }),
      ...(input.senderMemberId === undefined
        ? {}
        : { senderMemberId: input.senderMemberId }),
      telegramMessage: cloneTelegramMessage(input.telegramMessage),
    },
    occurredAt: input.occurredAt,
    userId: input.userId,
  };
}

function assertHostedExecutionTelegramConversationMessageWorkspaceTarget(input: {
  routeAuthority?: HostedExecutionTelegramExternalThreadRouteAuthority | null;
  senderMemberId?: string;
  telegramMessage: HostedExecutionTelegramMessage;
  userId: string;
}): void {
  assertHostedExecutionGroupSenderMemberId(input.senderMemberId);
  if (input.telegramMessage.threadIsDirect !== false) {
    // Direct threads have a single known sender, so group attribution fields
    // carry no meaning and must never reach the runtime from a 1:1 route.
    if (
      input.senderMemberId !== undefined
      || input.telegramMessage.from
      || input.telegramMessage.senderDisplayName
      || input.telegramMessage.senderUsername
    ) {
      throw new TypeError(
        "Hosted direct Telegram conversation wake must not carry group sender identity.",
      );
    }
    return;
  }
  if (!input.routeAuthority) {
    throw new TypeError(
      "Hosted non-direct Telegram conversation wake requires thread route authority.",
    );
  }
  if (input.routeAuthority.channel !== "telegram") {
    throw new TypeError(
      "Hosted non-direct Telegram conversation wake route authority must be Telegram.",
    );
  }
  if (input.routeAuthority.containerMemberId !== input.userId) {
    throw new TypeError(
      "Hosted non-direct Telegram conversation wake must target its route container.",
    );
  }
  if (input.routeAuthority.threadId !== input.telegramMessage.threadId) {
    throw new TypeError(
      "Hosted non-direct Telegram conversation wake route authority must match its chat.",
    );
  }
}

function assertHostedExecutionGroupSenderMemberId(value: string | undefined): void {
  if (value === undefined) {
    return;
  }
  if (value.trim().length === 0 || value.trim() !== value) {
    throw new TypeError(
      "Hosted group sender member id must be a non-empty normalized string.",
    );
  }
}

export function buildHostedExecutionEmailConversationMessageWake(input: {
  assistantStyleSettingsAuthorized?: boolean;
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
  threadIsDirect?: boolean | null;
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
      ...(input.assistantStyleSettingsAuthorized === undefined
        ? {}
        : { assistantStyleSettingsAuthorized: input.assistantStyleSettingsAuthorized }),
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
      ...(input.threadIsDirect === undefined
        ? {}
        : { threadIsDirect: input.threadIsDirect }),
      ...(input.threadTarget === undefined ? {} : { threadTarget: input.threadTarget }),
      ...(input.to === undefined ? {} : { to: [...input.to] }),
    },
    occurredAt: input.occurredAt,
    userId: input.userId,
  };
}

export function buildHostedExecutionMemberActivatedWake(input: {
  eventId: string;
  initialGroupRoomModelMarkdown?: string | null;
  memberChannels: HostedExecutionMemberChannels;
  memberId: string;
  onboardingFollowupRoute?: HostedExecutionAssistantNotificationRoute | null;
  occurredAt: string;
  signupWelcome?: HostedExecutionMemberActivationSignupWelcome | null;
  timeZone?: string | null;
}): HostedExecutionMemberActivatedWake {
  const initialGroupRoomModelMarkdown =
    input.initialGroupRoomModelMarkdown === undefined
      || input.initialGroupRoomModelMarkdown === null
      ? input.initialGroupRoomModelMarkdown
      : parseHostedExecutionInitialGroupRoomModelMarkdown(
          input.initialGroupRoomModelMarkdown,
        );
  return {
    ...buildHostedExecutionMemberOwnedWakeBase({
      eventId: input.eventId,
      kind: "member.activated",
      memberId: input.memberId,
      occurredAt: input.occurredAt,
    }),
    ...(initialGroupRoomModelMarkdown === undefined
      ? {}
      : { initialGroupRoomModelMarkdown }),
    memberChannels: { ...input.memberChannels },
    ...(input.onboardingFollowupRoute === undefined
      ? {}
      : {
          onboardingFollowupRoute: input.onboardingFollowupRoute
            ? cloneAssistantNotificationRoute(input.onboardingFollowupRoute)
            : null,
        }),
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
    ...(value.externalThreadRouteAuthority === undefined
      ? {}
      : {
          externalThreadRouteAuthority: value.externalThreadRouteAuthority
            ? cloneExternalThreadRouteAuthority(value.externalThreadRouteAuthority)
            : null,
        }),
    ...(value.firstContact === undefined
      ? {}
      : { firstContact: value.firstContact ? { ...value.firstContact } : null }),
    ...(value.groupContextHandoff === undefined
      ? {}
      : { groupContextHandoff: { ...value.groupContextHandoff } }),
    ...(value.privateAssistantAskCompletion === undefined
      ? {}
      : {
          privateAssistantAskCompletion: {
            ...value.privateAssistantAskCompletion,
          },
        }),
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

export function buildHostedExecutionAssistantAskRequestedWake(input: {
  ask: HostedExecutionAssistantAskRequestedPayload;
  eventId: string;
  memberId: string;
  occurredAt: string;
}): HostedExecutionAssistantAskRequestedWake {
  const ask = parseHostedExecutionAssistantAskRequestedPayload(input.ask);
  const occurredAt = parseHostedExecutionAssistantAskTimestamp(
    input.occurredAt,
    "Hosted execution assistant ask requested occurredAt",
  );
  if (
    Date.parse(ask.expiresAt)
    !== Date.parse(occurredAt) + HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS
  ) {
    throw new TypeError(
      "Hosted execution assistant ask requested expiry must equal occurredAt plus the request TTL.",
    );
  }

  return {
    ...buildHostedExecutionMemberOwnedWakeBase({
      eventId: input.eventId,
      kind: "assistant.ask.requested",
      memberId: input.memberId,
      occurredAt,
    }),
    ask,
  };
}

export function buildHostedExecutionAssistantAskCompletedWake(input: {
  ask: HostedExecutionAssistantAskCompletedPayload;
  eventId: string;
  memberId: string;
  occurredAt: string;
}): HostedExecutionAssistantAskCompletedWake {
  const ask = parseHostedExecutionAssistantAskCompletedPayload(input.ask);
  const occurredAt = parseHostedExecutionAssistantAskTimestamp(
    input.occurredAt,
    "Hosted execution assistant ask completed occurredAt",
  );
  if (Date.parse(ask.expiresAt) <= Date.parse(occurredAt)) {
    throw new TypeError(
      "Hosted execution assistant ask completion must occur before request expiry.",
    );
  }

  return {
    ...buildHostedExecutionMemberOwnedWakeBase({
      eventId: input.eventId,
      kind: "assistant.ask.completed",
      memberId: input.memberId,
      occurredAt,
    }),
    ask,
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

export function buildHostedExecutionMemberPreferencesUpdatedWake(input: {
  causalOrigin?: "event" | "turn";
  eventId: string;
  memberId: string;
  occurredAt: string;
  preferenceCausalSeq?: string;
  preferences: HostedExecutionMemberPreferences;
  requestedFields?: Array<"persona" | "tone" | "voice">;
}): HostedExecutionMemberPreferencesUpdatedWake {
  return {
    ...buildHostedExecutionMemberOwnedWakeBase({
      eventId: input.eventId,
      kind: "member.preferences.updated",
      memberId: input.memberId,
      occurredAt: input.occurredAt,
    }),
    ...(input.causalOrigin ? { causalOrigin: input.causalOrigin } : {}),
    ...(input.preferenceCausalSeq
      ? { preferenceCausalSeq: input.preferenceCausalSeq }
      : {}),
    preferences: { ...input.preferences },
    ...(input.requestedFields
      ? { requestedFields: [...input.requestedFields] }
      : {}),
  };
}

export function buildHostedExecutionMemberActionRequestedWake(input: {
  eventId: string;
  memberId: string;
  occurredAt: string;
  request: MemberActionRequestV1;
}): HostedExecutionMemberActionRequestedWake {
  return {
    ...buildHostedExecutionMemberOwnedWakeBase({
      eventId: input.eventId,
      kind: "member.action.requested",
      memberId: input.memberId,
      occurredAt: input.occurredAt,
    }),
    request: parseMemberActionRequestV1(input.request),
  };
}

export function buildHostedExecutionMemberActionCompletedWake(input: {
  eventId: string;
  memberId: string;
  occurredAt: string;
  outcome: MemberActionOutcomeV1;
}): HostedExecutionMemberActionCompletedWake {
  return {
    ...buildHostedExecutionMemberOwnedWakeBase({
      eventId: input.eventId,
      kind: "member.action.completed",
      memberId: input.memberId,
      occurredAt: input.occurredAt,
    }),
    outcome: parseMemberActionOutcomeV1(input.outcome),
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

export function buildHostedExecutionPendingEffectsReconcileRequestedWake(input: {
  effectId: string;
  eventId: string;
  occurredAt: string;
  userId: string;
}): HostedExecutionPendingEffectsReconcileRequestedWake {
  return {
    effectId: input.effectId,
    eventId: input.eventId,
    kind: "runtime.pending-effects-reconcile-requested",
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
  expectedConnectedAt?: string;
  hint?: HostedExecutionDeviceSyncWakeEvent["hint"] | null;
  occurredAt: string;
  provider?: string | null;
  reason: HostedExecutionDeviceSyncWakeEvent["reason"];
  userId: string;
}): HostedExecutionDeviceSyncWake {
  return {
    ...(input.connectionId === undefined ? {} : { connectionId: input.connectionId }),
    eventId: input.eventId,
    ...(input.expectedConnectedAt === undefined
      ? {}
      : { expectedConnectedAt: input.expectedConnectedAt }),
    ...(input.hint === undefined ? {} : { hint: input.hint }),
    kind: "device-sync.wake",
    occurredAt: input.occurredAt,
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    reason: input.reason,
    userId: input.userId,
  };
}

export function buildHostedExecutionMealPhotoCapturedWake(input: {
  byteLength: number;
  captureId: string;
  capturedAt: string;
  directRoute: HostedExecutionMealPhotoCapturedWake["directRoute"];
  eventId: string;
  mealPhotoKey: string;
  memberId: string;
  occurredAt: string;
  sha256: string;
}): HostedExecutionMealPhotoCapturedWake {
  if (input.occurredAt !== input.capturedAt) {
    throw new TypeError(
      "Hosted meal photo wake occurredAt must match capturedAt.",
    );
  }

  return {
    directRoute: input.directRoute,
    eventId: input.eventId,
    kind: "meal-photo.captured",
    mealPhoto: {
      byteLength: input.byteLength,
      captureId: input.captureId,
      capturedAt: input.capturedAt,
      mealPhotoKey: input.mealPhotoKey,
      sha256: input.sha256,
    },
    occurredAt: input.occurredAt,
    userId: input.memberId,
  };
}

export function buildHostedExecutionDailyMetricReportedWake(input: {
  date: string;
  eventId: string;
  memberId: string;
  metric: string;
  occurredAt: string;
  unit: string;
  value: number;
}): HostedExecutionDailyMetricReportedWake {
  const dailyMetric = parseHostedExecutionDailyMetricReportedPayload({
    date: input.date,
    metric: input.metric,
    unit: input.unit,
    value: input.value,
  });

  return {
    dailyMetric,
    eventId: input.eventId,
    kind: "health.daily-metric.reported",
    occurredAt: input.occurredAt,
    userId: input.memberId,
  };
}

export function buildHostedExecutionEnvironmentVoiceCapturedWake(input: {
  audioKey: string;
  byteLength: number;
  captureId: string;
  capturedAt: string;
  contentType: HostedExecutionEnvironmentVoiceCapturedWake["environmentVoice"]["contentType"];
  durationMs: number;
  eventId: string;
  memberId: string;
  occurredAt: string;
  sha256: string;
}): HostedExecutionEnvironmentVoiceCapturedWake {
  if (input.occurredAt !== input.capturedAt) {
    throw new TypeError(
      "Hosted environment voice wake occurredAt must match capturedAt.",
    );
  }

  return {
    eventId: input.eventId,
    environmentVoice: {
      audioKey: input.audioKey,
      byteLength: input.byteLength,
      captureId: input.captureId,
      capturedAt: input.capturedAt,
      contentType: input.contentType,
      durationMs: input.durationMs,
      sha256: input.sha256,
    },
    kind: "environment-voice.captured",
    occurredAt: input.occurredAt,
    userId: input.memberId,
  };
}
