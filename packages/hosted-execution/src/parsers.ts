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
  HOSTED_WAKE_PAYLOAD_SCHEMAS,
  HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA,
  HOSTED_WAKE_BEHAVIORS,
  isHostedConversationMessageChannel,
  isHostedExecutionWakeKind,
  isHostedSystemWake,
} from "./contracts.ts";

import type {
  HostedExecutionAssistantCronTickEvent,
  HostedExecutionMemberChannels,
  HostedExecutionMemberChannelsUpdatedEvent,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
  HostedExecutionDeviceSyncWakeEvent,
  HostedExecutionWake,
  HostedExecutionWakeAppendRequest,
  HostedWakeAppendRequest,
  HostedExecutionWakeKind,
  HostedExecutionEvent,
  HostedExecutionConversationMessageWake,
  HostedExecutionCursorState,
  HostedExecutionMemberActivatedEvent,
  HostedExecutionRunnerRequest,
  HostedExecutionRunnerSharePack,
  HostedExecutionRunnerResult,
  HostedExecutionShareReference,
  HostedExecutionUserStatus,
  HostedExecutionVaultShareAcceptedEvent,
  HostedWakeBehavior,
  HostedWakeAppendResponse,
  HostedWakeCommitResponse,
  HostedWakeExecutionResult,
  HostedWakeFetchResponse,
  HostedWakeLifecycleState,
  HostedWakePayloadSchema,
  HostedWakeQuarantineResponse,
  HostedWakeRecord,
  HostedWakeStatus,
  HostedWakeStatusResponse,
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

export function parseHostedWakeExecutionResult(value: unknown): HostedWakeExecutionResult {
  const record = requireObject(value, "Hosted wake execution result");

  return {
    event: parseHostedWakeStatus(record.event),
    status: parseHostedExecutionUserStatus(record.status),
  };
}

export function parseHostedWakeStatus(
  value: unknown,
): HostedWakeStatus {
  const event = requireObject(value, "Hosted wake status");

  return {
    eventId: requireString(event.eventId, "Hosted wake status eventId"),
    lastError: readNullableString(
      event.lastError,
      "Hosted wake status lastError",
    ),
    state: parseHostedWakeLifecycleState(event.state, {
      invalidStateMessage: "Unsupported hosted wake lifecycle state",
      label: "Hosted wake status state",
    }),
    userId: requireString(event.userId, "Hosted wake status userId"),
  };
}

export function parseHostedExecutionUserStatus(value: unknown): HostedExecutionUserStatus {
  const record = requireObject(value, "Hosted execution user status");
  assertNoLegacyHostedExecutionUserStatusFields(record);

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

  if (record.dispatchState !== undefined) {
    throw new TypeError(
      "Hosted wake status response dispatchState is no longer supported; use wakeState.",
    );
  }

  const parsedWakeState = record.wakeState === undefined
    ? undefined
    : record.wakeState === null
      ? null
      : parseHostedWakeLifecycleState(record.wakeState);

  return {
    cursor: parseHostedExecutionCursorState(record.cursor),
    ...(parsedWakeState === undefined ? {} : {
      wakeState: parsedWakeState,
    }),
    pendingWakeCount: requireNumber(record.pendingWakeCount, "Hosted wake status response pendingWakeCount"),
  };
}

function assertNoLegacyHostedExecutionUserStatusFields(
  record: Record<string, unknown>,
): void {
  const legacyField = [
    "backpressuredEventIds",
    "pendingEventCount",
    "poisonedEventIds",
    "retryingEventId",
  ].find((key) => record[key] !== undefined);

  if (!legacyField) {
    return;
  }

  throw new TypeError(
    `Hosted execution user status ${legacyField} is no longer supported; use wake-native status fields.`,
  );
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
  assertNoLegacyHostedWakePayloadFields(record);
  const kind = parseHostedExecutionWakeKind(record.kind, "Hosted wake record kind");
  const payloadSchema = parseHostedWakePayloadSchema(record.payloadSchema);
  const opaquePayloadTransport = readHostedWakeOpaquePayloadTransport(record);

  if (kind === "conversation.message") {
    if (payloadSchema !== HOSTED_WAKE_CONVERSATION_MESSAGE_PAYLOAD_SCHEMA) {
      throw new TypeError(
        "Hosted wake record conversation.message kind requires the conversation payload schema.",
      );
    }
    return {
      behavior: parseHostedWakeBehavior(record.behavior),
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

  if (payloadSchema !== HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA) {
    throw new TypeError(
      "Hosted wake record system kinds require the system payload schema.",
    );
  }

  return {
    behavior: parseHostedWakeBehavior(record.behavior),
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

export function parseHostedWakeExecutionPayload(input: {
  decryptedPayload?: unknown;
  kind: HostedExecutionWakeKind;
  occurredAt: string;
  payloadSchema: HostedWakePayloadSchema;
  userId: string;
}): HostedExecutionWake {
  switch (input.payloadSchema) {
    case HOSTED_WAKE_CONVERSATION_MESSAGE_PAYLOAD_SCHEMA: {
      if (input.kind !== "conversation.message") {
        throw new TypeError(
          "Hosted wake conversation payload schema requires conversation.message kind.",
        );
      }

      const payload = parseHostedExecutionConversationMessagePayload(input.decryptedPayload);
      return buildHostedExecutionConversationMessageWake({
        eventId: requireString(
          requireObject(input.decryptedPayload, "Hosted wake conversation payload").eventId,
          "Hosted wake conversation payload eventId",
        ),
        message: payload,
        occurredAt: input.occurredAt,
        userId: input.userId,
      });
    }
    case HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA: {
      const wake = parseHostedExecutionWake(input.decryptedPayload);

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
  }
}

function readHostedWakeOpaquePayloadTransport(
  record: Record<string, unknown>,
): Pick<HostedWakeRecord, "payloadBytes" | "payloadCiphertext"> {
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

function assertNoLegacyHostedWakePayloadFields(record: Record<string, unknown>): void {
  const legacyField = [
    "payloadJson",
    "payloadInlineCiphertext",
    "payloadRef",
    "payloadRefCiphertext",
  ].find((field) => field in record);

  if (!legacyField) {
    return;
  }

  throw new TypeError(
    `Hosted wake record must not include legacy fetched payload field ${legacyField}.`,
  );
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

function parseHostedWakePayloadSchema(value: unknown): HostedWakePayloadSchema {
  const schema = requireString(value, "Hosted wake record payloadSchema");

  if (HOSTED_WAKE_PAYLOAD_SCHEMAS.includes(schema as HostedWakePayloadSchema)) {
    return schema as HostedWakePayloadSchema;
  }

  throw new TypeError(`Unsupported hosted wake payload schema: ${schema}`);
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

function parseHostedWakeLifecycleState(
  value: unknown,
  options?: {
    invalidStateMessage?: string;
    label?: string;
  },
): HostedWakeLifecycleState {
  const state = requireString(
    value,
    options?.label ?? "Hosted wake lifecycle state",
  );

  if (
    state === "queued"
    || state === "backpressured"
    || state === "completed"
    || state === "poisoned"
  ) {
    return state;
  }

  throw new TypeError(
    `${options?.invalidStateMessage ?? "Unsupported hosted wake lifecycle state"}: ${state}`,
  );
}

function parseHostedConversationMessagePayloadEnvelope(input: {
  decryptedPayload?: unknown;
  occurredAt: string;
  userId: string;
}): HostedExecutionConversationMessageWake {
  const payload = requireObject(input.decryptedPayload, "Hosted wake conversation payload");

  return buildHostedExecutionConversationMessageWake({
    eventId: requireString(payload.eventId, "Hosted wake conversation payload eventId"),
    message: parseHostedExecutionConversationMessagePayload(payload),
    occurredAt: input.occurredAt,
    userId: input.userId,
  });
}
