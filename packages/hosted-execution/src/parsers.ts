import {
  assertContract,
  sharePackSchema,
  type SharePack,
} from "@murphai/contracts";
import {
  parseHostedExecutionDeviceSyncRuntimeSnapshotResponse as parseOwnedHostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "@murphai/device-syncd/hosted-runtime";
import { parseHostedExecutionBundleRef as parseRuntimeHostedExecutionBundleRef } from "@murphai/runtime-state";

import {
  HOSTED_WAKE_CONVERSATION_MESSAGE_PAYLOAD_SCHEMA,
  HOSTED_WAKE_MESSAGE_PAYLOAD_SCHEMA,
  HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA,
  HOSTED_WAKE_BEHAVIORS,
  isHostedConversationMessageChannel,
  isHostedExecutionWakeKind,
  isHostedSystemWake,
} from "./contracts.ts";

import type {
  HostedExecutionAssistantCronTickEvent,
  HostedExecutionDispatchLifecycleState,
  HostedExecutionDispatchStatus,
  HostedExecutionMemberChannels,
  HostedExecutionMemberChannelsUpdatedEvent,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
  HostedExecutionDeviceSyncWakeEvent,
  HostedExecutionDispatchResult,
  HostedExecutionWake,
  HostedExecutionWakeAppendRequest,
  HostedWakeAppendRequest,
  HostedExecutionWakeKind,
  HostedExecutionEmailMessageReceivedEvent,
  HostedExecutionEvent,
  HostedExecutionConversationMessageWake,
  HostedExecutionCursorState,
  HostedExecutionMemberActivatedEvent,
  HostedExecutionTelegramMessageReceivedEvent,
  HostedExecutionRunnerRequest,
  HostedExecutionRunnerSharePack,
  HostedExecutionRunnerResult,
  HostedExecutionShareReference,
  HostedExecutionUserStatus,
  HostedExecutionVaultShareAcceptedEvent,
  HostedWakeBehavior,
  HostedWakeAppendResponse,
  HostedWakeCommitResponse,
  HostedWakeEmailMessageReceivedPayload,
  HostedWakeFetchResponse,
  HostedWakeLinqMessageReceivedPayload,
  HostedWakeQuarantineResponse,
  HostedWakeRecord,
  HostedWakeStatusResponse,
  HostedWakeTelegramMessageReceivedPayload,
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

export function parseHostedExecutionWake(value: unknown): HostedExecutionWake {
  const record = requireObject(value, "Hosted execution wake");
  const kind = parseHostedExecutionWakeKind(record.kind, "Hosted execution wake kind");
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

export function parseHostedWakeAppendRequest(value: unknown): HostedWakeAppendRequest {
  const record = requireObject(value, "Hosted wake append request");

  if (record.wake !== undefined) {
    return {
      wake: parseHostedExecutionWake(record.wake),
    };
  }

  throw new TypeError("Hosted wake append request must include wake.");
}

export function parseHostedWakeLinqMessageReceivedPayload(
  value: unknown,
): HostedWakeLinqMessageReceivedPayload {
  const record = requireObject(value, "Hosted wake Linq message payload");
  const channel = record.channel === undefined
    ? "linq"
    : requireHostedConversationMessageChannel(
        record.channel,
        "linq",
        "Hosted wake Linq message payload channel",
      );

  return {
    channel,
    eventId: requireString(record.eventId, "Hosted wake Linq message payload eventId"),
    linqEvent: requireObject(record.linqEvent, "Hosted wake Linq message payload linqEvent"),
    ...(record.linqMessageId === undefined
      ? {}
      : {
          linqMessageId: readOptionalNullableString(
            record.linqMessageId,
            "Hosted wake Linq message payload linqMessageId",
          ),
        }),
    phoneLookupKey: requireString(
      record.phoneLookupKey,
      "Hosted wake Linq message payload phoneLookupKey",
    ),
  };
}

export function parseHostedWakeTelegramMessageReceivedPayload(
  value: unknown,
): HostedWakeTelegramMessageReceivedPayload {
  const record = requireObject(value, "Hosted wake Telegram message payload");
  const channel = record.channel === undefined
    ? "telegram"
    : requireHostedConversationMessageChannel(
        record.channel,
        "telegram",
        "Hosted wake Telegram message payload channel",
      );

  return {
    channel,
    eventId: requireString(record.eventId, "Hosted wake Telegram message payload eventId"),
    telegramMessage: parseHostedExecutionTelegramMessage(record.telegramMessage),
  };
}

export function parseHostedWakeEmailMessageReceivedPayload(
  value: unknown,
): HostedWakeEmailMessageReceivedPayload {
  const record = requireObject(value, "Hosted wake email message payload");
  const channel = record.channel === undefined
    ? "email"
    : requireHostedConversationMessageChannel(
        record.channel,
        "email",
        "Hosted wake email message payload channel",
      );

  return {
    channel,
    eventId: requireString(record.eventId, "Hosted wake email message payload eventId"),
    identityId: readNullableStringValue(
      record.identityId,
      "Hosted wake email message payload identityId",
    ),
    rawMessageKey: requireString(
      record.rawMessageKey,
      "Hosted wake email message payload rawMessageKey",
    ),
    ...(record.selfAddress === undefined
      ? {}
      : {
          selfAddress: readOptionalNullableString(
            record.selfAddress,
            "Hosted wake email message payload selfAddress",
          ),
        }),
  };
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
        linqEvent: requireObject(
          record.linqEvent,
          "Hosted execution conversation.message wake payload linqEvent",
        ),
        ...(record.linqMessageId === undefined
          ? {}
          : {
              linqMessageId: readOptionalNullableString(
                record.linqMessageId,
                "Hosted execution conversation.message wake payload linqMessageId",
              ),
            }),
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

export function parseHostedExecutionRunnerRequest(value: unknown): HostedExecutionRunnerRequest {
  const record = requireObject(value, "Hosted execution runner request");
  const wake = record.wake === undefined
    ? null
    : parseHostedExecutionWake(record.wake);
  const sharePack = record.sharePack === undefined
    ? undefined
    : record.sharePack === null
      ? null
      : parseHostedExecutionRunnerSharePack(record.sharePack);

  if (!wake) {
    throw new TypeError("Hosted execution runner request must include wake.");
  }

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

  return {
    bundle: parseHostedExecutionBundlePayload(
      record.bundle,
      "Hosted execution runner request bundle",
    ),
    wake,
    ...(record.run === undefined ? {} : {
      run: record.run === null ? null : parseHostedExecutionRunContext(record.run),
    }),
    ...(sharePack === undefined ? {} : { sharePack }),
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

export function parseHostedExecutionDispatchResult(value: unknown): HostedExecutionDispatchResult {
  const record = requireObject(value, "Hosted execution dispatch result");

  return {
    event: parseHostedExecutionDispatchStatus(record.event),
    status: parseHostedExecutionUserStatus(record.status),
  };
}

export function parseHostedExecutionDispatchStatus(
  value: unknown,
): HostedExecutionDispatchStatus {
  const event = requireObject(value, "Hosted execution dispatch status");

  return {
    eventId: requireString(event.eventId, "Hosted execution dispatch status eventId"),
    lastError: readNullableString(
      event.lastError,
      "Hosted execution dispatch status lastError",
    ),
    state: parseHostedExecutionDispatchLifecycleState(event.state),
    userId: requireString(event.userId, "Hosted execution dispatch status userId"),
  };
}

export function parseHostedExecutionUserStatus(value: unknown): HostedExecutionUserStatus {
  const record = requireObject(value, "Hosted execution user status");

  return {
    backpressuredEventIds: readOptionalStringArray(
      record.backpressuredEventIds,
      "Hosted execution user status backpressuredEventIds",
    ),
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
    pendingEventCount: requireNumber(
      record.pendingEventCount,
      "Hosted execution user status pendingEventCount",
    ),
    poisonedEventIds: requireStringArray(
      record.poisonedEventIds,
      "Hosted execution user status poisonedEventIds",
    ),
    retryingEventId: readNullableString(
      record.retryingEventId,
      "Hosted execution user status retryingEventId",
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

export function parseHostedWakeStatusResponse(value: unknown): HostedWakeStatusResponse {
  const record = requireObject(value, "Hosted wake status response");

  return {
    cursor: parseHostedExecutionCursorState(record.cursor),
    ...(record.dispatchState === undefined ? {} : {
      dispatchState: record.dispatchState === null
        ? null
        : parseHostedExecutionDispatchLifecycleState(record.dispatchState),
    }),
    pendingWakeCount: requireNumber(record.pendingWakeCount, "Hosted wake status response pendingWakeCount"),
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
    case "linq.message.received":
      return {
        kind,
        linqEvent: requireObject(record.linqEvent, "Hosted execution Linq message linqEvent"),
        ...(record.linqMessageId === undefined
          ? {}
          : {
              linqMessageId: readOptionalNullableString(
                record.linqMessageId,
                "Hosted execution Linq message linqMessageId",
              ),
            }),
        phoneLookupKey: requireString(
          record.phoneLookupKey,
          "Hosted execution Linq message phoneLookupKey",
        ),
        userId,
      };
    case "telegram.message.received": {
      const event: HostedExecutionTelegramMessageReceivedEvent = {
        kind,
        telegramMessage: parseHostedExecutionTelegramMessage(record.telegramMessage),
        userId,
      };

      return event;
    }
    case "email.message.received":
      return {
        identityId: record.identityId === null
          ? null
          : readNullableStringValue(
              record.identityId,
              "Hosted execution email message identityId",
            ),
        kind,
        rawMessageKey: requireString(
          record.rawMessageKey,
          "Hosted execution email message rawMessageKey",
        ),
        ...(record.selfAddress === undefined
          ? {}
          : {
              selfAddress: readNullableString(
                record.selfAddress,
                "Hosted execution email message selfAddress",
              ),
            }),
        userId,
      } satisfies HostedExecutionEmailMessageReceivedEvent;
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

export function parseHostedExecutionDeviceSyncRuntimeSnapshotResponse(
  value: unknown,
): HostedExecutionDeviceSyncRuntimeSnapshotResponse {
  return parseOwnedHostedExecutionDeviceSyncRuntimeSnapshotResponse(value);
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
    snapshotRef: record.snapshotRef ?? null,
    updatedAt: requireString(record.updatedAt, "Hosted execution cursor state updatedAt"),
    userId: requireString(record.userId, "Hosted execution cursor state userId"),
    version: requireBigIntString(record.version, "Hosted execution cursor state version"),
  };
}

export function parseHostedWakeRecord(
  value: unknown,
): HostedWakeRecord {
  const record = requireObject(value, "Hosted wake record");

  return {
    behavior: parseHostedWakeBehavior(record.behavior),
    coalescingKey: readOptionalNullableString(
      record.coalescingKey,
      "Hosted wake record coalescingKey",
    ),
    createdAt: requireString(record.createdAt, "Hosted wake record createdAt"),
    dedupeKey: readOptionalNullableString(record.dedupeKey, "Hosted wake record dedupeKey"),
    id: requireString(record.id, "Hosted wake record id"),
    kind: requireString(record.kind, "Hosted wake record kind"),
    occurredAt: requireString(record.occurredAt, "Hosted wake record occurredAt"),
    ...(record.payloadJson === undefined ? {} : { payloadJson: record.payloadJson }),
    payloadSchema: requireString(record.payloadSchema, "Hosted wake record payloadSchema"),
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

export function parseHostedWakeExecutionPayload(input: {
  kind: string;
  occurredAt: string;
  payloadJson?: unknown;
  payloadSchema: string;
  userId: string;
}): HostedExecutionWake {
  switch (input.payloadSchema) {
    case HOSTED_WAKE_CONVERSATION_MESSAGE_PAYLOAD_SCHEMA: {
      if (input.kind !== "conversation.message") {
        throw new TypeError(
          "Hosted wake conversation payload schema requires conversation.message kind.",
        );
      }

      const payload = parseHostedExecutionConversationMessagePayload(input.payloadJson);
      return buildHostedExecutionConversationMessageWake({
        eventId: requireString(
          requireObject(input.payloadJson, "Hosted wake conversation payload").eventId,
          "Hosted wake conversation payload eventId",
        ),
        message: payload,
        occurredAt: input.occurredAt,
        userId: input.userId,
      });
    }
    case HOSTED_WAKE_MESSAGE_PAYLOAD_SCHEMA:
      if (input.kind !== "conversation.message") {
        throw new TypeError(
          "Hosted wake message payload schema requires conversation.message kind.",
        );
      }
      return parseHostedConversationMessagePayloadEnvelope(input);
    case HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA: {
      const wake = parseHostedExecutionWake(input.payloadJson);

      if (wake.userId !== input.userId) {
        throw new TypeError("Hosted wake payload userId must match the wake record.");
      }

      if (wake.kind !== input.kind) {
        throw new TypeError("Hosted wake payload kind must match the wake record.");
      }

      if (wake.occurredAt !== input.occurredAt) {
        throw new TypeError("Hosted wake payload occurredAt must match the wake record.");
      }

      if (!isHostedSystemWake(wake)) {
        throw new TypeError(
          "Hosted wake system payload schema cannot carry a conversation.message wake.",
        );
      }

      return wake;
    }
    default:
      throw new TypeError(`Unsupported hosted wake payload schema: ${input.payloadSchema}`);
  }
}

export function parseHostedWakeFetchResponse(
  value: unknown,
): HostedWakeFetchResponse {
  const record = requireObject(value, "Hosted wake fetch response");

  return {
    cursor: parseHostedExecutionCursorState(record.cursor),
    wakes: requireArray(record.wakes, "Hosted wake fetch response wakes")
      .map((entry) => parseHostedWakeRecord(entry)),
  };
}

export function parseHostedWakeCommitResponse(
  value: unknown,
): HostedWakeCommitResponse {
  const record = requireObject(value, "Hosted wake commit response");

  return {
    committed: requireBoolean(record.committed, "Hosted wake commit response committed"),
    cursor: parseHostedExecutionCursorState(record.cursor),
  };
}

export function parseHostedWakeAppendResponse(
  value: unknown,
): HostedWakeAppendResponse {
  const record = requireObject(value, "Hosted wake append response");

  return {
    duplicate: requireBoolean(record.duplicate, "Hosted wake append response duplicate"),
    inserted: requireBoolean(record.inserted, "Hosted wake append response inserted"),
    updatedExisting: requireBoolean(
      record.updatedExisting,
      "Hosted wake append response updatedExisting",
    ),
    wake: parseHostedWakeRecord(record.wake),
  };
}

export function parseHostedWakeQuarantineResponse(
  value: unknown,
): HostedWakeQuarantineResponse {
  const record = requireObject(value, "Hosted wake quarantine response");

  return {
    quarantined: requireBoolean(record.quarantined, "Hosted wake quarantine response quarantined"),
  };
}

function parseHostedWakeBehavior(value: unknown): HostedWakeBehavior {
  const behavior = requireString(value, "Hosted wake record behavior");

  if (HOSTED_WAKE_BEHAVIORS.includes(behavior as HostedWakeBehavior)) {
    return behavior as HostedWakeBehavior;
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

function requireHostedConversationMessageChannel<TExpected extends "email" | "linq" | "telegram">(
  value: unknown,
  expected: TExpected,
  label: string,
): TExpected {
  const channel = parseHostedConversationMessageChannel(value, label);
  if (channel !== expected) {
    throw new TypeError(`${label} must be ${expected}.`);
  }
  return expected;
}

function parseHostedExecutionWakeKind(
  value: unknown,
  label: string,
): HostedExecutionWakeKind {
  const kind = requireString(value, label);

  if (!isHostedExecutionWakeKind(kind)) {
    throw new TypeError(`${label} is invalid.`);
  }

  return kind;
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

function parseHostedExecutionDispatchLifecycleState(
  value: unknown,
): HostedExecutionDispatchLifecycleState {
  const state = requireString(value, "Hosted execution dispatch result event state");

  if (
    state === "queued"
    || state === "backpressured"
    || state === "completed"
    || state === "poisoned"
  ) {
    return state;
  }

  throw new TypeError(`Unsupported hosted execution dispatch lifecycle state: ${state}`);
}

function parseHostedConversationMessagePayloadEnvelope(input: {
  occurredAt: string;
  payloadJson?: unknown;
  userId: string;
}): HostedExecutionConversationMessageWake {
  const payload = requireObject(input.payloadJson, "Hosted wake conversation payload");

  return buildHostedExecutionConversationMessageWake({
    eventId: requireString(payload.eventId, "Hosted wake conversation payload eventId"),
    message: parseHostedExecutionConversationMessagePayload(payload),
    occurredAt: input.occurredAt,
    userId: input.userId,
  });
}
