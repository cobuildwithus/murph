import {
  assertContract,
  sharePackSchema,
  type SharePack,
} from "@murphai/contracts";
import {
  parseHostedExecutionDeviceSyncRuntimeSnapshotResponse as parseOwnedHostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "@murphai/device-syncd/hosted-runtime";
import { parseHostedExecutionBundleRef as parseRuntimeHostedExecutionBundleRef } from "@murphai/runtime-state";

import type {
  HostedExecutionAssistantCronTickEvent,
  HostedExecutionEventDispatchStatus,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
  HostedExecutionDeviceSyncWakeEvent,
  HostedExecutionDispatchResult,
  HostedExecutionDispatchRequest,
  HostedExecutionEmailMessageReceivedEvent,
  HostedExecutionEvent,
  HostedExecutionGatewayMessageSendEvent,
  HostedExecutionMemberActivatedEvent,
  HostedExecutionTelegramMessageReceivedEvent,
  HostedExecutionEventDispatchState,
  HostedExecutionRunnerRequest,
  HostedExecutionRunnerSharePack,
  HostedExecutionRunnerResult,
  HostedExecutionShareReference,
  HostedExecutionUserStatus,
  HostedExecutionVaultShareAcceptedEvent,
} from "./contracts.ts";
import {
  type HostedExecutionBundlePayload,
  type HostedExecutionBundleRefState,
} from "./bundles.ts";
import {
  readHostedExecutionOutboxPayload,
  type HostedExecutionOutboxPayload,
} from "./outbox-payload.ts";
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

export function parseHostedExecutionDispatchRequest(value: unknown): HostedExecutionDispatchRequest {
  const record = requireObject(value, "Hosted execution dispatch request");

  return {
    event: parseHostedExecutionEvent(record.event),
    eventId: requireString(record.eventId, "Hosted execution dispatch request eventId"),
    occurredAt: requireString(record.occurredAt, "Hosted execution dispatch request occurredAt"),
  };
}

export function parseHostedExecutionOutboxPayload(value: unknown): HostedExecutionOutboxPayload {
  const payload = readHostedExecutionOutboxPayload(value);

  if (!payload) {
    throw new TypeError("Hosted execution outbox payload is invalid.");
  }

  return payload;
}

export function parseHostedExecutionRunnerRequest(value: unknown): HostedExecutionRunnerRequest {
  const record = requireObject(value, "Hosted execution runner request");
  const dispatch = parseHostedExecutionDispatchRequest(record.dispatch);
  const sharePack = record.sharePack === undefined
    ? undefined
    : record.sharePack === null
      ? null
      : parseHostedExecutionRunnerSharePack(record.sharePack);

  if (dispatch.event.kind === "vault.share.accepted") {
    if (!sharePack) {
      throw new TypeError(
        "Hosted execution runner request.sharePack is required for vault.share.accepted events.",
      );
    }

    if (sharePack.ownerUserId !== dispatch.event.share.ownerUserId) {
      throw new TypeError(
        "Hosted execution runner request.sharePack ownerUserId must match dispatch.event.share.ownerUserId.",
      );
    }

    if (sharePack.shareId !== dispatch.event.share.shareId) {
      throw new TypeError(
        "Hosted execution runner request.sharePack shareId must match dispatch.event.share.shareId.",
      );
    }
  } else if (sharePack !== undefined) {
    throw new TypeError(
      "Hosted execution runner request.sharePack is only supported for vault.share.accepted events.",
    );
  }

  return {
    bundle: parseHostedExecutionBundlePayload(
      record.bundle,
      "Hosted execution runner request bundle",
    ),
    dispatch,
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
    event: parseHostedExecutionEventDispatchStatus(record.event),
    status: parseHostedExecutionUserStatus(record.status),
  };
}

export function parseHostedExecutionEventDispatchStatus(
  value: unknown,
): HostedExecutionEventDispatchStatus {
  const event = requireObject(value, "Hosted execution dispatch status");

  return {
    eventId: requireString(event.eventId, "Hosted execution dispatch status eventId"),
    lastError: readNullableString(
      event.lastError,
      "Hosted execution dispatch status lastError",
    ),
    state: parseHostedExecutionEventDispatchState(event.state),
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
        userId,
      };
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
        identityId: requireString(record.identityId, "Hosted execution email message identityId"),
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
        ...(record.runtimeSnapshot === undefined
          ? {}
          : {
              runtimeSnapshot: record.runtimeSnapshot === null
                ? null
                : parseHostedExecutionDeviceSyncRuntimeSnapshotResponse(record.runtimeSnapshot),
            }),
        userId,
      } satisfies HostedExecutionDeviceSyncWakeEvent;
    case "vault.share.accepted":
      return {
        kind,
        share: parseHostedExecutionShareReference(record.share),
        userId,
      } satisfies HostedExecutionVaultShareAcceptedEvent;
    case "gateway.message.send":
      return {
        kind,
        clientRequestId: readNullableString(
          record.clientRequestId,
          "Hosted execution gateway.message.send clientRequestId",
        ),
        replyToMessageId: readNullableString(
          record.replyToMessageId,
          "Hosted execution gateway.message.send replyToMessageId",
        ),
        sessionKey: requireString(
          record.sessionKey,
          "Hosted execution gateway.message.send sessionKey",
        ),
        text: requireString(record.text, "Hosted execution gateway.message.send text"),
        userId,
      } satisfies HostedExecutionGatewayMessageSendEvent;
    default:
      throw new TypeError(`Unsupported hosted execution event kind: ${kind}`);
  }
}

function parseHostedExecutionFirstContactTarget(
  value: unknown,
): HostedExecutionMemberActivatedEvent["firstContact"] {
  const record = requireObject(value, "Hosted execution member.activated firstContact");
  const channel = requireString(
    record.channel,
    "Hosted execution member.activated firstContact channel",
  );

  if (channel !== "email" && channel !== "linq" && channel !== "telegram") {
    throw new TypeError("Hosted execution member.activated firstContact channel is invalid.");
  }

  return {
    channel,
    identityId: requireString(
      record.identityId,
      "Hosted execution member.activated firstContact identityId",
    ),
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

function parseHostedExecutionEventDispatchState(
  value: unknown,
): HostedExecutionEventDispatchState {
  const state = requireString(value, "Hosted execution dispatch result event state");

  if (
    state === "queued"
    || state === "duplicate_pending"
    || state === "duplicate_consumed"
    || state === "backpressured"
    || state === "completed"
    || state === "poisoned"
  ) {
    return state;
  }

  throw new TypeError(`Unsupported hosted execution event dispatch state: ${state}`);
}
