export const HOSTED_EXECUTION_SIDE_EFFECT_KINDS = [
  "assistant.delivery",
] as const;

export type HostedExecutionSideEffectKind =
  (typeof HOSTED_EXECUTION_SIDE_EFFECT_KINDS)[number];

export interface HostedAssistantDeliverySideEffect {
  effectId: string;
  fingerprint: string;
  intentId: string;
  kind: "assistant.delivery";
}

export type HostedExecutionSideEffect = HostedAssistantDeliverySideEffect;

export interface HostedExecutionAssistantDelivery {
  channel: string;
  idempotencyKey: string | null;
  messageLength: number;
  sentAt: string;
  target: string;
  targetKind: "explicit" | "participant" | "thread";
}

export interface HostedAssistantDeliverySideEffectRecord {
  delivery: HostedExecutionAssistantDelivery;
  effectId: string;
  fingerprint: string;
  intentId: string;
  kind: "assistant.delivery";
  recordedAt: string;
}

export type HostedExecutionSideEffectRecord = HostedAssistantDeliverySideEffectRecord;

export function buildHostedAssistantDeliverySideEffect(input: {
  dedupeKey: string;
  intentId: string;
}): HostedAssistantDeliverySideEffect {
  return {
    effectId: input.intentId,
    fingerprint: input.dedupeKey,
    intentId: input.intentId,
    kind: "assistant.delivery",
  };
}

export function parseHostedExecutionSideEffect(value: unknown): HostedExecutionSideEffect {
  const record = requireObject(value, "Hosted execution side effect");
  const kind = requireHostedExecutionSideEffectKind(
    record.kind,
    "Hosted execution side effect kind",
  );

  switch (kind) {
    case "assistant.delivery":
      return {
        effectId: requireString(record.effectId, "Hosted assistant side effect effectId"),
        fingerprint: requireString(
          record.fingerprint,
          "Hosted assistant side effect fingerprint",
        ),
        intentId: requireString(record.intentId, "Hosted assistant side effect intentId"),
        kind,
      };
    default:
      throw new TypeError(`Unsupported hosted execution side effect kind: ${kind}`);
  }
}

export function parseHostedExecutionSideEffects(value: unknown): HostedExecutionSideEffect[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => parseHostedExecutionSideEffect(entry));
}

export function parseHostedExecutionSideEffectRecord(
  value: unknown,
): HostedExecutionSideEffectRecord {
  const record = requireObject(value, "Hosted execution side effect record");
  const kind = requireHostedExecutionSideEffectKind(
    record.kind,
    "Hosted execution side effect record kind",
  );

  switch (kind) {
    case "assistant.delivery":
      return {
        delivery: parseHostedExecutionAssistantDelivery(
          record.delivery,
          "Hosted assistant side effect record delivery",
        ),
        effectId: requireString(
          record.effectId,
          "Hosted assistant side effect record effectId",
        ),
        fingerprint: requireString(
          record.fingerprint,
          "Hosted assistant side effect record fingerprint",
        ),
        intentId: requireString(
          record.intentId,
          "Hosted assistant side effect record intentId",
        ),
        kind,
        recordedAt: requireString(
          record.recordedAt,
          "Hosted assistant side effect record recordedAt",
        ),
      };
    default:
      throw new TypeError(`Unsupported hosted execution side effect record kind: ${kind}`);
  }
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function requireNullableString(value: unknown, label: string): string | null {
  if (value == null) {
    return null;
  }

  return requireString(value, label);
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }

  return value;
}

function requireHostedExecutionSideEffectKind(
  value: unknown,
  label: string,
): HostedExecutionSideEffectKind {
  const kind = requireString(value, label);

  if (isHostedExecutionSideEffectKind(kind)) {
    return kind;
  }

  throw new TypeError(`Unsupported hosted execution side effect kind: ${kind}`);
}

export function isHostedExecutionSideEffectKind(
  value: string,
): value is HostedExecutionSideEffectKind {
  return (HOSTED_EXECUTION_SIDE_EFFECT_KINDS as readonly string[]).includes(value);
}

function parseHostedExecutionAssistantDelivery(
  value: unknown,
  label: string,
): HostedExecutionAssistantDelivery {
  const record = requireObject(value, label);

  return {
    channel: requireString(record.channel, `${label}.channel`),
    idempotencyKey: requireNullableString(
      record.idempotencyKey,
      `${label}.idempotencyKey`,
    ),
    messageLength: requireNonNegativeInteger(
      record.messageLength,
      `${label}.messageLength`,
    ),
    sentAt: requireString(record.sentAt, `${label}.sentAt`),
    target: requireString(record.target, `${label}.target`),
    targetKind: requireHostedExecutionAssistantDeliveryTargetKind(
      record.targetKind,
      `${label}.targetKind`,
    ),
  };
}

function requireHostedExecutionAssistantDeliveryTargetKind(
  value: unknown,
  label: string,
): HostedExecutionAssistantDelivery["targetKind"] {
  const targetKind = requireString(value, label);

  if (
    targetKind === "explicit"
    || targetKind === "participant"
    || targetKind === "thread"
  ) {
    return targetKind;
  }

  throw new TypeError(
    `Unsupported hosted execution assistant delivery target kind: ${targetKind}`,
  );
}
