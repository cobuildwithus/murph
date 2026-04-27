import {
  assertContract,
  normalizeIanaTimeZone,
  sharePackSchema,
  type SharePack,
} from "@murphai/contracts";

import {
  HOSTED_INGRESS_PAYLOAD_SCHEMA,
  isHostedConversationMessageChannel,
} from "./contracts.ts";

import type {
  HostedExecutionAssistantNotificationDelivery,
  HostedExecutionAssistantNotificationDeliveryDispatchMode,
  HostedExecutionAssistantNotificationDeliverySource,
  HostedExecutionAssistantNotificationFirstContactPolicy,
  HostedExecutionAssistantNotificationRequestedPayload,
  HostedExecutionAssistantNotificationResponsePolicy,
  HostedExecutionMemberChannels,
  HostedExecutionMemberChannelsUpdatedEvent,
  HostedExecutionDeviceSyncWakeEvent,
  HostedRuntimeEvent,
  HostedIngressEnvelope,
  HostedIngressKind,
  HostedExecutionEvent,
  HostedExecutionConversationMessageWake,
  HostedExecutionLinqConversationMessagePayload,
  HostedExecutionRedactedLogEntry,
  HostedExecutionRunnerRequest,
  HostedExecutionRunnerSharePack,
  HostedExecutionRunnerVaultSyncImport,
  HostedExecutionRunnerResult,
  HostedExecutionShareReference,
  HostedExecutionUserStatus,
  HostedRunDrainResult,
  HostedRunNudgeResult,
  HostedExecutionVaultShareAcceptedEvent,
  HostedExecutionVaultSyncImportEvent,
  HostedIngressLifecycleState,
  HostedIngressPayloadSchema,
  HostedRuntimeDrainEvent,
  HostedRuntimeDrainRequest,
  HostedRunCleanupTarget,
  HostedRunEventResult,
} from "./contracts.ts";
import type {
  HostedExecutionRunContext,
  HostedExecutionRunLevel,
  HostedExecutionRunStatus,
  HostedExecutionTimelineEntry,
} from "./observability.ts";
import {
  isHostedExecutionRunLevel,
  isHostedExecutionRunPhase,
} from "./observability.ts";
import {
  buildHostedExecutionAssistantNotificationRequestedWake,
  buildHostedExecutionEmailConversationMessageWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionMemberChannelsUpdatedWake,
  buildHostedExecutionConversationMessageWake,
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionRuntimeTimerWake,
  buildHostedExecutionTelegramConversationMessageWake,
  buildHostedExecutionVaultShareAcceptedWake,
  buildHostedExecutionVaultSyncImportWake,
} from "./builders.ts";
import {
  rejectLegacyAliases,
  requireArray,
  requireBoolean,
  requireBigIntString,
  requireNumber,
  requireObject,
  requireString,
  readNullableNumber,
  readNullableString,
  readNullableStringValue,
  readOptionalNullableString,
} from "./parsers/assertions.ts";
import {
  parseHostedExecutionBundlePayload,
  parseHostedExecutionBundleRef,
  parseHostedBrowserVaultReplicaRef,
  parseHostedExecutionCursorSnapshotRef,
} from "./parsers/cursor.ts";
import {
  parseHostedExecutionDeviceSyncReason,
  parseHostedExecutionDeviceSyncWakeHint,
} from "./parsers/device-sync.ts";
import {
  parseHostedIngressKind,
} from "./parsers/ingress-control.ts";
import {
  parseHostedRunTriggerKind,
} from "./parsers/run-control.ts";
import { parseHostedExecutionTelegramMessage } from "./parsers/telegram.ts";

export {
  parseHostedExecutionBundlePayload,
  parseHostedExecutionBundleRef,
  parseHostedBrowserVaultReplicaRef,
  parseHostedExecutionCursorSnapshotRef,
  parseHostedExecutionCursorState,
} from "./parsers/cursor.ts";
export {
  parseHostedIngressAppendResponse,
  parseHostedIngressEvent,
} from "./parsers/ingress-control.ts";
export {
  parseHostedRunAcquireRequest,
  parseHostedRunAcquireResponse,
  parseHostedRunCommitRequest,
  parseHostedRunCommitResponse,
  parseHostedRunFinalizeRequest,
  parseHostedRunFinalizeResponse,
  parseHostedRunLogRecord,
  parseHostedRunLogRequest,
  parseHostedRunLogResponse,
  parseHostedRunReleaseFinalizeRequest,
  parseHostedRunReleaseFinalizeResponse,
  parseHostedRunRecord,
  parseHostedRunStatusRequest,
  parseHostedRunStatusResponse,
  parseHostedRunTurnInputAdoptRequest,
  parseHostedRunTurnInputAdoptResponse,
  parseHostedRunTurnInputPeekRequest,
  parseHostedRunTurnInputPeekResponse,
} from "./parsers/run-control.ts";
export {
  parseHostedMailboxFetchRequest,
  parseHostedMailboxFetchResponse,
  parseHostedMailboxItem,
  parseHostedMailboxKind,
  parseHostedMailboxLane,
  parseHostedMailboxLaneCounterState,
  parseHostedMailboxPayload,
  parseHostedMailboxPayloadFetchRequest,
  parseHostedMailboxPayloadFetchResponse,
  parseHostedRunnerNudgeResult,
  parseHostedRunnerStatusResponse,
  parseHostedRuntimeDeviceSyncBridgeEnvelope,
  parseHostedRuntimeIssueExportRequest,
  parseHostedRuntimeIssueExportResponse,
  parseHostedRuntimeLogEntry,
  parseHostedRuntimeLogRequest,
  parseHostedRuntimeLogResponse,
  parseHostedRuntimeShareImportRequest,
  parseHostedRuntimeShareImportResponse,
  parseHostedRuntimeSharePayload,
  parseHostedRuntimeSharePayloadFetchRequest,
  parseHostedRuntimeSharePayloadFetchResponse,
  parseHostedRuntimeUsageExportRequest,
  parseHostedRuntimeUsageExportResponse,
  parseHostedRuntimeVaultSyncImportPayload,
  parseHostedRuntimeVaultSyncImportRequest,
  parseHostedRuntimeVaultSyncImportResponse,
  parseHostedRuntimeVaultSyncImportSummary,
  parseHostedRuntimeVaultSyncPayloadFetchRequest,
  parseHostedRuntimeVaultSyncPayloadFetchResponse,
  parseHostedWorkspaceCheckpointRequest,
  parseHostedWorkspaceCheckpointResponse,
  parseHostedWorkspaceReadResponse,
  parseHostedWorkspaceRunRequest,
  parseHostedWorkspaceRunResult,
  parseHostedWorkspaceState,
} from "./parsers/runtime-control.ts";

export function parseHostedIngressEnvelope(value: unknown): HostedIngressEnvelope {
  const record = requireObject(value, "Hosted execution wake");
  const kind = parseHostedIngressKind(record.kind, "Hosted execution wake kind");
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
        timeZone: parseHostedExecutionOptionalTimeZone(
          record.timeZone,
          "Hosted execution wake member.activated timeZone",
        ),
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
    case "vault.share.accepted":
      return buildHostedExecutionVaultShareAcceptedWake({
        eventId,
        memberId: wireUserId,
        occurredAt,
        share: parseHostedExecutionShareReference(record.share),
      });
    case "vault.sync.import":
      return buildHostedExecutionVaultSyncImportWake({
        eventId,
        memberId: wireUserId,
        occurredAt,
        vaultSync: parseHostedExecutionVaultSyncImportReference(record.vaultSync),
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
      return {
        channel,
        linqMessage: parseHostedExecutionLinqConversationMessage(
          record.linqMessage,
          "Hosted execution conversation.message wake payload linqMessage",
        ),
        phoneLookupKey: requireString(
          record.phoneLookupKey,
          "Hosted execution conversation.message wake payload phoneLookupKey",
        ),
      };
    case "telegram":
      return {
        channel,
        telegramMessage: parseHostedExecutionTelegramMessage(record.telegramMessage),
      };
    case "email":
      return {
        channel,
        identityId: readNullableStringValue(
          record.identityId,
          "Hosted execution conversation.message wake payload identityId",
        ),
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
      };
  }
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

export function parseHostedExecutionRunnerRequest(value: unknown): HostedExecutionRunnerRequest {
  const record = requireObject(value, "Hosted execution runner request");
  if (record.wake !== undefined) {
    throw new TypeError(
      "Hosted execution runner request.wake is no longer supported; use runDrain.",
    );
  }

  if (record.sharePack !== undefined) {
    throw new TypeError(
      "Hosted execution runner request.sharePack is no longer supported; use runDrain.events[].sharePack.",
    );
  }

  const request: HostedExecutionRunnerRequest = {
    bundle: parseHostedExecutionBundlePayload(
      record.bundle,
      "Hosted execution runner request bundle",
    ),
    run: parseHostedExecutionRunContext(record.run),
    runDrain: parseHostedRuntimeDrainRequest(record.runDrain),
  };

  if (record.currentBundleRef !== undefined) {
    request.currentBundleRef = record.currentBundleRef === null
      ? null
      : parseHostedExecutionBundleRef(
          record.currentBundleRef,
          "Hosted execution runner request currentBundleRef",
        );
  }

  return request;
}

export function parseHostedRuntimeEvent(value: unknown): HostedRuntimeEvent {
  const record = requireObject(value, "Hosted execution runner wake");
  const kind = requireString(record.kind, "Hosted execution runner wake kind");

  if (kind === "runtime.timer") {
    return buildHostedExecutionRuntimeTimerWake({
      eventId: requireString(record.eventId, "Hosted execution runner wake eventId"),
      occurredAt: requireString(record.occurredAt, "Hosted execution runner wake occurredAt"),
      triggerKind: parseHostedRunTriggerKind(record.triggerKind),
      userId: requireString(record.userId, "Hosted execution runner wake userId"),
    });
  }

  return parseHostedIngressEnvelope(record);
}

export function parseHostedRuntimeDrainRequest(
  value: unknown,
): HostedRuntimeDrainRequest {
  const record = requireObject(value, "Hosted runtime drain request");

  return {
    acquiredAt: requireString(record.acquiredAt, "Hosted runtime drain request acquiredAt"),
    ...(record.committedResult === undefined
      ? {}
      : {
          committedResult: record.committedResult === null
            ? null
            : parseHostedExecutionRunnerResult(record.committedResult),
        }),
    events: requireArray(record.events, "Hosted runtime drain request events")
      .map((entry, index) => parseHostedRuntimeDrainEvent(
        entry,
        `Hosted runtime drain request events[${index}]`,
      )),
    inputCommittedSeq: requireBigIntString(
      record.inputCommittedSeq,
      "Hosted runtime drain request inputCommittedSeq",
    ),
    inputCursorVersion: requireBigIntString(
      record.inputCursorVersion,
      "Hosted runtime drain request inputCursorVersion",
    ),
    ...(record.resumeFinalize === undefined
      ? {}
      : {
          resumeFinalize: record.resumeFinalize === null
            ? null
            : requireBoolean(
                record.resumeFinalize,
                "Hosted runtime drain request resumeFinalize",
              ),
        }),
    runId: requireString(record.runId, "Hosted runtime drain request runId"),
    triggerKind: parseHostedRunTriggerKind(record.triggerKind),
    userId: requireString(record.userId, "Hosted runtime drain request userId"),
  };
}

export function parseHostedRuntimeDrainEvent(
  value: unknown,
  label = "Hosted runtime drain event",
): HostedRuntimeDrainEvent {
  const record = requireObject(value, label);
  rejectLegacyAliases(record, label, {
    wakeId: "ingressEventId",
  });

  return {
    ingressEventId: requireString(record.ingressEventId, `${label}.ingressEventId`),
    seq: requireBigIntString(record.seq, `${label}.seq`),
    ...(record.sharePack === undefined
      ? {}
      : {
          sharePack: record.sharePack === null
            ? null
            : parseHostedExecutionRunnerSharePack(record.sharePack),
        }),
    ...(record.vaultSyncImport === undefined
      ? {}
      : {
          vaultSyncImport: record.vaultSyncImport === null
            ? null
            : parseHostedExecutionRunnerVaultSyncImport(record.vaultSyncImport),
        }),
    wake: parseHostedRuntimeEvent(record.wake),
  };
}

export function parseHostedExecutionRunnerResult(value: unknown): HostedExecutionRunnerResult {
  const record = requireObject(value, "Hosted execution runner result");
  const result = requireObject(record.result, "Hosted execution runner result.result");

  return {
    bundle: parseHostedExecutionBundlePayload(
      record.bundle,
      "Hosted execution runner result bundle",
    ),
    result: {
      ...(result.adoptedCleanupTargets === undefined
        ? {}
        : {
            adoptedCleanupTargets: requireArray(
              result.adoptedCleanupTargets,
              "Hosted execution runner result adoptedCleanupTargets",
            ).map((entry, index) =>
              parseHostedExecutionRunnerCleanupTarget(
                entry,
                `Hosted execution runner result adoptedCleanupTargets[${index}]`,
              ),
            ),
          }),
      ...(result.adoptedEventResults === undefined
        ? {}
        : {
            adoptedEventResults: requireArray(
              result.adoptedEventResults,
              "Hosted execution runner result adoptedEventResults",
            ).map((entry, index) =>
              parseHostedExecutionRunnerEventResult(
                entry,
                `Hosted execution runner result adoptedEventResults[${index}]`,
              ),
            ),
          }),
      eventsHandled: requireNumber(result.eventsHandled, "Hosted execution runner result eventsHandled"),
      nextWakeAt: readOptionalNullableString(
        result.nextWakeAt,
        "Hosted execution runner result nextWakeAt",
      ),
      ...(result.redactedDetails === undefined
        ? {}
        : {
            redactedDetails: result.redactedDetails === null
              ? null
              : requireObject(
                  result.redactedDetails,
                  "Hosted execution runner result redactedDetails",
                ),
          }),
      ...(result.redactedLogEntries === undefined
        ? {}
        : {
            redactedLogEntries: result.redactedLogEntries === null
              ? null
              : requireArray(
                  result.redactedLogEntries,
                  "Hosted execution runner result redactedLogEntries",
                ).map((entry, index) =>
                  parseHostedExecutionRedactedLogEntry(
                    entry,
                    `Hosted execution runner result redactedLogEntries[${index}]`,
                  ),
                ),
          }),
      summary: requireString(result.summary, "Hosted execution runner result summary"),
    },
  };
}

function parseHostedExecutionRunnerCleanupTarget(
  value: unknown,
  label: string,
): HostedRunCleanupTarget {
  const record = requireObject(value, label);
  const channel = requireString(record.channel, `${label}.channel`);

  if (channel === "email") {
    return {
      channel,
      eventId: requireString(record.eventId, `${label}.eventId`),
      rawMessageKey: requireString(record.rawMessageKey, `${label}.rawMessageKey`),
      userId: requireString(record.userId, `${label}.userId`),
    };
  }

  if (channel === "linq") {
    return {
      channel,
      messageId: requireString(record.messageId, `${label}.messageId`),
    };
  }

  if (channel === "telegram") {
    return {
      channel,
      messageId: requireString(record.messageId, `${label}.messageId`),
      target: requireString(record.target, `${label}.target`),
    };
  }

  throw new TypeError(`${label}.channel must be email, linq, or telegram.`);
}

function parseHostedExecutionRunnerEventResult(
  value: unknown,
  label: string,
): HostedRunEventResult {
  const record = requireObject(value, label);
  rejectLegacyAliases(record, label, {
    wakeId: "ingressEventId",
  });
  const state = requireString(record.state, `${label}.state`);

  if (state !== "completed" && state !== "quarantined") {
    throw new TypeError(`${label}.state must be completed or quarantined.`);
  }

  return {
    ingressEventId: requireString(record.ingressEventId, `${label}.ingressEventId`),
    ...(record.quarantineCode === undefined
      ? {}
      : {
          quarantineCode: readNullableString(record.quarantineCode, `${label}.quarantineCode`),
        }),
    state,
  };
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
    level: parseHostedRunLogLevelValue(record.level, `${label} level`),
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

function parseHostedRunLogLevelValue(
  value: unknown,
  label: string,
): HostedExecutionRunLevel {
  const level = requireString(value, label);
  if (isHostedExecutionRunLevel(level)) {
    return level;
  }
  throw new TypeError(`${label} must be a valid hosted execution run level.`);
}

export function parseHostedExecutionUserStatus(value: unknown): HostedExecutionUserStatus {
  const record = requireObject(value, "Hosted execution user status");
  rejectLegacyAliases(record, "Hosted execution user status", {
    pendingWakeCount: "pendingIngressEventCount",
  });

  return {
    bundleRef: parseHostedExecutionBundleRef(
      record.bundleRef,
      "Hosted execution user status bundleRef",
    ),
    inFlight: requireBoolean(record.inFlight, "Hosted execution user status inFlight"),
    lastError: readNullableString(record.lastError, "Hosted execution user status lastError"),
    ...(record.lastErrorAt === undefined ? {} : {
      lastErrorAt: readNullableString(record.lastErrorAt, "Hosted execution user status lastErrorAt"),
    }),
    ...(record.lastErrorCode === undefined ? {} : {
      lastErrorCode: readNullableString(
        record.lastErrorCode,
        "Hosted execution user status lastErrorCode",
      ),
    }),
    lastEventId: readNullableString(record.lastEventId, "Hosted execution user status lastEventId"),
    lastRunAt: readNullableString(record.lastRunAt, "Hosted execution user status lastRunAt"),
    nextWakeAt: readNullableString(record.nextWakeAt, "Hosted execution user status nextWakeAt"),
    pendingIngressEventCount: requireNumber(
      record.pendingIngressEventCount,
      "Hosted execution user status pendingIngressEventCount",
    ),
    ...(record.run === undefined ? {} : {
      run: record.run === null ? null : parseHostedExecutionRunStatus(record.run),
    }),
    ...(record.timeline === undefined ? {} : {
      timeline: parseHostedExecutionTimelineEntries(record.timeline),
    }),
    userId: requireString(record.userId, "Hosted execution user status userId"),
  };
}

export function parseHostedRunDrainResult(
  value: unknown,
): HostedRunDrainResult {
  const record = requireObject(value, "Hosted execution wake drain result");

  return {
    committedSeq: requireBigIntString(
      record.committedSeq,
      "Hosted execution wake drain result committedSeq",
    ),
    requestedTargetSeq: readNullableString(
      record.requestedTargetSeq,
      "Hosted execution wake drain result requestedTargetSeq",
    ),
    targetReached: requireBoolean(
      record.targetReached,
      "Hosted execution wake drain result targetReached",
    ),
  };
}

export function parseHostedRunNudgeResult(
  value: unknown,
): HostedRunNudgeResult {
  const record = requireObject(value, "Hosted execution wake nudge result");

  return {
    accepted: requireBoolean(
      record.accepted,
      "Hosted execution wake nudge result accepted",
    ),
    alarmScheduled: requireBoolean(
      record.alarmScheduled,
      "Hosted execution wake nudge result alarmScheduled",
    ),
    alreadyRunning: requireBoolean(
      record.alreadyRunning,
      "Hosted execution wake nudge result alreadyRunning",
    ),
  };
}

export function parseHostedExecutionRunContext(value: unknown): HostedExecutionRunContext {
  const record = requireObject(value, "Hosted execution run context");

  return {
    attempt: requireNumber(record.attempt, "Hosted execution run context attempt"),
    runId: requireString(record.runId, "Hosted execution run context runId"),
    startedAt: requireString(record.startedAt, "Hosted execution run context startedAt"),
  };
}

export function parseHostedExecutionRunStatus(value: unknown): HostedExecutionRunStatus {
  const record = requireObject(value, "Hosted execution run status");
  const phase = requireString(record.phase, "Hosted execution run status phase");

  if (!isHostedExecutionRunPhase(phase)) {
    throw new TypeError("Hosted execution run status phase is invalid.");
  }

  return {
    attempt: requireNumber(record.attempt, "Hosted execution run status attempt"),
    eventId: requireString(record.eventId, "Hosted execution run status eventId"),
    phase,
    runId: requireString(record.runId, "Hosted execution run status runId"),
    startedAt: requireString(record.startedAt, "Hosted execution run status startedAt"),
    updatedAt: requireString(record.updatedAt, "Hosted execution run status updatedAt"),
  };
}

export function parseHostedExecutionTimelineEntries(value: unknown): HostedExecutionTimelineEntry[] {
  return requireArray(value, "Hosted execution timeline entries").map((entry, index) => {
    const record = requireObject(entry, `Hosted execution timeline entries[${index}]`);
    const level = requireString(record.level, `Hosted execution timeline entries[${index}].level`);
    const phase = requireString(record.phase, `Hosted execution timeline entries[${index}].phase`);

    if (!isHostedExecutionRunLevel(level)) {
      throw new TypeError(`Hosted execution timeline entries[${index}].level is invalid.`);
    }

    if (!isHostedExecutionRunPhase(phase)) {
      throw new TypeError(`Hosted execution timeline entries[${index}].phase is invalid.`);
    }

    return {
      at: requireString(record.at, `Hosted execution timeline entries[${index}].at`),
      attempt: requireNumber(record.attempt, `Hosted execution timeline entries[${index}].attempt`),
      component: requireString(
        record.component,
        `Hosted execution timeline entries[${index}].component`,
      ),
      ...(record.errorCode === undefined ? {} : {
        errorCode: readNullableString(
          record.errorCode,
          `Hosted execution timeline entries[${index}].errorCode`,
        ),
      }),
      eventId: requireString(record.eventId, `Hosted execution timeline entries[${index}].eventId`),
      level,
      message: requireString(record.message, `Hosted execution timeline entries[${index}].message`),
      phase,
      runId: requireString(record.runId, `Hosted execution timeline entries[${index}].runId`),
    };
  });
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
    case "vault.share.accepted":
      return {
        kind,
        share: parseHostedExecutionShareReference(record.share),
        userId,
      } satisfies HostedExecutionVaultShareAcceptedEvent;
    case "vault.sync.import":
      return {
        kind,
        userId,
        vaultSync: parseHostedExecutionVaultSyncImportReference(record.vaultSync),
      } satisfies HostedExecutionVaultSyncImportEvent;
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

export function parseHostedExecutionShareReference(value: unknown): HostedExecutionShareReference {
  const record = requireObject(value, "Hosted execution share reference");

  return {
    ownerUserId: requireString(
      record.ownerUserId,
      "Hosted execution share reference ownerUserId",
    ),
    shareId: requireString(record.shareId, "Hosted execution share reference shareId"),
  };
}


export function parseHostedExecutionVaultSyncImportReference(
  value: unknown,
): HostedExecutionVaultSyncImportEvent["vaultSync"] {
  const record = requireObject(value, "Hosted execution vault sync import reference");

  return {
    localManifestHash: requireString(
      record.localManifestHash,
      "Hosted execution vault sync import reference localManifestHash",
    ),
    sessionId: requireString(
      record.sessionId,
      "Hosted execution vault sync import reference sessionId",
    ),
    ...(record.sourceSchemaVersion === undefined
      ? {}
      : {
          sourceSchemaVersion: readOptionalNullableString(
            record.sourceSchemaVersion,
            "Hosted execution vault sync import reference sourceSchemaVersion",
          ),
        }),
    ...(record.sourceVaultId === undefined
      ? {}
      : {
          sourceVaultId: readOptionalNullableString(
            record.sourceVaultId,
            "Hosted execution vault sync import reference sourceVaultId",
          ),
        }),
    ...(record.sourceVaultTitle === undefined
      ? {}
      : {
          sourceVaultTitle: readOptionalNullableString(
            record.sourceVaultTitle,
            "Hosted execution vault sync import reference sourceVaultTitle",
          ),
        }),
  };
}

export function parseHostedExecutionRunnerSharePack(value: unknown): HostedExecutionRunnerSharePack {
  const record = requireObject(value, "Hosted execution runner share pack");

  return {
    ownerUserId: requireString(
      record.ownerUserId,
      "Hosted execution runner share pack ownerUserId",
    ),
    pack: assertContract(sharePackSchema, record.pack, "share pack"),
    shareId: requireString(record.shareId, "Hosted execution runner share pack shareId"),
  };
}


export function parseHostedExecutionRunnerVaultSyncImport(
  value: unknown,
): HostedExecutionRunnerVaultSyncImport {
  const record = requireObject(value, "Hosted execution runner vault sync import");

  return {
    bundleBase64: requireString(
      record.bundleBase64,
      "Hosted execution runner vault sync import bundleBase64",
    ),
    sessionId: requireString(
      record.sessionId,
      "Hosted execution runner vault sync import sessionId",
    ),
    ...(record.sourceSchemaVersion === undefined
      ? {}
      : {
          sourceSchemaVersion: readOptionalNullableString(
            record.sourceSchemaVersion,
            "Hosted execution runner vault sync import sourceSchemaVersion",
          ),
        }),
  };
}

export function parseHostedExecutionSharePack(value: unknown): SharePack {
  return assertContract(sharePackSchema, value, "share pack");
}

export function parseHostedIngressPayload(input: {
  decryptedPayload?: unknown;
  kind: HostedIngressKind;
  occurredAt: string;
  payloadSchema: HostedIngressPayloadSchema;
  userId: string;
}): HostedIngressEnvelope {
  if (input.payloadSchema !== HOSTED_INGRESS_PAYLOAD_SCHEMA) {
    throw new TypeError("Hosted wake payload requires the execution payload schema.");
  }

  const wake = parseHostedIngressEnvelope(input.decryptedPayload);

  if (wake.userId !== input.userId) {
    throw new TypeError("Hosted wake payload userId must match the wake record.");
  }

  if (wake.kind !== input.kind) {
    throw new TypeError("Hosted wake payload kind must match the wake record.");
  }

  if (wake.occurredAt !== input.occurredAt) {
    throw new TypeError("Hosted wake payload occurredAt must match the wake record.");
  }

  return wake;
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
