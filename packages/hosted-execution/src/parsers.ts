import { assertContract, sharePackSchema } from "@murphai/contracts";
import { parseHostedExecutionDeviceSyncRuntimeSnapshotResponse as parseOwnedHostedExecutionDeviceSyncRuntimeSnapshotResponse } from "@murphai/device-syncd/hosted-runtime";
import { parseHostedExecutionBundleRef as parseRuntimeHostedExecutionBundleRef } from "@murphai/runtime-state";

import type {
  HostedExecutionAssistantCronTickEvent,
  HostedExecutionBundleRef,
  HostedExecutionDeviceSyncJobHint,
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
import type { SharePack } from "@murphai/contracts";

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
        reason: parseCronReason(record.reason),
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
        reason: parseDeviceSyncReason(record.reason),
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

function parseHostedExecutionDeviceSyncWakeHint(
  value: unknown,
): HostedExecutionDeviceSyncWakeEvent["hint"] {
  if (value === null) {
    return null;
  }

  const record = requireObject(value, "Hosted execution device-sync.wake hint");
  const jobsValue = record.jobs;

  return {
    ...(record.eventType === undefined
      ? {}
      : {
          eventType: readNullableString(
            record.eventType,
            "Hosted execution device-sync.wake hint eventType",
          ),
        }),
    ...(jobsValue === undefined
      ? {}
      : {
          jobs: requireArray(
            jobsValue,
            "Hosted execution device-sync.wake hint jobs",
          ).map((entry, index) => parseHostedExecutionDeviceSyncJobHint(entry, index)),
        }),
    ...(record.nextReconcileAt === undefined
      ? {}
      : {
          nextReconcileAt: readNullableString(
            record.nextReconcileAt,
            "Hosted execution device-sync.wake hint nextReconcileAt",
          ),
        }),
    ...(record.occurredAt === undefined
      ? {}
      : {
          occurredAt: readNullableString(
            record.occurredAt,
            "Hosted execution device-sync.wake hint occurredAt",
          ),
        }),
    ...(record.reason === undefined
      ? {}
      : {
          reason: readNullableString(
            record.reason,
            "Hosted execution device-sync.wake hint reason",
          ),
        }),
    ...(record.resourceCategory === undefined
      ? {}
      : {
          resourceCategory: readNullableString(
            record.resourceCategory,
            "Hosted execution device-sync.wake hint resourceCategory",
          ),
        }),
    ...(record.revokeWarning === undefined
      ? {}
      : {
          revokeWarning: parseHostedExecutionDeviceSyncRevokeWarning(record.revokeWarning),
        }),
    ...(record.scopes === undefined
      ? {}
      : {
          scopes: requireStringArray(
            record.scopes,
            "Hosted execution device-sync.wake hint scopes",
          ),
        }),
    ...(record.traceId === undefined
      ? {}
      : {
          traceId: readNullableString(
            record.traceId,
            "Hosted execution device-sync.wake hint traceId",
          ),
        }),
  };
}

function parseHostedExecutionDeviceSyncJobHint(
  value: unknown,
  index: number,
): HostedExecutionDeviceSyncJobHint {
  const record = requireObject(
    value,
    `Hosted execution device-sync.wake hint jobs[${index}]`,
  );

  return {
    ...(record.availableAt === undefined
      ? {}
      : {
          availableAt: requireString(
            record.availableAt,
            `Hosted execution device-sync.wake hint jobs[${index}].availableAt`,
          ),
        }),
    ...(record.dedupeKey === undefined
      ? {}
      : {
          dedupeKey: readNullableString(
            record.dedupeKey,
            `Hosted execution device-sync.wake hint jobs[${index}].dedupeKey`,
          ),
        }),
    kind: requireString(
      record.kind,
      `Hosted execution device-sync.wake hint jobs[${index}].kind`,
    ),
    ...(record.maxAttempts === undefined
      ? {}
      : {
          maxAttempts: requireNumber(
            record.maxAttempts,
            `Hosted execution device-sync.wake hint jobs[${index}].maxAttempts`,
          ),
        }),
    ...(record.payload === undefined
      ? {}
      : {
          payload: requireObject(
            record.payload,
            `Hosted execution device-sync.wake hint jobs[${index}].payload`,
          ),
        }),
    ...(record.priority === undefined
      ? {}
      : {
          priority: requireNumber(
            record.priority,
            `Hosted execution device-sync.wake hint jobs[${index}].priority`,
          ),
        }),
  } satisfies HostedExecutionDeviceSyncJobHint;
}

function parseHostedExecutionDeviceSyncRevokeWarning(
  value: unknown,
): NonNullable<HostedExecutionDeviceSyncWakeEvent["hint"]>["revokeWarning"] {
  if (value === null) {
    return null;
  }

  const record = requireObject(value, "Hosted execution device-sync.wake hint revokeWarning");

  return {
    code: requireString(
      record.code,
      "Hosted execution device-sync.wake hint revokeWarning.code",
    ),
    message: requireString(
      record.message,
      "Hosted execution device-sync.wake hint revokeWarning.message",
    ),
  };
}

function parseCronReason(value: unknown): HostedExecutionAssistantCronTickEvent["reason"] {
  const reason = requireString(value, "Hosted execution assistant.cron.tick reason");

  if (reason === "alarm" || reason === "manual" || reason === "device-sync") {
    return reason;
  }

  throw new TypeError(`Unsupported hosted execution assistant.cron.tick reason: ${reason}`);
}

function parseDeviceSyncReason(
  value: unknown,
): Extract<HostedExecutionEvent, { kind: "device-sync.wake" }>["reason"] {
  const reason = requireString(value, "Hosted execution device-sync.wake reason");

  if (
    reason === "connected"
    || reason === "webhook_hint"
    || reason === "disconnected"
    || reason === "reauthorization_required"
  ) {
    return reason;
  }

  throw new TypeError(`Unsupported hosted execution device-sync.wake reason: ${reason}`);
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

const ISO_8601_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return value;
}

function requirePositiveInteger(value: unknown, label: string): number {
  const parsed = requireNumber(value, label);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new TypeError(`${label} must be a positive integer.`);
  }

  return parsed;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }

  return value;
}

function readNullableString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requireString(value, label);
}

function readNullableStringValue(value: unknown, label: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string or null.`);
  }

  return value;
}

function parseHostedExecutionTelegramMessage(
  value: unknown,
): HostedExecutionTelegramMessageReceivedEvent["telegramMessage"] {
  const record = requireObject(value, "Hosted execution Telegram message telegramMessage");
  const attachmentsValue = record.attachments;

  return {
    ...(attachmentsValue === undefined
      ? {}
      : {
          attachments: requireArray(
            attachmentsValue,
            "Hosted execution Telegram message telegramMessage.attachments",
          ).map((entry, index) =>
            parseHostedExecutionTelegramAttachment(
              entry,
              `Hosted execution Telegram message telegramMessage.attachments[${index}]`,
            ),
          ),
        }),
    ...(record.mediaGroupId === undefined
      ? {}
      : {
          mediaGroupId: readNullableStringValue(
            record.mediaGroupId,
            "Hosted execution Telegram message telegramMessage.mediaGroupId",
          ),
        }),
    messageId: requireString(
      record.messageId,
      "Hosted execution Telegram message telegramMessage.messageId",
    ),
    schema: parseHostedExecutionTelegramMessageSchema(record.schema),
    ...(record.text === undefined
      ? {}
      : {
          text: readNullableStringValue(
            record.text,
            "Hosted execution Telegram message telegramMessage.text",
          ),
        }),
    threadId: requireString(
      record.threadId,
      "Hosted execution Telegram message telegramMessage.threadId",
    ),
  };
}

function parseHostedExecutionTelegramAttachment(
  value: unknown,
  label: string,
): NonNullable<HostedExecutionTelegramMessageReceivedEvent["telegramMessage"]["attachments"]>[number] {
  const record = requireObject(value, label);

  return {
    fileId: requireString(record.fileId, `${label}.fileId`),
    ...(record.fileName === undefined
      ? {}
      : {
          fileName: readNullableStringValue(record.fileName, `${label}.fileName`),
        }),
    ...(record.fileSize === undefined
      ? {}
      : {
          fileSize: readNullableNumber(record.fileSize, `${label}.fileSize`),
        }),
    ...(record.fileUniqueId === undefined
      ? {}
      : {
          fileUniqueId: readNullableStringValue(record.fileUniqueId, `${label}.fileUniqueId`),
        }),
    ...(record.height === undefined
      ? {}
      : {
          height: readNullableNumber(record.height, `${label}.height`),
        }),
    kind: parseHostedExecutionTelegramAttachmentKind(record.kind, `${label}.kind`),
    ...(record.mimeType === undefined
      ? {}
      : {
          mimeType: readNullableStringValue(record.mimeType, `${label}.mimeType`),
        }),
    ...(record.width === undefined
      ? {}
      : {
          width: readNullableNumber(record.width, `${label}.width`),
        }),
  };
}

function parseHostedExecutionTelegramAttachmentKind(
  value: unknown,
  label: string,
): NonNullable<HostedExecutionTelegramMessageReceivedEvent["telegramMessage"]["attachments"]>[number]["kind"] {
  const kind = requireString(value, label);

  if (
    kind === "animation"
    || kind === "audio"
    || kind === "document"
    || kind === "photo"
    || kind === "sticker"
    || kind === "video"
    || kind === "video_note"
    || kind === "voice"
  ) {
    return kind;
  }

  throw new TypeError(`${label} must be a supported hosted Telegram attachment kind.`);
}

function parseHostedExecutionTelegramMessageSchema(
  value: unknown,
): HostedExecutionTelegramMessageReceivedEvent["telegramMessage"]["schema"] {
  const schema = requireString(value, "Hosted execution Telegram message telegramMessage.schema");

  if (schema === "murph.hosted-telegram-message.v1") {
    return schema;
  }

  throw new TypeError("Hosted execution Telegram message telegramMessage.schema is unsupported.");
}

function readNullableNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requireNumber(value, label);
}

function readOptionalNullableString(value: unknown, label: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  return readNullableString(value, label);
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((entry, index) => requireString(entry, `${label}[${index}]`));
}

function readOptionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireStringArray(value, label);
}

function requireIsoTimestamp(value: unknown, label: string): string {
  const candidate = requireString(value, label);

  if (!ISO_8601_TIMESTAMP_PATTERN.test(candidate)) {
    throw new TypeError(`${label} must be an ISO-8601 timestamp.`);
  }

  const parsed = Date.parse(candidate);

  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${label} must be an ISO-8601 timestamp.`);
  }

  return new Date(parsed).toISOString();
}
