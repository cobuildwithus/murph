import {
  parseHostedVaultShareDeliveryPayload,
} from "./vault-share.ts";
import {
  buildHostedExecutionVaultShareDeliveryWake,
} from "./builders.ts";
import {
  normalizeIanaTimeZone,
} from "@murphai/contracts";

import {
  isHostedConversationMessageChannel,
  isHostedExecutionWakeKind,
  isHostedLinqConversationContactKind,
} from "./contracts.ts";

import type {
  HostedExecutionAssistantNotificationDelivery,
  HostedExecutionAssistantNotificationDeliveryDispatchMode,
  HostedExecutionAssistantNotificationDeliverySource,
  HostedExecutionAssistantNotificationFirstContactPolicy,
  HostedExecutionAssistantNotificationRequestedPayload,
  HostedExecutionAssistantNotificationResponsePolicy,
  HostedExecutionMemberActivationSignupWelcome,
  HostedExecutionMemberChannels,
  HostedExecutionMemberChannelsUpdatedEvent,
  HostedExecutionDeviceSyncWakeEvent,
  HostedExecutionWake,
  HostedExecutionWakeKind,
  HostedExecutionEvent,
  HostedExecutionConversationMessageWake,
  HostedExecutionEmailAttachmentSummary,
  HostedExecutionExternalThreadRouteAuthority,
  HostedExecutionLinqExternalThreadRouteAuthority,
  HostedExecutionLinqConversationMessagePayload,
  HostedExecutionWhatsAppConversationMessagePayload,
  HostedExecutionRedactedLogEntry,
  HostedExecutionPlainRuntimeControlWakeKind,
  HostedCodexAuthAction,
} from "./contracts.ts";
import type {
  HostedExecutionLogLevel,
} from "./observability.ts";
import {
  isHostedExecutionLogLevel,
} from "./observability.ts";
import {
  buildHostedExecutionAssistantNotificationRequestedWake,
  buildHostedExecutionEmailConversationMessageWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionMemberChannelsUpdatedWake,
  buildHostedExecutionConversationMessageWake,
  buildHostedExecutionCodexAuthRequestedWake,
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionRuntimeControlWake,
  buildHostedExecutionTelegramConversationMessageWake,
} from "./builders.ts";
import {
  rejectLegacyAliases,
  requireArray,
  requireBoolean,
  requireNumber,
  requireObject,
  requireString,
  readNullableNumber,
  readNullableString,
  readNullableStringValue,
  readOptionalNullableString,
  readOptionalStringArray,
} from "./parsers/assertions.ts";
import {
  buildHostedExecutionLayeredSnapshotRef,
  buildHostedExecutionWorkingSnapshotRef,
  isHostedExecutionLayeredSnapshotRef,
  isHostedExecutionWorkingSnapshotRef,
  isHostedWorkspaceSnapshotV2Ref,
  parseHostedExecutionBundlePayload,
  parseHostedExecutionBundleRef,
  parseHostedBrowserVaultReplicaRef,
  parseHostedExecutionSnapshotRef,
  readHostedBrowserVaultSourceStateHash,
  readHostedExecutionSnapshotBaseRef,
  readHostedExecutionSnapshotDeltaRef,
  readHostedExecutionSnapshotHotRef,
} from "./parsers/cursor.ts";
import {
  parseHostedExecutionDeviceSyncReason,
  parseHostedExecutionDeviceSyncWakeHint,
} from "./parsers/device-sync.ts";
import { parseHostedExecutionTelegramMessage } from "./parsers/telegram.ts";

export {
  buildHostedExecutionLayeredSnapshotRef,
  buildHostedExecutionWorkingSnapshotRef,
  isHostedExecutionLayeredSnapshotRef,
  isHostedExecutionWorkingSnapshotRef,
  isHostedWorkspaceSnapshotV2Ref,
  parseHostedExecutionBundlePayload,
  parseHostedExecutionBundleRef,
  parseHostedBrowserVaultReplicaRef,
  parseHostedExecutionSnapshotRef,
  readHostedBrowserVaultSourceStateHash,
  readHostedExecutionSnapshotBaseRef,
  readHostedExecutionSnapshotDeltaRef,
  readHostedExecutionSnapshotHotRef,
} from "./parsers/cursor.ts";
export {
  parseHostedWorkspaceSnapshotV2Ref,
} from "./parsers/workspace-snapshot-v2.ts";
export {
  parseHostedMailboxConsumeRequest,
  parseHostedMailboxConsumeResponse,
  parseHostedMailboxFetchRequest,
  parseHostedMailboxFetchResponse,
  parseHostedMailboxItem,
  parseHostedMailboxKind,
  parseHostedMailboxLane,
  parseHostedMailboxLaneCounterState,
  parseHostedMailboxPayload,
  parseHostedMailboxPayloadFetchRequest,
  parseHostedMailboxPayloadFetchResponse,
  parseHostedBrowserVaultReplicaPublishRequest,
  parseHostedBrowserVaultReplicaPublishResponse,
  parseHostedRunnerNudgeResult,
  parseHostedRunnerStatusResponse,
  parseHostedRuntimeDeviceSyncBridgeEnvelope,
  parseHostedIngressLatencySource,
  parseHostedRuntimeIssueExportRequest,
  parseHostedRuntimeIssueExportResponse,
  parseHostedCodexAuthUpdate,
  parseHostedCodexAuthUpdateResponse,
  parseHostedRuntimeLatencyTraceEvent,
  parseHostedRuntimeLatencyTraceRequest,
  parseHostedRuntimeLatencyTraceResponse,
  parseHostedRuntimeLogEntry,
  parseHostedRuntimeLogRequest,
  parseHostedRuntimeLogResponse,
  parseHostedRuntimeLinqContactCardShareAfterOutboundRequest,
  parseHostedRuntimeUsageRecordRequest,
  parseHostedRuntimeUsageRecordResponse,
  parseHostedRuntimeFamilyPlanToolRequest,
  parseHostedRuntimeFamilyPlanToolResponse,
  parseHostedRuntimeProductFeedbackRecordRequest,
  parseHostedRuntimeProductFeedbackRecordResponse,
  parseHostedRuntimeWebStatusResponse,
  parseHostedWorkspaceCheckpointRequest,
  parseHostedWorkspaceCheckpointResponse,
  parseHostedWorkspaceReadResponse,
  parseHostedWorkspaceInvocationRequest,
  parseHostedWorkspaceInvocationResult,
  parseHostedWorkspaceState,
} from "./parsers/runtime-control.ts";
export {
  parseHostedRuntimeEnsureProcessingRequest,
  parseHostedRuntimeEnsureProcessingResponse,
  parseHostedRuntimeReconciliationFacts,
  parseHostedRuntimeReconciliationFactsBlocked,
  parseHostedRuntimeReconciliationFactsRequest,
  parseHostedRuntimeReconciliationFactsWorkspace,
  parseHostedRuntimeSignal,
} from "./parsers/orchestration-control.ts";

export function parseHostedExecutionWake(value: unknown): HostedExecutionWake {
  const record = requireObject(value, "Hosted execution wake");
  const kind = parseHostedExecutionWakeKind(record.kind, "Hosted execution wake kind");
  const eventId = requireString(record.eventId, "Hosted execution wake eventId");
  const occurredAt = requireString(record.occurredAt, "Hosted execution wake occurredAt");
  const wireUserId = requireString(record.userId, "Hosted execution wake userId");

  switch (kind) {
    case "conversation.message":
      return buildHostedExecutionConversationMessageWake({
        eventId,
        message: parseHostedExecutionConversationMessagePayload(record.message),
        occurredAt,
        userId: wireUserId,
      });
    case "member.activated":
      return buildHostedExecutionMemberActivatedWake({
        eventId,
        memberChannels: parseHostedExecutionMemberChannels(
          record.memberChannels,
          "Hosted execution wake member.activated memberChannels",
        ),
        memberId: wireUserId,
        occurredAt,
        ...(record.signupWelcome === undefined
          ? {}
          : {
              signupWelcome: record.signupWelcome === null
                ? null
                : parseHostedExecutionMemberActivationSignupWelcome(
                    record.signupWelcome,
                    "Hosted execution wake member.activated signupWelcome",
                  ),
            }),
        timeZone: parseHostedExecutionOptionalTimeZone(
          record.timeZone,
          "Hosted execution wake member.activated timeZone",
        ),
      });
    case "vault-share.delivery":
      // The builder derives the envelope occurredAt from the delivery record, so a wire
      // envelope timestamp that drifted from the record normalizes back to the record.
      return buildHostedExecutionVaultShareDeliveryWake({
        delivery: parseHostedVaultShareDeliveryPayload(record.delivery),
        eventId,
        memberId: wireUserId,
      });
    case "member.channels.updated":
      return buildHostedExecutionMemberChannelsUpdatedWake({
        eventId,
        memberChannels: parseHostedExecutionMemberChannels(
          record.memberChannels,
          "Hosted execution wake member.channels.updated memberChannels",
        ),
        memberId: wireUserId,
        occurredAt,
      });
    case "assistant.notification.requested":
      return buildHostedExecutionAssistantNotificationRequestedWake({
        eventId,
        memberId: wireUserId,
        notification: parseHostedExecutionAssistantNotificationRequestedPayload(
          record.notification,
          "Hosted execution wake assistant.notification.requested notification",
        ),
        occurredAt,
      });
    case "device-sync.wake":
      return buildHostedExecutionDeviceSyncWake({
        ...(record.connectionId === undefined
          ? {}
          : {
              connectionId: readNullableString(
                record.connectionId,
                "Hosted execution wake device-sync.wake connectionId",
              ),
            }),
        eventId,
        ...(record.hint === undefined
          ? {}
          : { hint: parseHostedExecutionDeviceSyncWakeHint(record.hint) }),
        occurredAt,
        ...(record.provider === undefined
          ? {}
          : {
              provider: readNullableString(
                record.provider,
                "Hosted execution wake device-sync.wake provider",
              ),
            }),
        reason: parseHostedExecutionDeviceSyncReason(record.reason),
        userId: wireUserId,
      });
    case "runtime.manual-requested":
    case "runtime.maintenance-requested":
    case "runtime.browser-vault-refresh-requested":
    case "runtime.device-sync-recovery-requested":
    case "runtime.mailbox-lag-observed":
      return buildHostedExecutionRuntimeControlWake({
        eventId,
        kind,
        occurredAt,
        userId: wireUserId,
      });
    case "runtime.codex-auth-requested":
      assertExactHostedCodexAuthKeys(record, [
        "action",
        "attemptId",
        "eventId",
        "kind",
        "occurredAt",
        "userId",
      ], "Hosted execution runtime.codex-auth-requested wake");
      return buildHostedExecutionCodexAuthRequestedWake({
        action: parseHostedCodexAuthAction(record.action),
        attemptId: parseHostedCodexAuthAttemptId(record.attemptId),
        eventId,
        occurredAt,
        userId: wireUserId,
      });
    default:
      throw new TypeError(`Unsupported hosted execution wake kind: ${kind}`);
  }
}

export function parseHostedExecutionConversationMessagePayload(
  value: unknown,
): HostedExecutionConversationMessageWake["message"] {
  const record = requireObject(value, "Hosted execution conversation.message wake payload");
  const channel = parseHostedConversationMessageChannel(
    record.channel,
    "Hosted execution conversation.message wake payload channel",
  );

  switch (channel) {
    case "linq":
      return parseHostedExecutionLinqConversationMessagePayload(record, channel);
    case "telegram":
      return {
        channel,
        telegramMessage: parseHostedExecutionTelegramMessage(record.telegramMessage),
      };
    case "whatsapp":
      return parseHostedExecutionWhatsAppConversationMessagePayload(record, channel);
    case "email":
      return {
        ...(record.attachmentSummaries === undefined
          ? {}
          : {
              attachmentSummaries: parseHostedExecutionEmailAttachmentSummaries(
                record.attachmentSummaries,
                "Hosted execution conversation.message wake payload attachmentSummaries",
              ),
            }),
        channel,
        ...(record.cc === undefined
          ? {}
          : {
              cc: readOptionalStringArray(
                record.cc,
                "Hosted execution conversation.message wake payload cc",
              ),
            }),
        ...(record.from === undefined
          ? {}
          : {
              from: readOptionalNullableString(
                record.from,
                "Hosted execution conversation.message wake payload from",
              ),
            }),
        identityId: readNullableStringValue(
          record.identityId,
          "Hosted execution conversation.message wake payload identityId",
        ),
        ...(record.messageId === undefined
          ? {}
          : {
              messageId: readOptionalNullableString(
                record.messageId,
                "Hosted execution conversation.message wake payload messageId",
              ),
            }),
        rawMessageKey: requireString(
          record.rawMessageKey,
          "Hosted execution conversation.message wake payload rawMessageKey",
        ),
        ...(record.selfAddress === undefined
          ? {}
          : {
              selfAddress: readOptionalNullableString(
                record.selfAddress,
                "Hosted execution conversation.message wake payload selfAddress",
              ),
            }),
        ...(record.subject === undefined
          ? {}
          : {
              subject: readOptionalNullableString(
                record.subject,
                "Hosted execution conversation.message wake payload subject",
              ),
            }),
        ...(record.textPreview === undefined
          ? {}
          : {
              textPreview: readOptionalNullableString(
                record.textPreview,
                "Hosted execution conversation.message wake payload textPreview",
              ),
            }),
        ...(record.threadKey === undefined
          ? {}
          : {
              threadKey: readOptionalNullableString(
                record.threadKey,
                "Hosted execution conversation.message wake payload threadKey",
              ),
            }),
        ...(record.threadTarget === undefined
          ? {}
          : {
              threadTarget: readOptionalNullableString(
                record.threadTarget,
                "Hosted execution conversation.message wake payload threadTarget",
              ),
            }),
        ...(record.to === undefined
          ? {}
          : {
              to: readOptionalStringArray(
                record.to,
                "Hosted execution conversation.message wake payload to",
              ),
            }),
      };
  }
}

function parseHostedExecutionWhatsAppConversationMessagePayload(
  record: Record<string, unknown>,
  channel: "whatsapp",
): HostedExecutionWhatsAppConversationMessagePayload {
  const messageRecord = requireObject(
    record.whatsappMessage,
    "Hosted execution conversation.message wake payload whatsappMessage",
  );
  const label = "Hosted execution conversation.message wake payload whatsappMessage";

  return {
    channel,
    whatsappMessage: {
      fromWaId: requireString(messageRecord.fromWaId, `${label} fromWaId`),
      messageId: requireString(messageRecord.messageId, `${label} messageId`),
      ...(messageRecord.phoneNumberId === undefined
        ? {}
        : {
            phoneNumberId: readOptionalNullableString(
              messageRecord.phoneNumberId,
              `${label} phoneNumberId`,
            ),
          }),
      schema: requireHostedExecutionWhatsAppMessageSchema(messageRecord.schema, `${label} schema`),
      text: requireString(messageRecord.text, `${label} text`),
      threadId: requireString(messageRecord.threadId, `${label} threadId`),
    },
  };
}

function requireHostedExecutionWhatsAppMessageSchema(
  value: unknown,
  label: string,
): HostedExecutionWhatsAppConversationMessagePayload["whatsappMessage"]["schema"] {
  const schema = requireString(value, label);
  if (schema !== "murph.hosted-whatsapp-message.v1") {
    throw new TypeError(`${label} is invalid.`);
  }
  return schema;
}

function parseHostedExecutionLinqConversationMessagePayload(
  record: Record<string, unknown>,
  channel: "linq",
): HostedExecutionLinqConversationMessagePayload {
  const linqMessage = parseHostedExecutionLinqConversationMessage(
    record.linqMessage,
    "Hosted execution conversation.message wake payload linqMessage",
  );
  const routeAuthority = parseOptionalHostedExecutionLinqExternalThreadRouteAuthority(
    record.routeAuthority,
    "Hosted execution conversation.message wake payload routeAuthority",
  );

  if (record.contactLookupKey !== undefined || record.contactKind !== undefined) {
    const contactKind = parseHostedExecutionLinqConversationContactKind(
      record.contactKind,
      "Hosted execution conversation.message wake payload contactKind",
    );
    const contactLookupKey = requireString(
      record.contactLookupKey,
      "Hosted execution conversation.message wake payload contactLookupKey",
    );
    return {
      ...(record.accountLookupKey === undefined
        ? {}
        : {
            accountLookupKey: readOptionalNullableString(
              record.accountLookupKey,
              "Hosted execution conversation.message wake payload accountLookupKey",
            ),
          }),
      channel,
      contactKind,
      contactLookupKey,
      linqMessage,
      ...(record.phoneLookupKey === undefined
        ? {}
        : {
            phoneLookupKey: readOptionalNullableString(
              record.phoneLookupKey,
              "Hosted execution conversation.message wake payload phoneLookupKey",
            ),
          }),
      ...(routeAuthority === undefined ? {} : { routeAuthority }),
    };
  }

  const phoneLookupKey = requireString(
    record.phoneLookupKey,
    "Hosted execution conversation.message wake payload phoneLookupKey",
  );
  return {
    ...(record.accountLookupKey === undefined
      ? {}
      : {
          accountLookupKey: readOptionalNullableString(
            record.accountLookupKey,
            "Hosted execution conversation.message wake payload accountLookupKey",
          ),
        }),
    channel,
    contactKind: "phone",
    contactLookupKey: phoneLookupKey,
    linqMessage,
    phoneLookupKey,
    ...(routeAuthority === undefined ? {} : { routeAuthority }),
  };
}

function parseOptionalHostedExecutionExternalThreadRouteAuthority(
  value: unknown,
  label: string,
): HostedExecutionExternalThreadRouteAuthority | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return parseHostedExecutionExternalThreadRouteAuthority(value, label);
}

function parseOptionalHostedExecutionLinqExternalThreadRouteAuthority(
  value: unknown,
  label: string,
): HostedExecutionLinqExternalThreadRouteAuthority | null | undefined {
  const authority = parseOptionalHostedExecutionExternalThreadRouteAuthority(value, label);
  if (!authority) {
    return authority;
  }

  if (authority.channel !== "linq") {
    throw new TypeError(`${label} channel must be linq.`);
  }

  return {
    ...authority,
    channel: "linq",
  };
}

export function parseHostedExecutionExternalThreadRouteAuthority(
  value: unknown,
  label = "Hosted execution external thread route authority",
): HostedExecutionExternalThreadRouteAuthority {
  const record = requireObject(value, label);
  return {
    accountLookupKey: requireString(record.accountLookupKey, `${label} accountLookupKey`),
    channel: parseHostedExecutionExternalThreadRouteChannel(record.channel, `${label} channel`),
    containerMemberId: requireString(record.containerMemberId, `${label} containerMemberId`),
    threadId: requireString(record.threadId, `${label} threadId`),
  };
}

function parseHostedExecutionExternalThreadRouteChannel(
  value: unknown,
  label: string,
): HostedExecutionExternalThreadRouteAuthority["channel"] {
  const channel = requireString(value, label);
  switch (channel) {
    case "email":
    case "linq":
    case "telegram":
      return channel;
    default:
      throw new TypeError(`${label} is invalid.`);
  }
}

function parseHostedExecutionLinqConversationContactKind(
  value: unknown,
  label: string,
) {
  if (!isHostedLinqConversationContactKind(value)) {
    throw new TypeError(`${label} must be phone or email.`);
  }

  return value;
}

function parseHostedExecutionEmailAttachmentSummaries(
  value: unknown,
  label: string,
): HostedExecutionEmailAttachmentSummary[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return value.map((entry, index) => {
    const record = requireObject(entry, `${label}[${index}]`);
    return {
      ...(record.contentType === undefined
        ? {}
        : {
            contentType: readOptionalNullableString(
              record.contentType,
              `${label}[${index}] contentType`,
            ),
          }),
      ...(record.fileName === undefined
        ? {}
        : {
            fileName: readOptionalNullableString(
              record.fileName,
              `${label}[${index}] fileName`,
            ),
          }),
      ...(record.sizeBytes === undefined
        ? {}
        : {
            sizeBytes: readNullableNumber(
              record.sizeBytes,
              `${label}[${index}] sizeBytes`,
            ),
          }),
    };
  });
}

function parseHostedExecutionOptionalTimeZone(
  value: unknown,
  label: string,
): string | null | undefined {
  const timeZone = readOptionalNullableString(value, label);

  if (timeZone === undefined || timeZone === null) {
    return timeZone;
  }

  const normalized = normalizeIanaTimeZone(timeZone);

  if (!normalized) {
    throw new TypeError(`${label} must be a valid IANA timezone.`);
  }

  return normalized;
}

function parseHostedExecutionLinqConversationMessage(
  value: unknown,
  label: string,
): HostedExecutionLinqConversationMessagePayload["linqMessage"] {
  const record = requireObject(value, label);
  return {
    chatId: requireString(record.chatId, `${label} chatId`),
    from: requireString(record.from, `${label} from`),
    isFromMe: requireBoolean(record.isFromMe, `${label} isFromMe`),
    messageId: requireString(record.messageId, `${label} messageId`),
    parts: requireArray(record.parts, `${label} parts`).map((entry, index) =>
      parseHostedExecutionLinqConversationMessagePart(entry, `${label} parts[${index}]`)
    ),
    ...(record.reactionEligible === undefined
      ? {}
      : {
          reactionEligible: requireBoolean(
            record.reactionEligible,
            `${label} reactionEligible`,
          ),
        }),
    ...(record.replyToMessageId === undefined
      ? {}
      : {
          replyToMessageId: readOptionalNullableString(
            record.replyToMessageId,
            `${label} replyToMessageId`,
          ),
        }),
    ...(record.replyToPartIndex === undefined
      ? {}
      : {
          replyToPartIndex: readNullableNumber(
            record.replyToPartIndex,
            `${label} replyToPartIndex`,
          ),
        }),
    ...(record.service === undefined
      ? {}
      : {
          service: readOptionalNullableString(record.service, `${label} service`),
        }),
    ...(record.threadIsDirect === undefined
      ? {}
      : {
          threadIsDirect: record.threadIsDirect === null
            ? null
            : requireBoolean(record.threadIsDirect, `${label} threadIsDirect`),
        }),
  };
}

function parseHostedExecutionLinqConversationMessagePart(
  value: unknown,
  label: string,
): HostedExecutionLinqConversationMessagePayload["linqMessage"]["parts"][number] {
  const record = requireObject(value, label);
  const type = requireString(record.type, `${label} type`);

  if (type === "text" || type === "link") {
    return {
      type,
      value: requireString(record.value, `${label} value`),
    };
  }

  if (type === "media" || type === "voice_memo") {
    return {
      ...(record.attachmentId === undefined
        ? {}
        : {
            attachmentId: readOptionalNullableString(
              record.attachmentId,
              `${label} attachmentId`,
            ),
          }),
      ...(record.fileName === undefined
        ? {}
        : {
            fileName: readOptionalNullableString(record.fileName, `${label} fileName`),
          }),
      ...(record.mimeType === undefined
        ? {}
        : {
            mimeType: readOptionalNullableString(record.mimeType, `${label} mimeType`),
          }),
      ...(record.size === undefined
        ? {}
        : {
            size: readNullableNumber(record.size, `${label} size`),
          }),
      type,
      ...(record.url === undefined
        ? {}
        : {
            url: readOptionalNullableString(record.url, `${label} url`),
          }),
    };
  }

  throw new TypeError(`${label} type must be "text", "link", "media", or "voice_memo".`);
}

function parseHostedExecutionRedactedLogEntry(
  value: unknown,
  label: string,
): HostedExecutionRedactedLogEntry {
  const record = requireObject(value, label);
  return {
    component: requireString(record.component, `${label} component`),
    ...(record.eventId === undefined
      ? {}
      : {
          eventId: readOptionalNullableString(record.eventId, `${label} eventId`),
        }),
    level: parseHostedExecutionLogLevelValue(record.level, `${label} level`),
    message: requireString(record.message, `${label} message`),
    phase: requireString(record.phase, `${label} phase`),
    ...(record.redacted === undefined
      ? {}
      : {
          redacted: record.redacted === null
            ? null
            : requireObject(record.redacted, `${label} redacted`),
        }),
  };
}

function parseHostedExecutionLogLevelValue(
  value: unknown,
  label: string,
): HostedExecutionLogLevel {
  const level = requireString(value, label);
  if (isHostedExecutionLogLevel(level)) {
    return level;
  }
  throw new TypeError(`${label} must be a valid hosted execution log level.`);
}

export function parseHostedExecutionEvent(value: unknown): HostedExecutionEvent {
  const record = requireObject(value, "Hosted execution event");
  const kind = requireString(record.kind, "Hosted execution event kind");
  const userId = requireString(record.userId, "Hosted execution event userId");

  switch (kind) {
    case "member.activated": {
      const timeZone = parseHostedExecutionOptionalTimeZone(
        record.timeZone,
        "Hosted execution member.activated timeZone",
      );

      return {
        kind,
        memberChannels: parseHostedExecutionMemberChannels(
          record.memberChannels,
          "Hosted execution member.activated memberChannels",
        ),
        ...(record.signupWelcome === undefined
          ? {}
          : {
              signupWelcome: record.signupWelcome === null
                ? null
                : parseHostedExecutionMemberActivationSignupWelcome(
                    record.signupWelcome,
                    "Hosted execution member.activated signupWelcome",
                  ),
            }),
        ...(timeZone === undefined ? {} : { timeZone }),
        userId,
      };
    }
    case "member.channels.updated":
      return {
        kind,
        memberChannels: parseHostedExecutionMemberChannels(
          record.memberChannels,
          "Hosted execution member.channels.updated memberChannels",
        ),
        userId,
      } satisfies HostedExecutionMemberChannelsUpdatedEvent;
    case "assistant.notification.requested":
      return {
        kind,
        notification: parseHostedExecutionAssistantNotificationRequestedPayload(
          record.notification,
          "Hosted execution assistant.notification.requested notification",
        ),
        userId,
      };
    case "device-sync.wake":
      return {
        ...(record.connectionId === undefined
          ? {}
          : {
              connectionId: readNullableString(
                record.connectionId,
                "Hosted execution device-sync.wake connectionId",
              ),
            }),
        ...(record.hint === undefined
          ? {}
          : {
              hint: parseHostedExecutionDeviceSyncWakeHint(record.hint),
            }),
        kind,
        ...(record.provider === undefined
          ? {}
          : {
              provider: readNullableString(
                record.provider,
                "Hosted execution device-sync.wake provider",
              ),
            }),
        reason: parseHostedExecutionDeviceSyncReason(record.reason),
        userId,
      } satisfies HostedExecutionDeviceSyncWakeEvent;
    case "runtime.manual-requested":
    case "runtime.maintenance-requested":
    case "runtime.browser-vault-refresh-requested":
    case "runtime.device-sync-recovery-requested":
    case "runtime.mailbox-lag-observed":
      return {
        kind: kind as HostedExecutionPlainRuntimeControlWakeKind,
        userId,
      };
    case "runtime.codex-auth-requested":
      assertExactHostedCodexAuthKeys(record, [
        "action",
        "attemptId",
        "kind",
        "userId",
      ], "Hosted execution runtime.codex-auth-requested event");
      return {
        action: parseHostedCodexAuthAction(record.action),
        attemptId: parseHostedCodexAuthAttemptId(record.attemptId),
        kind,
        userId,
      };
    default:
      throw new TypeError(`Unsupported hosted execution event kind: ${kind}`);
  }
}

function parseHostedExecutionAssistantNotificationRequestedPayload(
  value: unknown,
  label: string,
): HostedExecutionAssistantNotificationRequestedPayload {
  const record = requireObject(value, label);

  return {
    ...(record.deliveryDedupeToken === undefined
      ? {}
      : {
          deliveryDedupeToken: readNullableString(
            record.deliveryDedupeToken,
            `${label}.deliveryDedupeToken`,
          ),
        }),
    ...(record.deliveryDispatchMode === undefined
      ? {}
      : {
          deliveryDispatchMode: record.deliveryDispatchMode === null
            ? null
            : parseHostedExecutionAssistantNotificationDeliveryDispatchMode(
                record.deliveryDispatchMode,
                `${label}.deliveryDispatchMode`,
              ),
        }),
    ...(record.deliveryIdempotencyKey === undefined
      ? {}
      : {
          deliveryIdempotencyKey: readNullableString(
            record.deliveryIdempotencyKey,
            `${label}.deliveryIdempotencyKey`,
          ),
        }),
    ...(record.firstContact === undefined
      ? {}
      : {
          firstContact: record.firstContact === null
            ? null
            : parseHostedExecutionAssistantNotificationFirstContactPolicy(
                record.firstContact,
                `${label}.firstContact`,
              ),
        }),
    instructions: requireString(record.instructions, `${label}.instructions`),
    ...(record.responsePolicy === undefined
      ? {}
      : {
          responsePolicy: record.responsePolicy === null
            ? null
            : parseHostedExecutionAssistantNotificationResponsePolicy(
                record.responsePolicy,
                `${label}.responsePolicy`,
              ),
        }),
    route: parseHostedExecutionAssistantNotificationRoute(record.route, `${label}.route`),
  };
}

function parseHostedExecutionMemberActivationSignupWelcome(
  value: unknown,
  label: string,
): HostedExecutionMemberActivationSignupWelcome {
  const record = requireObject(value, label);

  return {
    route: parseHostedExecutionAssistantNotificationRoute(record.route, `${label}.route`),
    text: requireString(record.text, `${label}.text`),
  };
}

function parseHostedExecutionAssistantNotificationDeliveryDispatchMode(
  value: unknown,
  label: string,
): HostedExecutionAssistantNotificationDeliveryDispatchMode {
  const mode = requireString(value, label);

  if (mode !== "immediate" && mode !== "queue-only") {
    throw new TypeError(`${label} is invalid.`);
  }

  return mode;
}

function parseHostedExecutionAssistantNotificationResponsePolicy(
  value: unknown,
  label: string,
): HostedExecutionAssistantNotificationResponsePolicy {
  const record = requireObject(value, label);
  const kind = requireString(record.kind, `${label}.kind`);

  switch (kind) {
    case "allow_send_or_skip":
    case "require_send":
      return { kind };
    case "require_send_exact_text":
      return {
        kind,
        text: requireString(record.text, `${label}.text`),
      };
    default:
      throw new TypeError(`${label}.kind is invalid.`);
  }
}

function parseHostedExecutionAssistantNotificationFirstContactPolicy(
  value: unknown,
  label: string,
): HostedExecutionAssistantNotificationFirstContactPolicy {
  const record = requireObject(value, label);

  return {
    markSeenOnDeliveryAccepted: requireBoolean(
      record.markSeenOnDeliveryAccepted,
      `${label}.markSeenOnDeliveryAccepted`,
    ),
  };
}

function parseHostedExecutionAssistantNotificationRoute(
  value: unknown,
  label: string,
): HostedExecutionAssistantNotificationRequestedPayload["route"] {
  const record = requireObject(value, label);
  const channel = parseHostedConversationMessageChannel(record.channel, `${label}.channel`);

  return {
    actorId: readNullableString(record.actorId, `${label}.actorId`),
    channel,
    delivery: parseHostedExecutionAssistantNotificationDelivery(
      record.delivery,
      `${label}.delivery`,
    ),
    identityId: readNullableString(record.identityId, `${label}.identityId`),
    threadId: readNullableString(record.threadId, `${label}.threadId`),
    threadIsDirect: record.threadIsDirect === null
      ? null
      : requireBoolean(record.threadIsDirect, `${label}.threadIsDirect`),
  };
}

function parseHostedExecutionAssistantNotificationDelivery(
  value: unknown,
  label: string,
): HostedExecutionAssistantNotificationDelivery {
  const record = requireObject(value, label);
  const kind = requireString(record.kind, `${label}.kind`);

  if (kind !== "explicit" && kind !== "participant" && kind !== "thread") {
    throw new TypeError(`${label}.kind is invalid.`);
  }

  return {
    kind,
    ...(record.source === undefined
      ? {}
      : {
          source: record.source === null
            ? null
            : parseHostedExecutionAssistantNotificationDeliverySource(
                record.source,
                `${label}.source`,
              ),
        }),
    target: requireString(record.target, `${label}.target`),
  };
}

function parseHostedExecutionAssistantNotificationDeliverySource(
  value: unknown,
  label: string,
): HostedExecutionAssistantNotificationDeliverySource {
  const record = requireObject(value, label);
  const kind = requireString(record.kind, `${label}.kind`);

  if (kind !== "linq") {
    throw new TypeError(`${label}.kind is invalid.`);
  }

  return {
    fromPhoneNumber: requireString(record.fromPhoneNumber, `${label}.fromPhoneNumber`),
    kind,
  };
}

function parseHostedExecutionMemberChannels(
  value: unknown,
  label: string,
): HostedExecutionMemberChannels {
  const record = requireObject(value, label);

  return {
    email: requireBoolean(record.email, `${label}.email`),
    linq: requireBoolean(record.linq, `${label}.linq`),
    telegram: requireBoolean(record.telegram, `${label}.telegram`),
  };
}

function parseHostedExecutionWakeKind(value: unknown, label: string): HostedExecutionWakeKind {
  const kind = requireString(value, label);
  if (!isHostedExecutionWakeKind(kind)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return kind;
}

function parseHostedCodexAuthAction(value: unknown): HostedCodexAuthAction {
  const action = requireString(value, "Hosted Codex auth action");
  if (action === "connect" || action === "disconnect") {
    return action;
  }
  throw new TypeError("Hosted Codex auth action is invalid.");
}

function parseHostedCodexAuthAttemptId(value: unknown): string {
  const attemptId = requireString(value, "Hosted Codex auth attemptId");
  if (!/^hca_[A-Za-z0-9_-]{16,64}$/u.test(attemptId)) {
    throw new TypeError("Hosted Codex auth attemptId is invalid.");
  }
  return attemptId;
}

function assertExactHostedCodexAuthKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${label} contains unsupported field ${JSON.stringify(key)}.`);
    }
  }
}

function parseHostedConversationMessageChannel(
  value: unknown,
  label: string,
): HostedExecutionConversationMessageWake["message"]["channel"] {
  const channel = requireString(value, label);

  if (!isHostedConversationMessageChannel(channel)) {
    throw new TypeError(`${label} is invalid.`);
  }

  return channel;
}
