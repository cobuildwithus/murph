export const HOSTED_EXECUTION_GROUP_REACTION_EVENT_SCHEMA =
  "murph.hosted-group-reaction.v1";
export const HOSTED_EXECUTION_GROUP_REACTION_EVENT_TEXT_PREFIX =
  "[Murph group reaction event]";
export const HOSTED_EXECUTION_GROUP_REACTION_EVENT_ID_PREFIX =
  "group-reaction:";
export const HOSTED_EXECUTION_GROUP_REACTION_SENDER_ATTESTATION =
  "group-reaction";

const HOSTED_EXECUTION_GROUP_REACTION_ACTOR_MAX_CHARS = 512;
const HOSTED_EXECUTION_GROUP_REACTION_EVENT_ID_MAX_CHARS = 512;
const HOSTED_EXECUTION_GROUP_REACTION_TARGET_ID_MAX_CHARS = 512;
const HOSTED_EXECUTION_GROUP_REACTION_TARGET_TEXT_MAX_CHARS = 1_000;
const HOSTED_EXECUTION_GROUP_REACTION_VALUE_MAX_CHARS = 256;
const HOSTED_EXECUTION_GROUP_REACTION_CHANGE_MAX_COUNT = 64;
const HOSTED_EXECUTION_GROUP_REACTION_COUNT_MAX = 1_000_000_000;

export type HostedExecutionGroupReactionChannel = "linq" | "telegram";
export type HostedExecutionGroupReactionMode = "delta" | "snapshot";
export type HostedExecutionGroupReactionOperation =
  | "added"
  | "removed"
  | "snapshot";

export interface HostedExecutionGroupReactionChange {
  count?: number;
  operation: HostedExecutionGroupReactionOperation;
  reaction: string;
}

export interface HostedExecutionGroupReactionEvent {
  actor: string | null;
  changes: HostedExecutionGroupReactionChange[];
  channel: HostedExecutionGroupReactionChannel;
  mode: HostedExecutionGroupReactionMode;
  schema: typeof HOSTED_EXECUTION_GROUP_REACTION_EVENT_SCHEMA;
  targetMessageId: string;
  targetText: string | null;
}

export type HostedExecutionGroupReactionEventInput = Omit<
  HostedExecutionGroupReactionEvent,
  "schema"
>;

/**
 * Web-authored namespace carried by the existing conversation mailbox event id.
 * It gives every provider reaction an idempotency key distinct from ordinary
 * provider messages without adding another mailbox kind.
 */
export function createHostedExecutionGroupReactionEventId(
  providerEventId: string,
): string {
  const normalized = normalizeHostedExecutionGroupReactionRequiredText(
    providerEventId,
    HOSTED_EXECUTION_GROUP_REACTION_EVENT_ID_MAX_CHARS,
    "providerEventId",
  );
  return `${HOSTED_EXECUTION_GROUP_REACTION_EVENT_ID_PREFIX}${normalized}`;
}

export function isHostedExecutionGroupReactionEventId(
  value: string | null | undefined,
): boolean {
  return typeof value === "string"
    && value.startsWith(HOSTED_EXECUTION_GROUP_REACTION_EVENT_ID_PREFIX)
    && value.length > HOSTED_EXECUTION_GROUP_REACTION_EVENT_ID_PREFIX.length;
}

export function formatHostedExecutionGroupReactionEventText(
  input: HostedExecutionGroupReactionEventInput,
): string {
  const event = normalizeHostedExecutionGroupReactionEvent({
    ...input,
    schema: HOSTED_EXECUTION_GROUP_REACTION_EVENT_SCHEMA,
  });
  return `${HOSTED_EXECUTION_GROUP_REACTION_EVENT_TEXT_PREFIX}\n${JSON.stringify(event)}`;
}

export function parseHostedExecutionGroupReactionEventText(
  value: string | null | undefined,
): HostedExecutionGroupReactionEvent | null {
  const text = typeof value === "string" ? value.trim() : "";
  const prefix = `${HOSTED_EXECUTION_GROUP_REACTION_EVENT_TEXT_PREFIX}\n`;
  if (!text.startsWith(prefix)) {
    return null;
  }

  try {
    return normalizeHostedExecutionGroupReactionEvent(
      JSON.parse(text.slice(prefix.length)),
    );
  } catch {
    return null;
  }
}

export function isHostedExecutionGroupReactionEventText(
  value: string | null | undefined,
): boolean {
  return parseHostedExecutionGroupReactionEventText(value) !== null;
}

export function renderHostedExecutionGroupReactionEventEvidence(
  event: HostedExecutionGroupReactionEvent,
): string {
  const changes = event.changes.length === 0
    ? "no reactions"
    : event.changes.map(renderHostedExecutionGroupReactionChange).join("; ");
  return [
    "Group reaction event:",
    `- channel: ${event.channel}`,
    `- actor: ${event.actor === null ? "anonymous aggregate" : JSON.stringify(event.actor)}`,
    `- target message id: ${JSON.stringify(event.targetMessageId)}`,
    ...(event.targetText === null
      ? []
      : [`- target text: ${JSON.stringify(event.targetText)}`]),
    `- reaction ${event.mode}: ${changes}`,
  ].join("\n");
}

function normalizeHostedExecutionGroupReactionEvent(
  value: unknown,
): HostedExecutionGroupReactionEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted group reaction event must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (record.schema !== HOSTED_EXECUTION_GROUP_REACTION_EVENT_SCHEMA) {
    throw new TypeError("Hosted group reaction event schema is invalid.");
  }
  if (record.channel !== "linq" && record.channel !== "telegram") {
    throw new TypeError("Hosted group reaction event channel is invalid.");
  }
  if (record.mode !== "delta" && record.mode !== "snapshot") {
    throw new TypeError("Hosted group reaction event mode is invalid.");
  }
  const channel = record.channel;
  const mode = record.mode;
  const actor = normalizeHostedExecutionGroupReactionOptionalText(
    record.actor,
    HOSTED_EXECUTION_GROUP_REACTION_ACTOR_MAX_CHARS,
    "actor",
  );
  const targetMessageId = normalizeHostedExecutionGroupReactionRequiredText(
    record.targetMessageId,
    HOSTED_EXECUTION_GROUP_REACTION_TARGET_ID_MAX_CHARS,
    "targetMessageId",
  );
  const targetText = normalizeHostedExecutionGroupReactionOptionalText(
    record.targetText,
    HOSTED_EXECUTION_GROUP_REACTION_TARGET_TEXT_MAX_CHARS,
    "targetText",
  );
  if (
    !Array.isArray(record.changes)
    || record.changes.length > HOSTED_EXECUTION_GROUP_REACTION_CHANGE_MAX_COUNT
  ) {
    throw new TypeError("Hosted group reaction event changes are invalid.");
  }
  const changes = record.changes.map((change) =>
    normalizeHostedExecutionGroupReactionChange(change, mode),
  );
  if (mode === "delta" && changes.length === 0) {
    throw new TypeError("Hosted group reaction delta must contain a change.");
  }

  return {
    actor,
    changes,
    channel,
    mode,
    schema: HOSTED_EXECUTION_GROUP_REACTION_EVENT_SCHEMA,
    targetMessageId,
    targetText,
  };
}

function normalizeHostedExecutionGroupReactionChange(
  value: unknown,
  mode: HostedExecutionGroupReactionMode,
): HostedExecutionGroupReactionChange {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted group reaction change must be an object.");
  }
  const record = value as Record<string, unknown>;
  const reaction = normalizeHostedExecutionGroupReactionRequiredText(
    record.reaction,
    HOSTED_EXECUTION_GROUP_REACTION_VALUE_MAX_CHARS,
    "reaction",
  );

  if (mode === "snapshot") {
    if (record.operation !== "snapshot") {
      throw new TypeError("Hosted group reaction snapshot operation is invalid.");
    }
    if (
      typeof record.count !== "number"
      || !Number.isSafeInteger(record.count)
      || record.count < 0
      || record.count > HOSTED_EXECUTION_GROUP_REACTION_COUNT_MAX
    ) {
      throw new TypeError("Hosted group reaction snapshot count is invalid.");
    }
    return {
      count: record.count,
      operation: "snapshot",
      reaction,
    };
  }

  if (record.operation !== "added" && record.operation !== "removed") {
    throw new TypeError("Hosted group reaction delta operation is invalid.");
  }
  if (record.count !== undefined) {
    throw new TypeError("Hosted group reaction delta must not include count.");
  }
  return {
    operation: record.operation,
    reaction,
  };
}

function normalizeHostedExecutionGroupReactionRequiredText(
  value: unknown,
  maxChars: number,
  field: string,
): string {
  const normalized = normalizeHostedExecutionGroupReactionText(value, maxChars);
  if (!normalized) {
    throw new TypeError(`Hosted group reaction ${field} is required.`);
  }
  return normalized;
}

function normalizeHostedExecutionGroupReactionOptionalText(
  value: unknown,
  maxChars: number,
  field: string,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = normalizeHostedExecutionGroupReactionText(value, maxChars);
  if (!normalized) {
    throw new TypeError(`Hosted group reaction ${field} is invalid.`);
  }
  return normalized;
}

function normalizeHostedExecutionGroupReactionText(
  value: unknown,
  maxChars: number,
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized || Array.from(normalized).length > maxChars) {
    return null;
  }
  return normalized;
}

function renderHostedExecutionGroupReactionChange(
  change: HostedExecutionGroupReactionChange,
): string {
  if (change.operation === "snapshot") {
    return `${JSON.stringify(change.reaction)} × ${change.count ?? 0}`;
  }
  return `${change.operation} ${JSON.stringify(change.reaction)}`;
}
