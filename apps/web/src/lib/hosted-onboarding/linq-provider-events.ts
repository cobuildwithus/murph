import type { Prisma } from "@prisma/client";

import type { HostedLinqWebhookEvent } from "./linq";
import { normalizePhoneNumber } from "./phone";
import { normalizeNullableString } from "../primitives";
import {
  parseHostedLinqProviderEvent as parseNormalizedHostedLinqProviderEvent,
  type ParsedHostedLinqProviderEvent as NormalizedHostedLinqProviderEvent,
} from "./linq-provider-event-normalization";

export {
  HOSTED_LINQ_PROVIDER_EVENT_TYPES,
  isHostedLinqAffirmativeReaction,
  isHostedLinqProviderEventType,
  type HostedLinqProviderEventPhoneRole,
  type HostedLinqProviderEventType,
} from "./linq-provider-event-normalization";

/**
 * Request-local authority evidence. It is deliberately omitted from every
 * persisted provider-event projection and may only be used inside the webhook
 * transaction that received it.
 */
export type HostedLinqParticipantAddedOwnerEvidence = Readonly<{
  addedByHandle: string;
  linePhoneNumber: string;
}>;

export type ParsedHostedLinqProviderEvent = NormalizedHostedLinqProviderEvent & {
  participantAddedOwnerEvidence?: HostedLinqParticipantAddedOwnerEvidence | null;
};

/**
 * Keeps the existing operational event normalizer separate from the narrow
 * authority evidence required to establish a new group owner. Raw handles stay
 * request-local and only a boolean presence marker joins persisted diagnostics.
 */
export function parseHostedLinqProviderEvent(input: {
  event: HostedLinqWebhookEvent;
  rawBody?: string | null;
}): ParsedHostedLinqProviderEvent | null {
  const parsed = parseNormalizedHostedLinqProviderEvent(input);
  if (!parsed || input.event.event_type !== "participant.added") {
    return parsed;
  }

  const participantAddedOwnerEvidence =
    readHostedLinqParticipantAddedOwnerEvidence(readRecord(input.event.data));
  return {
    ...parsed,
    extractionJson: withOwnerActorEvidencePresence(
      parsed.extractionJson,
      participantAddedOwnerEvidence !== null,
    ),
    participantAddedOwnerEvidence,
  };
}

function readHostedLinqParticipantAddedOwnerEvidence(
  data: Record<string, unknown> | null,
): HostedLinqParticipantAddedOwnerEvidence | null {
  const addedParticipantIsMe = readFirstBooleanAtPaths(data, [
    ["participant", "is_me"],
    ["participant", "isMe"],
    ["participant_handle", "is_me"],
    ["participantHandle", "isMe"],
  ] as const);
  if (addedParticipantIsMe !== true) {
    return null;
  }

  const linePhoneNumber = normalizePhoneNumber(readFirstHandleAtPaths(data, [
    ["participant"],
    ["participant_handle"],
    ["participantHandle"],
    ["handle"],
  ] as const));
  const addedByHandle = readFirstHandleAtPaths(data, [
    ["added_by_handle"],
    ["addedByHandle"],
  ] as const);
  const addedByIsMe = readFirstBooleanAtPaths(data, [
    ["added_by_handle", "is_me"],
    ["added_by_handle", "isMe"],
    ["addedByHandle", "is_me"],
    ["addedByHandle", "isMe"],
  ] as const);

  if (
    !linePhoneNumber
    || !addedByHandle
    || addedByIsMe === true
    || normalizePhoneNumber(addedByHandle) === linePhoneNumber
  ) {
    return null;
  }

  return {
    addedByHandle,
    linePhoneNumber,
  };
}

function withOwnerActorEvidencePresence(
  extractionJson: Prisma.InputJsonValue,
  ownerActorEvidencePresent: boolean,
): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify({
    ...(readRecord(extractionJson) ?? {}),
    ownerActorEvidencePresent,
  })) as Prisma.InputJsonValue;
}

function readFirstHandleAtPaths(
  record: Record<string, unknown> | null,
  paths: ReadonlyArray<readonly string[]>,
): string | null {
  for (const path of paths) {
    const value = readValueAtPath(record, path);
    if (typeof value === "string") {
      const normalized = normalizeNullableString(value);
      if (normalized) {
        return normalized;
      }
    }
    const nested = readRecord(value);
    const handle = nested ? readStringAtPath(nested, ["handle"]) : null;
    if (handle) {
      return handle;
    }
  }

  return null;
}

function readFirstBooleanAtPaths(
  record: Record<string, unknown> | null,
  paths: ReadonlyArray<readonly string[]>,
): boolean | null {
  for (const path of paths) {
    const value = readValueAtPath(record, path);
    if (typeof value === "boolean") {
      return value;
    }
  }
  return null;
}

function readStringAtPath(
  record: Record<string, unknown> | null,
  path: readonly string[],
): string | null {
  const value = readValueAtPath(record, path);
  if (typeof value === "number") {
    return normalizeNullableString(String(value));
  }
  return typeof value === "string" ? normalizeNullableString(value) : null;
}

function readValueAtPath(
  record: Record<string, unknown> | null,
  path: readonly string[],
): unknown {
  let value: unknown = record;
  for (const key of path) {
    const current = readRecord(value);
    if (!current) {
      return null;
    }
    value = current[key];
  }
  return value;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
