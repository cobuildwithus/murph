import {
  assertContract,
  sharePackSchema,
  type SharePack,
} from "@murphai/contracts";
import { parseHostedExecutionBundleRef as parseRuntimeHostedExecutionBundleRef } from "@murphai/runtime-state";

import {
  HOSTED_INGRESS_PAYLOAD_SCHEMA,
  HOSTED_INGRESS_PAYLOAD_SCHEMAS,
  HOSTED_INGRESS_BEHAVIORS,
  isHostedConversationMessageChannel,
  isHostedIngressKind,
} from "./contracts.ts";

import type {
  HostedExecutionAssistantCronTickEvent,
  HostedExecutionMemberChannels,
  HostedExecutionMemberChannelsUpdatedEvent,
  HostedExecutionDeviceSyncWakeEvent,
  HostedRuntimeEvent,
  HostedIngressEnvelope,
  HostedIngressKind,
  HostedExecutionEvent,
  HostedExecutionConversationMessageWake,
  HostedExecutionCursorState,
  HostedExecutionLinqConversationMessagePayload,
  HostedExecutionMemberActivatedEvent,
  HostedExecutionRunnerRequest,
  HostedExecutionRunnerSharePack,
  HostedExecutionRunnerResult,
  HostedExecutionShareReference,
  HostedExecutionUserStatus,
  HostedRunDrainResult,
  HostedRunNudgeResult,
  HostedExecutionVaultShareAcceptedEvent,
  HostedIngressBehavior,
  HostedIngressAppendResponse,
  HostedIngressLifecycleState,
  HostedIngressPayloadSchema,
  HostedIngressEvent,
  HostedRunAcquireRequest,
  HostedRunAcquireResponse,
  HostedRunCommitRequest,
  HostedRunCommitResponse,
  HostedRunEventResult,
  HostedRunExecutorKind,
  HostedRunFinalizeRequest,
  HostedRunFinalizeResponse,
  HostedRunLogLevel,
  HostedRunLogRecord,
  HostedRunLogRequest,
  HostedRunLogResponse,
  HostedRunRecord,
  HostedRunStatus,
  HostedRunStatusRequest,
  HostedRunStatusResponse,
  HostedRunTriggerKind,
  HostedRuntimeDrainEvent,
  HostedRuntimeDrainRequest,
} from "./contracts.ts";
import {
  HOSTED_RUN_EXECUTOR_KINDS,
  HOSTED_RUN_LOG_LEVELS,
  HOSTED_RUN_STATUSES,
  HOSTED_RUN_TRIGGER_KINDS,
} from "./contracts.ts";
import {
  type HostedExecutionBundlePayload,
  type HostedExecutionBundleRefState,
} from "./bundles.ts";
import type {
  HostedExecutionRunContext,
  HostedExecutionRunStatus,
  HostedExecutionTimelineEntry,
} from "./observability.ts";
import {
  isHostedExecutionRunLevel,
  isHostedExecutionRunPhase,
} from "./observability.ts";
import {
  buildHostedExecutionAssistantCronTickWake,
  buildHostedExecutionEmailConversationMessageWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionMemberChannelsUpdatedWake,
  buildHostedExecutionConversationMessageWake,
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionRuntimeTimerWake,
  buildHostedExecutionTelegramConversationMessageWake,
  buildHostedExecutionVaultShareAcceptedWake,
} from "./builders.ts";
import {
  requireArray,
  requireBoolean,
  requireNumber,
  requireObject,
  requireString,
  requireStringArray,
  readNullableNumber,
  readNullableString,
  readNullableStringValue,
  readOptionalNullableString,
  readOptionalStringArray,
} from "./parsers/assertions.ts";
import {
  parseHostedExecutionCronReason,
  parseHostedExecutionDeviceSyncReason,
  parseHostedExecutionDeviceSyncWakeHint,
} from "./parsers/device-sync.ts";
import { parseHostedExecutionTelegramMessage } from "./parsers/telegram.ts";

export function parseHostedIngressEnvelope(value: unknown): HostedIngressEnvelope {
  const record = requireObject(value, "Hosted execution wake");
  const kind = parseHostedIngressKind(record.kind, "Hosted execution wake kind");
  const eventId = requireString(record.eventId, "Hosted execution wake eventId");
  const occurredAt = requireString(record.occurredAt, "Hosted execution wake occurredAt");
  const userId = requireString(record.userId, "Hosted execution wake userId");

  switch (kind) {
    case "conversation.message":
      return buildHostedExecutionConversationMessageWake({
        eventId,
        message: parseHostedExecutionConversationMessagePayload(record.message),
        occurredAt,
        userId,
      });
    case "member.activated":
      return buildHostedExecutionMemberActivatedWake({
        ...(record.firstContact === undefined
          ? {}
          : {
              firstContact: record.firstContact === null
                ? null
                : parseHostedExecutionFirstContactTarget(record.firstContact),
            }),
        eventId,
        memberChannels: parseHostedExecutionMemberChannels(
          record.memberChannels,
          "Hosted execution wake member.activated memberChannels",
        ),
        memberId: userId,
        occurredAt,
      });
    case "member.channels.updated":
      return buildHostedExecutionMemberChannelsUpdatedWake({
        eventId,
        memberChannels: parseHostedExecutionMemberChannels(
          record.memberChannels,
          "Hosted execution wake member.channels.updated memberChannels",
        ),
        memberId: userId,
        occurredAt,
      });
    case "assistant.cron.tick":
      return buildHostedExecutionAssistantCronTickWake({
        eventId,
        occurredAt,
        reason: parseHostedExecutionCronReason(record.reason),
        userId,
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
        userId,
      });
    case "vault.share.accepted":
      return buildHostedExecutionVaultShareAcceptedWake({
        eventId,
        memberId: userId,
        occurredAt,
        share: parseHostedExecutionShareReference(record.share),
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
  const wake = parseHostedRuntimeEvent(record.wake);
  const runDrain = record.runDrain === undefined
    ? undefined
    : record.runDrain === null
      ? null
      : parseHostedRuntimeDrainRequest(record.runDrain);
  const sharePack = record.sharePack === undefined
    ? undefined
    : record.sharePack === null
      ? null
      : parseHostedExecutionRunnerSharePack(record.sharePack);

  if (wake.kind === "vault.share.accepted") {
    if (!sharePack) {
      throw new TypeError(
        "Hosted execution runner request.sharePack is required for vault.share.accepted wakes.",
      );
    }

    if (sharePack.ownerUserId !== wake.share.ownerUserId) {
      throw new TypeError(
        "Hosted execution runner request.sharePack ownerUserId must match wake.share.ownerUserId.",
      );
    }

    if (sharePack.shareId !== wake.share.shareId) {
      throw new TypeError(
        "Hosted execution runner request.sharePack shareId must match wake.share.shareId.",
      );
    }
  } else if (sharePack !== undefined) {
    throw new TypeError(
      "Hosted execution runner request.sharePack is only supported for vault.share.accepted wakes.",
    );
  }

  const request: HostedExecutionRunnerRequest = {
    bundle: parseHostedExecutionBundlePayload(
      record.bundle,
      "Hosted execution runner request bundle",
    ),
    wake,
  };

  if (record.currentBundleRef !== undefined) {
    request.currentBundleRef = record.currentBundleRef === null
      ? null
      : parseHostedExecutionBundleRef(
          record.currentBundleRef,
          "Hosted execution runner request currentBundleRef",
        );
  }

  if (runDrain !== undefined) {
    request.runDrain = runDrain;
  }

  if (record.run !== undefined) {
    request.run = record.run === null ? null : parseHostedExecutionRunContext(record.run);
  }

  if (sharePack !== undefined) {
    request.sharePack = sharePack;
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

  return {
    seq: requireBigIntString(record.seq, `${label}.seq`),
    ...(record.sharePack === undefined
      ? {}
      : {
          sharePack: record.sharePack === null
            ? null
            : parseHostedExecutionRunnerSharePack(record.sharePack),
        }),
    wake: parseHostedIngressEnvelope(record.wake),
    wakeId: requireString(record.wakeId, `${label}.wakeId`),
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
      eventsHandled: requireNumber(result.eventsHandled, "Hosted execution runner result eventsHandled"),
      nextWakeAt: readOptionalNullableString(
        result.nextWakeAt,
        "Hosted execution runner result nextWakeAt",
      ),
      summary: requireString(result.summary, "Hosted execution runner result summary"),
    },
  };
}

export function parseHostedExecutionUserStatus(value: unknown): HostedExecutionUserStatus {
  const record = requireObject(value, "Hosted execution user status");

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
    pendingWakeCount: requireNumber(
      record.pendingWakeCount,
      "Hosted execution user status pendingWakeCount",
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

export function parseHostedExecutionBundlePayload(
  value: unknown,
  label = "Hosted execution bundle",
): HostedExecutionBundlePayload {
  return readNullableStringValue(value, label);
}

export function parseHostedExecutionBundleRef(
  value: unknown,
  label = "Hosted execution bundle ref",
): HostedExecutionBundleRefState {
  return parseRuntimeHostedExecutionBundleRef(value, label);
}

export function parseHostedExecutionCursorSnapshotRef(
  value: unknown,
  label = "Hosted execution cursor snapshotRef",
): HostedExecutionBundleRefState {
  return parseHostedExecutionBundleRef(value === undefined ? null : value, label);
}

export function parseHostedExecutionEvent(value: unknown): HostedExecutionEvent {
  const record = requireObject(value, "Hosted execution event");
  const kind = requireString(record.kind, "Hosted execution event kind");
  const userId = requireString(record.userId, "Hosted execution event userId");

  switch (kind) {
    case "member.activated":
      return {
        ...(record.firstContact === undefined
          ? {}
          : {
              firstContact: record.firstContact === null
                ? null
                : parseHostedExecutionFirstContactTarget(record.firstContact),
            }),
        kind,
        memberChannels: parseHostedExecutionMemberChannels(
          record.memberChannels,
          "Hosted execution member.activated memberChannels",
        ),
        userId,
      };
    case "member.channels.updated":
      return {
        kind,
        memberChannels: parseHostedExecutionMemberChannels(
          record.memberChannels,
          "Hosted execution member.channels.updated memberChannels",
        ),
        userId,
      } satisfies HostedExecutionMemberChannelsUpdatedEvent;
    case "assistant.cron.tick":
      return {
        kind,
        reason: parseHostedExecutionCronReason(record.reason),
        userId,
      } satisfies HostedExecutionAssistantCronTickEvent;
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
    default:
      throw new TypeError(`Unsupported hosted execution event kind: ${kind}`);
  }
}

function parseHostedExecutionFirstContactTarget(
  value: unknown,
): HostedExecutionMemberActivatedEvent["firstContact"] {
  const record = requireObject(value, "Hosted execution member.activated firstContact");
  const kind = record.kind === undefined
    ? "thread"
    : requireString(record.kind, "Hosted execution member.activated firstContact kind");

  if (kind === "linq-materialize-home-thread") {
    const channel = requireString(
      record.channel,
      "Hosted execution member.activated firstContact channel",
    );

    if (channel !== "linq") {
      throw new TypeError(
        "Hosted execution member.activated firstContact kind linq-materialize-home-thread requires channel linq.",
      );
    }

    return {
      channel,
      fromPhoneNumber: requireString(
        record.fromPhoneNumber,
        "Hosted execution member.activated firstContact fromPhoneNumber",
      ),
      identityId: requireString(
        record.identityId,
        "Hosted execution member.activated firstContact identityId",
      ),
      kind,
      toPhoneNumber: requireString(
        record.toPhoneNumber,
        "Hosted execution member.activated firstContact toPhoneNumber",
      ),
    };
  }

  if (kind !== "thread") {
    throw new TypeError("Hosted execution member.activated firstContact kind is invalid.");
  }

  const channel = requireString(
    record.channel,
    "Hosted execution member.activated firstContact channel",
  );

  if (channel !== "email" && channel !== "linq" && channel !== "telegram") {
    throw new TypeError("Hosted execution member.activated firstContact channel is invalid.");
  }

  return {
    channel,
    identityId: record.identityId === null
      ? null
      : requireString(
          record.identityId,
          "Hosted execution member.activated firstContact identityId",
        ),
    ...(record.kind === undefined ? {} : { kind }),
    threadId: requireString(
      record.threadId,
      "Hosted execution member.activated firstContact threadId",
    ),
    threadIsDirect: requireBoolean(
      record.threadIsDirect,
      "Hosted execution member.activated firstContact threadIsDirect",
    ),
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

export function parseHostedExecutionSharePack(value: unknown): SharePack {
  return assertContract(sharePackSchema, value, "share pack");
}

export function parseHostedExecutionCursorState(
  value: unknown,
): HostedExecutionCursorState {
  const record = requireObject(value, "Hosted execution cursor state");

  return {
    committedSeq: requireBigIntString(
      record.committedSeq,
      "Hosted execution cursor state committedSeq",
    ),
    createdAt: requireString(record.createdAt, "Hosted execution cursor state createdAt"),
    nextSeq: requireBigIntString(record.nextSeq, "Hosted execution cursor state nextSeq"),
    ...(record.nextRuntimeWakeAt === undefined
      ? {}
      : {
          nextRuntimeWakeAt: readNullableString(
            record.nextRuntimeWakeAt,
            "Hosted execution cursor state nextRuntimeWakeAt",
          ),
        }),
    ...(record.nextRuntimeWakeReason === undefined
      ? {}
      : {
          nextRuntimeWakeReason: readNullableString(
            record.nextRuntimeWakeReason,
            "Hosted execution cursor state nextRuntimeWakeReason",
          ),
        }),
    snapshotRef: parseHostedExecutionCursorSnapshotRef(
      record.snapshotRef,
      "Hosted execution cursor state snapshotRef",
    ),
    updatedAt: requireString(record.updatedAt, "Hosted execution cursor state updatedAt"),
    userId: requireString(record.userId, "Hosted execution cursor state userId"),
    version: requireBigIntString(record.version, "Hosted execution cursor state version"),
  };
}

export function parseHostedRunAcquireRequest(value: unknown): HostedRunAcquireRequest {
  const record = requireObject(value, "Hosted run acquire request");

  return {
    ...(record.executorKind === undefined
      ? {}
      : {
          executorKind: record.executorKind === null
            ? null
            : parseHostedRunExecutorKind(record.executorKind),
        }),
    ...(record.executorCodeDigest === undefined
      ? {}
      : {
          executorCodeDigest: readNullableString(
            record.executorCodeDigest,
            "Hosted run acquire request executorCodeDigest",
          ),
        }),
    ...(record.attestationRef === undefined
      ? {}
      : {
          attestationRef: readNullableString(
            record.attestationRef,
            "Hosted run acquire request attestationRef",
          ),
        }),
    ...(record.signedResultRef === undefined
      ? {}
      : {
          signedResultRef: readNullableString(
            record.signedResultRef,
            "Hosted run acquire request signedResultRef",
          ),
        }),
    ...(record.limit === undefined
      ? {}
      : {
          limit: record.limit === null
            ? null
            : requireNumber(record.limit, "Hosted run acquire request limit"),
        }),
    ...(record.now === undefined
      ? {}
      : {
          now: readNullableString(record.now, "Hosted run acquire request now"),
        }),
    ...(record.triggerKind === undefined
      ? {}
      : {
          triggerKind: record.triggerKind === null
            ? null
            : parseHostedRunTriggerKind(record.triggerKind),
        }),
  };
}

export function parseHostedRunAcquireResponse(value: unknown): HostedRunAcquireResponse {
  const record = requireObject(value, "Hosted run acquire response");

  return {
    acquired: requireBoolean(record.acquired, "Hosted run acquire response acquired"),
    cursor: parseHostedExecutionCursorState(record.cursor),
    events: requireArray(record.events, "Hosted run acquire response events")
      .map((entry) => parseHostedIngressEvent(entry)),
    pendingWakeCount: requireNumber(
      record.pendingWakeCount,
      "Hosted run acquire response pendingWakeCount",
    ),
    resumeFinalize: requireBoolean(
      record.resumeFinalize,
      "Hosted run acquire response resumeFinalize",
    ),
    run: record.run === null ? null : parseHostedRunRecord(record.run),
    ...(record.runToken === undefined
      ? {}
      : {
          runToken: readNullableString(record.runToken, "Hosted run acquire response runToken"),
        }),
  };
}

export function parseHostedRunRecord(value: unknown): HostedRunRecord {
  const record = requireObject(value, "Hosted run record");

  return {
    acquiredAt: requireString(record.acquiredAt, "Hosted run record acquiredAt"),
    attempt: requireNumber(record.attempt, "Hosted run record attempt"),
    ...(record.committedAt === undefined
      ? {}
      : { committedAt: readNullableString(record.committedAt, "Hosted run record committedAt") }),
    createdAt: requireString(record.createdAt, "Hosted run record createdAt"),
    ...(record.errorClass === undefined
      ? {}
      : { errorClass: readNullableString(record.errorClass, "Hosted run record errorClass") }),
    ...(record.errorCode === undefined
      ? {}
      : { errorCode: readNullableString(record.errorCode, "Hosted run record errorCode") }),
    eventCount: requireNumber(record.eventCount, "Hosted run record eventCount"),
    eventKinds: requireStringArray(record.eventKinds, "Hosted run record eventKinds"),
    eventSeqs: requireStringArray(record.eventSeqs, "Hosted run record eventSeqs")
      .map((seq) => requireBigIntString(seq, "Hosted run record eventSeq")),
    executorKind: parseHostedRunExecutorKind(record.executorKind),
    ...(record.executorCodeDigest === undefined
      ? {}
      : { executorCodeDigest: readNullableString(record.executorCodeDigest, "Hosted run record executorCodeDigest") }),
    ...(record.attestationRef === undefined
      ? {}
      : { attestationRef: readNullableString(record.attestationRef, "Hosted run record attestationRef") }),
    ...(record.signedResultRef === undefined
      ? {}
      : { signedResultRef: readNullableString(record.signedResultRef, "Hosted run record signedResultRef") }),
    ...(record.failedAt === undefined
      ? {}
      : { failedAt: readNullableString(record.failedAt, "Hosted run record failedAt") }),
    ...(record.finalSnapshotRef === undefined
      ? {}
      : {
          finalSnapshotRef: parseHostedExecutionCursorSnapshotRef(
            record.finalSnapshotRef,
            "Hosted run record finalSnapshotRef",
          ),
        }),
    ...(record.finalizedAt === undefined
      ? {}
      : { finalizedAt: readNullableString(record.finalizedAt, "Hosted run record finalizedAt") }),
    id: requireString(record.id, "Hosted run record id"),
    inputCommittedSeq: requireBigIntString(
      record.inputCommittedSeq,
      "Hosted run record inputCommittedSeq",
    ),
    inputCursorVersion: requireBigIntString(
      record.inputCursorVersion,
      "Hosted run record inputCursorVersion",
    ),
    ...(record.inputSnapshotRef === undefined
      ? {}
      : {
          inputSnapshotRef: parseHostedExecutionCursorSnapshotRef(
            record.inputSnapshotRef,
            "Hosted run record inputSnapshotRef",
          ),
        }),
    ...(record.nextRuntimeWakeAt === undefined
      ? {}
      : {
          nextRuntimeWakeAt: readNullableString(
            record.nextRuntimeWakeAt,
            "Hosted run record nextRuntimeWakeAt",
          ),
        }),
    ...(record.nextRuntimeWakeReason === undefined
      ? {}
      : {
          nextRuntimeWakeReason: readNullableString(
            record.nextRuntimeWakeReason,
            "Hosted run record nextRuntimeWakeReason",
          ),
        }),
    ...(record.outputCommittedSeq === undefined
      ? {}
      : {
          outputCommittedSeq: readNullableBigIntString(
            record.outputCommittedSeq,
            "Hosted run record outputCommittedSeq",
          ),
        }),
    ...(record.outputCursorVersion === undefined
      ? {}
      : {
          outputCursorVersion: readNullableBigIntString(
            record.outputCursorVersion,
            "Hosted run record outputCursorVersion",
          ),
        }),
    ...(record.preparedAt === undefined
      ? {}
      : { preparedAt: readNullableString(record.preparedAt, "Hosted run record preparedAt") }),
    ...(record.preparedSnapshotRef === undefined
      ? {}
      : {
          preparedSnapshotRef: parseHostedExecutionCursorSnapshotRef(
            record.preparedSnapshotRef,
            "Hosted run record preparedSnapshotRef",
          ),
        }),
    ...(record.redactedSummary === undefined
      ? {}
      : { redactedSummary: record.redactedSummary ?? null }),
    ...(record.startedAt === undefined
      ? {}
      : { startedAt: readNullableString(record.startedAt, "Hosted run record startedAt") }),
    status: parseHostedRunStatus(record.status),
    triggerKind: parseHostedRunTriggerKind(record.triggerKind),
    updatedAt: requireString(record.updatedAt, "Hosted run record updatedAt"),
    userId: requireString(record.userId, "Hosted run record userId"),
    wakeIds: requireStringArray(record.wakeIds, "Hosted run record wakeIds"),
  };
}

export function parseHostedRunCommitRequest(value: unknown): HostedRunCommitRequest {
  const record = requireObject(value, "Hosted run commit request");

  return {
    ...(record.eventResults === undefined
      ? {}
      : {
          eventResults: requireArray(
            record.eventResults,
            "Hosted run commit request eventResults",
          ).map((entry, index) => parseHostedRunEventResult(
            entry,
            `Hosted run commit request eventResults[${index}]`,
          )),
        }),
    expectedCursorVersion: requireBigIntString(
      record.expectedCursorVersion,
      "Hosted run commit request expectedCursorVersion",
    ),
    ...(record.failureClass === undefined
      ? {}
      : {
          failureClass: readNullableString(
            record.failureClass,
            "Hosted run commit request failureClass",
          ),
        }),
    ...(record.failureCode === undefined
      ? {}
      : {
          failureCode: readNullableString(
            record.failureCode,
            "Hosted run commit request failureCode",
          ),
        }),
    ...(record.finalizeRequired === undefined
      ? {}
      : {
          finalizeRequired: record.finalizeRequired === null
            ? null
            : requireBoolean(record.finalizeRequired, "Hosted run commit request finalizeRequired"),
        }),
    ...(record.nextRuntimeWakeAt === undefined
      ? {}
      : {
          nextRuntimeWakeAt: readNullableString(
            record.nextRuntimeWakeAt,
            "Hosted run commit request nextRuntimeWakeAt",
          ),
        }),
    ...(record.nextRuntimeWakeReason === undefined
      ? {}
      : {
          nextRuntimeWakeReason: readNullableString(
            record.nextRuntimeWakeReason,
            "Hosted run commit request nextRuntimeWakeReason",
          ),
        }),
    outputCommittedSeq: requireBigIntString(
      record.outputCommittedSeq,
      "Hosted run commit request outputCommittedSeq",
    ),
    ...(record.preparedSnapshotRef === undefined
      ? {}
      : {
          preparedSnapshotRef: parseHostedExecutionCursorSnapshotRef(
            record.preparedSnapshotRef,
            "Hosted run commit request preparedSnapshotRef",
          ),
        }),
    ...(record.redactedSummary === undefined
      ? {}
      : { redactedSummary: record.redactedSummary ?? null }),
    runId: requireString(record.runId, "Hosted run commit request runId"),
    runToken: requireString(record.runToken, "Hosted run commit request runToken"),
  };
}

export function parseHostedRunCommitResponse(value: unknown): HostedRunCommitResponse {
  const record = requireObject(value, "Hosted run commit response");

  return {
    committed: requireBoolean(record.committed, "Hosted run commit response committed"),
    cursor: parseHostedExecutionCursorState(record.cursor),
    needsFinalize: requireBoolean(record.needsFinalize, "Hosted run commit response needsFinalize"),
    run: record.run === null ? null : parseHostedRunRecord(record.run),
  };
}

export function parseHostedRunFinalizeRequest(value: unknown): HostedRunFinalizeRequest {
  const record = requireObject(value, "Hosted run finalize request");

  return {
    finalSnapshotRef: parseHostedExecutionCursorSnapshotRef(
      record.finalSnapshotRef,
      "Hosted run finalize request finalSnapshotRef",
    ),
    ...(record.nextRuntimeWakeAt === undefined
      ? {}
      : {
          nextRuntimeWakeAt: readNullableString(
            record.nextRuntimeWakeAt,
            "Hosted run finalize request nextRuntimeWakeAt",
          ),
        }),
    ...(record.nextRuntimeWakeReason === undefined
      ? {}
      : {
          nextRuntimeWakeReason: readNullableString(
            record.nextRuntimeWakeReason,
            "Hosted run finalize request nextRuntimeWakeReason",
          ),
        }),
    ...(record.redactedSummary === undefined
      ? {}
      : { redactedSummary: record.redactedSummary ?? null }),
    runId: requireString(record.runId, "Hosted run finalize request runId"),
    runToken: requireString(record.runToken, "Hosted run finalize request runToken"),
  };
}

export function parseHostedRunFinalizeResponse(value: unknown): HostedRunFinalizeResponse {
  const record = requireObject(value, "Hosted run finalize response");

  return {
    cursor: parseHostedExecutionCursorState(record.cursor),
    finalized: requireBoolean(record.finalized, "Hosted run finalize response finalized"),
    run: record.run === null ? null : parseHostedRunRecord(record.run),
  };
}

export function parseHostedRunLogRequest(value: unknown): HostedRunLogRequest {
  const record = requireObject(value, "Hosted run log request");

  return {
    ...(record.at === undefined
      ? {}
      : { at: readNullableString(record.at, "Hosted run log request at") }),
    component: requireString(record.component, "Hosted run log request component"),
    level: parseHostedRunLogLevel(record.level),
    message: requireString(record.message, "Hosted run log request message"),
    phase: requireString(record.phase, "Hosted run log request phase"),
    ...(record.redacted === undefined ? {} : { redacted: record.redacted ?? null }),
    runId: requireString(record.runId, "Hosted run log request runId"),
    ...(record.runToken === undefined
      ? {}
      : { runToken: readNullableString(record.runToken, "Hosted run log request runToken") }),
  };
}

export function parseHostedRunLogResponse(value: unknown): HostedRunLogResponse {
  const record = requireObject(value, "Hosted run log response");

  return {
    logged: requireBoolean(record.logged, "Hosted run log response logged"),
    log: record.log === null ? null : parseHostedRunLogRecord(record.log),
  };
}

export function parseHostedRunLogRecord(value: unknown): HostedRunLogRecord {
  const record = requireObject(value, "Hosted run log record");

  return {
    at: requireString(record.at, "Hosted run log record at"),
    component: requireString(record.component, "Hosted run log record component"),
    createdAt: requireString(record.createdAt, "Hosted run log record createdAt"),
    id: requireString(record.id, "Hosted run log record id"),
    level: parseHostedRunLogLevel(record.level),
    message: requireString(record.message, "Hosted run log record message"),
    phase: requireString(record.phase, "Hosted run log record phase"),
    ...(record.redacted === undefined ? {} : { redacted: record.redacted ?? null }),
    runId: requireString(record.runId, "Hosted run log record runId"),
    userId: requireString(record.userId, "Hosted run log record userId"),
  };
}

export function parseHostedRunStatusRequest(value: unknown): HostedRunStatusRequest {
  const record = requireObject(value, "Hosted run status request");

  return {
    ...(record.includeLogs === undefined
      ? {}
      : {
          includeLogs: record.includeLogs === null
            ? null
            : requireBoolean(record.includeLogs, "Hosted run status request includeLogs"),
        }),
    ...(record.limit === undefined
      ? {}
      : {
          limit: record.limit === null
            ? null
            : requireNumber(record.limit, "Hosted run status request limit"),
        }),
    ...(record.runId === undefined
      ? {}
      : { runId: readNullableString(record.runId, "Hosted run status request runId") }),
  };
}

export function parseHostedRunStatusResponse(value: unknown): HostedRunStatusResponse {
  const record = requireObject(value, "Hosted run status response");

  return {
    cursor: parseHostedExecutionCursorState(record.cursor),
    ...(record.logs === undefined
      ? {}
      : {
          logs: requireArray(record.logs, "Hosted run status response logs")
            .map((entry) => parseHostedRunLogRecord(entry)),
        }),
    pendingWakeCount: requireNumber(
      record.pendingWakeCount,
      "Hosted run status response pendingWakeCount",
    ),
    run: record.run === null ? null : parseHostedRunRecord(record.run),
    ...(record.runs === undefined
      ? {}
      : {
          runs: requireArray(record.runs, "Hosted run status response runs")
            .map((entry) => parseHostedRunRecord(entry)),
        }),
  };
}

export function parseHostedIngressEvent(
  value: unknown,
): HostedIngressEvent {
  const record = requireObject(value, "Hosted wake record");
  const kind = parseHostedIngressKind(record.kind, "Hosted wake record kind");
  const payloadSchema = parseHostedIngressPayloadSchema(record.payloadSchema);
  const opaquePayloadTransport = readHostedWakeOpaquePayloadTransport(record);

  if (payloadSchema !== HOSTED_INGRESS_PAYLOAD_SCHEMA) {
    throw new TypeError(
      "Hosted wake record requires the execution payload schema.",
    );
  }

  return {
    behavior: parseHostedIngressBehavior(record.behavior),
    coalescingKey: readOptionalNullableString(
      record.coalescingKey,
      "Hosted wake record coalescingKey",
    ),
    createdAt: requireString(record.createdAt, "Hosted wake record createdAt"),
    dedupeKey: readOptionalNullableString(record.dedupeKey, "Hosted wake record dedupeKey"),
    id: requireString(record.id, "Hosted wake record id"),
    kind,
    occurredAt: requireString(record.occurredAt, "Hosted wake record occurredAt"),
    ...opaquePayloadTransport,
    payloadSchema,
    quarantineCode: readOptionalNullableString(
      record.quarantineCode,
      "Hosted wake record quarantineCode",
    ),
    quarantinedAt: readOptionalNullableString(
      record.quarantinedAt,
      "Hosted wake record quarantinedAt",
    ),
    seq: requireBigIntString(record.seq, "Hosted wake record seq"),
    updatedAt: requireString(record.updatedAt, "Hosted wake record updatedAt"),
    userId: requireString(record.userId, "Hosted wake record userId"),
  };
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

function readHostedWakeOpaquePayloadTransport(
  record: Record<string, unknown>,
): Pick<HostedIngressEvent, "payloadBytes" | "payloadCiphertext"> {
  return {
    ...(record.payloadBytes === undefined
      ? {}
      : {
          payloadBytes: readNullableNumber(
            record.payloadBytes,
            "Hosted wake record payloadBytes",
          ),
        }),
    ...(record.payloadCiphertext === undefined
      ? {}
      : {
          payloadCiphertext: readNullableString(
            record.payloadCiphertext,
            "Hosted wake record payloadCiphertext",
          ),
        }),
  };
}

export function parseHostedIngressAppendResponse(
  value: unknown,
): HostedIngressAppendResponse {
  const record = requireObject(value, "Hosted wake append response");

  return {
    duplicate: requireBoolean(record.duplicate, "Hosted wake append response duplicate"),
    inserted: requireBoolean(record.inserted, "Hosted wake append response inserted"),
    updatedExisting: requireBoolean(
      record.updatedExisting,
      "Hosted wake append response updatedExisting",
    ),
    wake: parseHostedIngressEvent(record.wake),
  };
}

function parseHostedIngressBehavior(value: unknown): HostedIngressBehavior {
  const behavior = requireString(value, "Hosted wake record behavior");

  if (HOSTED_INGRESS_BEHAVIORS.includes(behavior as HostedIngressBehavior)) {
    return behavior as HostedIngressBehavior;
  }

  throw new TypeError(`Unsupported hosted wake behavior: ${behavior}`);
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

function parseHostedIngressKind(
  value: unknown,
  label: string,
): HostedIngressKind {
  const kind = requireString(value, label);

  if (!isHostedIngressKind(kind)) {
    throw new TypeError(`${label} is invalid.`);
  }

  return kind;
}

function parseHostedIngressPayloadSchema(value: unknown): HostedIngressPayloadSchema {
  const schema = requireString(value, "Hosted wake record payloadSchema");

  if (HOSTED_INGRESS_PAYLOAD_SCHEMAS.includes(schema as HostedIngressPayloadSchema)) {
    return schema as HostedIngressPayloadSchema;
  }

  throw new TypeError(`Unsupported hosted wake payload schema: ${schema}`);
}

function parseHostedRunExecutorKind(value: unknown): HostedRunExecutorKind {
  const kind = requireString(value, "Hosted run executorKind");

  if (HOSTED_RUN_EXECUTOR_KINDS.includes(kind as HostedRunExecutorKind)) {
    return kind as HostedRunExecutorKind;
  }

  throw new TypeError(`Unsupported hosted run executorKind: ${kind}`);
}

function parseHostedRunTriggerKind(value: unknown): HostedRunTriggerKind {
  const kind = requireString(value, "Hosted run triggerKind");

  if (HOSTED_RUN_TRIGGER_KINDS.includes(kind as HostedRunTriggerKind)) {
    return kind as HostedRunTriggerKind;
  }

  throw new TypeError(`Unsupported hosted run triggerKind: ${kind}`);
}

function parseHostedRunStatus(value: unknown): HostedRunStatus {
  const status = requireString(value, "Hosted run status");

  if (HOSTED_RUN_STATUSES.includes(status as HostedRunStatus)) {
    return status as HostedRunStatus;
  }

  throw new TypeError(`Unsupported hosted run status: ${status}`);
}

function parseHostedRunLogLevel(value: unknown): HostedRunLogLevel {
  const level = requireString(value, "Hosted run log level");

  if (HOSTED_RUN_LOG_LEVELS.includes(level as HostedRunLogLevel)) {
    return level as HostedRunLogLevel;
  }

  throw new TypeError(`Unsupported hosted run log level: ${level}`);
}

function parseHostedRunEventResult(
  value: unknown,
  label: string,
): HostedRunEventResult {
  const record = requireObject(value, label);
  const state = requireString(record.state, `${label}.state`);

  if (state !== "completed" && state !== "quarantined") {
    throw new TypeError(`${label}.state must be completed or quarantined.`);
  }

  return {
    ...(record.quarantineCode === undefined
      ? {}
      : { quarantineCode: readNullableString(record.quarantineCode, `${label}.quarantineCode`) }),
    state,
    wakeId: requireString(record.wakeId, `${label}.wakeId`),
  };
}

function readNullableBigIntString(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }

  return requireBigIntString(value, label);
}

function requireBigIntString(value: unknown, label: string): string {
  const text = requireString(value, label);

  try {
    BigInt(text);
  } catch {
    throw new TypeError(`${label} must be a base-10 integer string.`);
  }

  return text;
}
