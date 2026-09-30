import {
  isHostedAssistantProvider,
} from "../assistant-model.ts";
import {
  requireHostedInferenceRevision,
} from "../assistant-inference.ts";
import {
  HOSTED_MAILBOX_FETCH_CURSOR_MODES,
  HOSTED_MAILBOX_KINDS,
  HOSTED_MAILBOX_LANES,
  type HostedMailboxFetchRequest,
  type HostedMailboxFetchResponse,
  type HostedMailboxItem,
  type HostedMailboxKind,
  type HostedMailboxLane,
  type HostedMailboxLaneCursor,
  type HostedMailboxLaneConsumed,
  type HostedMailboxLaneHighWater,
} from "../runtime-control.ts";
import {
  parseAllowedString,
  requireArray,
  requireNonNegativeBigIntString,
  requireNonNegativeInteger,
  requirePositiveInteger,
  requireObject,
  requireString,
  readNullableString,
} from "./assertions.ts";

export function parseHostedMailboxItem(value: unknown): HostedMailboxItem {
  const record = requireObject(value, "Hosted mailbox item");

  return {
    ...(record.causalSeq === undefined
      ? // Legacy-v1 mailbox payloads predate causal tokens. Normalize that
        // compatibility case once at the wire boundary; active rows use an
        // explicit sequence or null and must never inherit the legacy anchor.
        { causalSeq: "0" }
      : {
          causalSeq:
            record.causalSeq === null
              ? null
              : requireNonNegativeBigIntString(
                  record.causalSeq,
                  "Hosted mailbox item causalSeq",
                ),
        }),
    ...(record.consumedAt === undefined
      ? {}
      : {
          consumedAt: readNullableString(
            record.consumedAt,
            "Hosted mailbox item consumedAt",
          ),
        }),
    createdAt: requireString(record.createdAt, "Hosted mailbox item createdAt"),
    dedupeKey: requireString(record.dedupeKey, "Hosted mailbox item dedupeKey"),
    ...(record.expiresAt === undefined
      ? {}
      : {
          expiresAt: readNullableString(
            record.expiresAt,
            "Hosted mailbox item expiresAt",
          ),
        }),
    id: requireString(record.id, "Hosted mailbox item id"),
    kind: parseHostedMailboxKind(record.kind),
    lane: parseHostedMailboxLane(record.lane),
    laneSeq: requireNonNegativeBigIntString(
      record.laneSeq,
      "Hosted mailbox item laneSeq",
    ),
    occurredAt: requireString(
      record.occurredAt,
      "Hosted mailbox item occurredAt",
    ),
    ...(record.payloadBytes === undefined
      ? {}
      : {
          payloadBytes:
            record.payloadBytes === null
              ? null
              : requireNonNegativeInteger(
                  record.payloadBytes,
                  "Hosted mailbox item payloadBytes",
                ),
        }),
    ...(record.payloadInlineCiphertext === undefined
      ? {}
      : {
          payloadInlineCiphertext: readNullableString(
            record.payloadInlineCiphertext,
            "Hosted mailbox item payloadInlineCiphertext",
          ),
        }),
    ...(record.payloadRef === undefined
      ? {}
      : {
          payloadRef: readNullableString(
            record.payloadRef,
            "Hosted mailbox item payloadRef",
          ),
        }),
    payloadSchema: requireString(
      record.payloadSchema,
      "Hosted mailbox item payloadSchema",
    ),
    updatedAt: requireString(record.updatedAt, "Hosted mailbox item updatedAt"),
    userId: requireString(record.userId, "Hosted mailbox item userId"),
  };
}

export function parseHostedMailboxFetchRequest(
  value: unknown,
): HostedMailboxFetchRequest {
  const record = requireObject(value, "Hosted mailbox fetch request");

  return {
    ...(record.cursorMode === undefined || record.cursorMode === null
      ? {}
      : {
          cursorMode: parseAllowedString(
            record.cursorMode,
            "Hosted mailbox fetch request cursorMode",
            HOSTED_MAILBOX_FETCH_CURSOR_MODES,
          ),
        }),
    lanes: requireArray(record.lanes, "Hosted mailbox fetch request lanes").map(
      (entry, index) =>
        parseHostedMailboxLaneCursor(
          entry,
          `Hosted mailbox fetch request lanes[${index}]`,
        ),
    ),
    limitPerLane: requirePositiveInteger(
      record.limitPerLane,
      "Hosted mailbox fetch request limitPerLane",
    ),
    requestId: requireString(
      record.requestId,
      "Hosted mailbox fetch request requestId",
    ),
  };
}

export function parseHostedMailboxFetchResponse(
  value: unknown,
): HostedMailboxFetchResponse {
  const record = requireObject(value, "Hosted mailbox fetch response");
  if (!isHostedAssistantProvider(record.assistantProvider)) {
    throw new TypeError("Hosted mailbox fetch response assistantProvider is invalid.");
  }

  return {
    assistantProvider: record.assistantProvider,
    ...(record.assistantCustomInferenceRevision === undefined ? {} : {
      assistantCustomInferenceRevision: record.assistantCustomInferenceRevision === null
        ? null
        : requireHostedInferenceRevision(record.assistantCustomInferenceRevision),
    }),
    ...(record.conversationUsageStatus === undefined
      ? {}
      : {
          conversationUsageStatus: parseHostedMailboxConversationUsageStatus(
            record.conversationUsageStatus,
          ),
        }),
    ...(record.groupRunningBit === undefined
      ? {}
      : {
          groupRunningBit:
            record.groupRunningBit === null
              ? null
              : parseHostedGroupRunningBitProjection(record.groupRunningBit),
        }),
    ...(record.consumedSeqByLane === undefined ||
    record.consumedSeqByLane === null
      ? {}
      : {
          consumedSeqByLane: requireArray(
            record.consumedSeqByLane,
            "Hosted mailbox fetch response consumedSeqByLane",
          ).map((entry, index) =>
            parseHostedMailboxLaneConsumed(
              entry,
              `Hosted mailbox fetch response consumedSeqByLane[${index}]`,
            ),
          ),
        }),
    fetchedAt: requireString(
      record.fetchedAt,
      "Hosted mailbox fetch response fetchedAt",
    ),
    items: requireArray(
      record.items,
      "Hosted mailbox fetch response items",
    ).map((entry) => parseHostedMailboxItem(entry)),
    maxSeqByLane: requireArray(
      record.maxSeqByLane,
      "Hosted mailbox fetch response maxSeqByLane",
    ).map((entry, index) =>
      parseHostedMailboxLaneHighWater(
        entry,
        `Hosted mailbox fetch response maxSeqByLane[${index}]`,
      ),
    ),
    userId: requireString(
      record.userId,
      "Hosted mailbox fetch response userId",
    ),
  };
}

function parseHostedGroupRunningBitProjection(
  value: unknown,
): NonNullable<HostedMailboxFetchResponse["groupRunningBit"]> {
  const record = requireObject(
    value,
    "Hosted mailbox fetch response groupRunningBit",
  );
  const allowedKeys = new Set([
    "expiresAt",
    "publicAlias",
    "requestedBit",
    "schema",
  ]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new TypeError(
      "Hosted mailbox fetch response groupRunningBit contains unknown fields.",
    );
  }
  if (record.schema !== "murph.group-sponsorship-bit.v1") {
    throw new TypeError(
      "Hosted mailbox fetch response groupRunningBit schema is invalid.",
    );
  }
  const expiresAt = requireString(
    record.expiresAt,
    "Hosted mailbox fetch response groupRunningBit expiresAt",
  );
  if (
    !Number.isFinite(new Date(expiresAt).getTime()) ||
    new Date(expiresAt).toISOString() !== expiresAt
  ) {
    throw new TypeError(
      "Hosted mailbox fetch response groupRunningBit expiresAt must be canonical.",
    );
  }
  const publicAlias = readNullableString(
    record.publicAlias,
    "Hosted mailbox fetch response groupRunningBit publicAlias",
  );
  const requestedBit = requireString(
    record.requestedBit,
    "Hosted mailbox fetch response groupRunningBit requestedBit",
  );
  if (
    (publicAlias && [...publicAlias].length > 80) ||
    [...requestedBit].length < 1 ||
    [...requestedBit].length > 240
  ) {
    throw new TypeError(
      "Hosted mailbox fetch response groupRunningBit text is out of bounds.",
    );
  }
  return {
    expiresAt,
    publicAlias,
    requestedBit,
    schema: "murph.group-sponsorship-bit.v1",
  };
}

function parseHostedMailboxConversationUsageStatus(
  value: unknown,
): "low" | null {
  if (value === null || value === "low") {
    return value;
  }

  throw new TypeError(
    "Hosted mailbox fetch response conversationUsageStatus must be low or null.",
  );
}

export function parseHostedMailboxLane(value: unknown): HostedMailboxLane {
  return parseAllowedString(value, "Hosted mailbox lane", HOSTED_MAILBOX_LANES);
}

export function parseHostedMailboxKind(value: unknown): HostedMailboxKind {
  return parseAllowedString(value, "Hosted mailbox kind", HOSTED_MAILBOX_KINDS);
}

function parseHostedMailboxLaneCursor(
  value: unknown,
  label: string,
): HostedMailboxLaneCursor {
  const record = requireObject(value, label);

  return {
    importedSeq: requireNonNegativeBigIntString(
      record.importedSeq,
      `${label}.importedSeq`,
    ),
    lane: parseHostedMailboxLane(record.lane),
  };
}

function parseHostedMailboxLaneConsumed(
  value: unknown,
  label: string,
): HostedMailboxLaneConsumed {
  const record = requireObject(value, label);

  return {
    consumedSeq: requireNonNegativeBigIntString(
      record.consumedSeq,
      `${label}.consumedSeq`,
    ),
    lane: parseHostedMailboxLane(record.lane),
  };
}

function parseHostedMailboxLaneHighWater(
  value: unknown,
  label: string,
): HostedMailboxLaneHighWater {
  const record = requireObject(value, label);

  return {
    lane: parseHostedMailboxLane(record.lane),
    maxSeq: requireNonNegativeBigIntString(record.maxSeq, `${label}.maxSeq`),
    ...(record.maxUpdatedAt === undefined
      ? {}
      : {
          maxUpdatedAt: readNullableString(
            record.maxUpdatedAt,
            `${label}.maxUpdatedAt`,
          ),
        }),
  };
}
