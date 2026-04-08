export const HOSTED_ASSISTANT_DELIVERY_KIND = "assistant.delivery" as const;

export const HOSTED_EXECUTION_SIDE_EFFECT_KINDS = [
  HOSTED_ASSISTANT_DELIVERY_KIND,
] as const;

export const hostedAssistantDeliveryRecordStateValues = [
  "prepared",
  "sent",
] as const;

export const HOSTED_EXECUTION_SIDE_EFFECT_RECORD_STATES =
  hostedAssistantDeliveryRecordStateValues;

export type HostedAssistantDeliveryKind = typeof HOSTED_ASSISTANT_DELIVERY_KIND;

export type HostedExecutionSideEffectKind = HostedAssistantDeliveryKind;

export type HostedAssistantDeliveryRecordState =
  (typeof hostedAssistantDeliveryRecordStateValues)[number];

export type HostedExecutionSideEffectRecordState = HostedAssistantDeliveryRecordState;

export interface HostedAssistantDeliverySideEffect {
  effectId: string;
  fingerprint: string;
  intentId: string;
  kind: HostedAssistantDeliveryKind;
}

export type HostedExecutionSideEffect = HostedAssistantDeliverySideEffect;

export interface HostedExecutionAssistantDelivery {
  channel: string;
  idempotencyKey: string;
  messageLength: number;
  providerMessageId: string | null;
  providerThreadId: string | null;
  sentAt: string;
  target: string;
  targetKind: "explicit" | "participant" | "thread";
}

interface HostedAssistantDeliverySideEffectRecordBase {
  effectId: string;
  fingerprint: string;
  intentId: string;
  kind: HostedAssistantDeliveryKind;
  recordedAt: string;
}

export interface HostedAssistantDeliveryPreparedSideEffectRecord
  extends HostedAssistantDeliverySideEffectRecordBase {
  state: "prepared";
}

export interface HostedAssistantDeliverySentSideEffectRecord
  extends HostedAssistantDeliverySideEffectRecordBase {
  delivery: HostedExecutionAssistantDelivery;
  state: "sent";
}

export type HostedAssistantDeliveryPreparedRecord =
  HostedAssistantDeliveryPreparedSideEffectRecord;

export type HostedAssistantDeliverySentRecord =
  HostedAssistantDeliverySentSideEffectRecord;

export type HostedAssistantDeliveryRecord =
  | HostedAssistantDeliveryPreparedRecord
  | HostedAssistantDeliverySentRecord;

export type HostedExecutionSideEffectRecord = HostedAssistantDeliveryRecord;

export function buildHostedAssistantDeliverySideEffect(input: {
  dedupeKey: string;
  intentId: string;
}): HostedAssistantDeliverySideEffect {
  return {
    effectId: input.intentId,
    fingerprint: input.dedupeKey,
    intentId: input.intentId,
    kind: HOSTED_ASSISTANT_DELIVERY_KIND,
  };
}

export function buildHostedAssistantDeliveryPreparedRecord(input: {
  dedupeKey: string;
  intentId: string;
  recordedAt: string;
}): HostedAssistantDeliveryPreparedSideEffectRecord {
  return {
    ...buildHostedAssistantDeliverySideEffect(input),
    recordedAt: requireString(input.recordedAt, "Hosted assistant prepared side effect recordedAt"),
    state: "prepared",
  };
}

export function buildHostedAssistantDeliverySentRecord(input: {
  dedupeKey: string;
  delivery: HostedExecutionAssistantDelivery;
  intentId: string;
}): HostedAssistantDeliverySentSideEffectRecord {
  return {
    ...buildHostedAssistantDeliverySideEffect(input),
    delivery: parseHostedExecutionAssistantDelivery(
      input.delivery,
      "Hosted assistant sent side effect delivery",
    ),
    recordedAt: input.delivery.sentAt,
    state: "sent",
  };
}

export function parseHostedExecutionSideEffect(value: unknown): HostedExecutionSideEffect {
  const record = requireObject(value, "Hosted execution side effect");
  const kind = requireHostedExecutionSideEffectKind(
    record.kind,
    "Hosted execution side effect kind",
  );

  switch (kind) {
    case HOSTED_ASSISTANT_DELIVERY_KIND:
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
    case HOSTED_ASSISTANT_DELIVERY_KIND: {
      const baseRecord = {
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
      const state = requireHostedExecutionSideEffectRecordState(
        record.state,
        "Hosted assistant side effect record state",
      );

      return state === "sent"
        ? {
            ...baseRecord,
            delivery: parseHostedExecutionAssistantDelivery(
              record.delivery,
              "Hosted assistant side effect record delivery",
            ),
            state,
          }
        : {
            ...baseRecord,
            state,
          };
    }
    default:
      throw new TypeError(`Unsupported hosted execution side effect record kind: ${kind}`);
  }
}

export function parseHostedAssistantDeliverySideEffect(
  value: unknown,
): HostedAssistantDeliverySideEffect {
  return parseHostedExecutionSideEffect(value);
}

export function parseHostedAssistantDeliverySideEffects(
  value: unknown,
): HostedAssistantDeliverySideEffect[] {
  return parseHostedExecutionSideEffects(value);
}

export function parseHostedAssistantDeliveryRecord(
  value: unknown,
): HostedAssistantDeliveryRecord {
  return parseHostedExecutionSideEffectRecord(value);
}

export function sameHostedExecutionSideEffectIdentity(
  left: Pick<HostedExecutionSideEffectRecord, "effectId" | "fingerprint" | "intentId" | "kind">,
  right: Pick<HostedExecutionSideEffectRecord, "effectId" | "fingerprint" | "intentId" | "kind">,
): boolean {
  return (
    left.effectId === right.effectId
    && left.fingerprint === right.fingerprint
    && left.intentId === right.intentId
    && left.kind === right.kind
  );
}

export function sameHostedAssistantDeliverySideEffectIdentity(
  left: Pick<HostedAssistantDeliveryRecord, "effectId" | "fingerprint" | "intentId" | "kind">,
  right: Pick<HostedAssistantDeliveryRecord, "effectId" | "fingerprint" | "intentId" | "kind">,
): boolean {
  return sameHostedExecutionSideEffectIdentity(left, right);
}

export function assertHostedAssistantDeliveryRecordConsistency(
  record: HostedAssistantDeliveryRecord,
): void {
  if (record.effectId !== record.intentId) {
    throw new TypeError(
      `Hosted assistant delivery ${record.effectId} must reuse the same intentId as effectId.`,
    );
  }
}

export function sameHostedExecutionAssistantDelivery(
  left: HostedExecutionAssistantDelivery,
  right: HostedExecutionAssistantDelivery,
): boolean {
  return (
    left.channel === right.channel
    && left.idempotencyKey === right.idempotencyKey
    && left.messageLength === right.messageLength
    && left.providerMessageId === right.providerMessageId
    && left.providerThreadId === right.providerThreadId
    && left.sentAt === right.sentAt
    && left.target === right.target
    && left.targetKind === right.targetKind
  );
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

function requireHostedExecutionSideEffectRecordState(
  value: unknown,
  label: string,
): HostedExecutionSideEffectRecordState {
  const state = requireString(value, label);

  if (isHostedExecutionSideEffectRecordState(state)) {
    return state;
  }

  throw new TypeError(`Unsupported hosted execution side effect record state: ${state}`);
}

export function isHostedExecutionSideEffectKind(
  value: string,
): value is HostedExecutionSideEffectKind {
  return isHostedAssistantDeliveryKind(value);
}

export function isHostedExecutionSideEffectRecordState(
  value: string,
): value is HostedExecutionSideEffectRecordState {
  return (HOSTED_EXECUTION_SIDE_EFFECT_RECORD_STATES as readonly string[]).includes(value);
}

export function isHostedAssistantDeliveryKind(
  value: string,
): value is HostedAssistantDeliveryKind {
  return value === HOSTED_ASSISTANT_DELIVERY_KIND;
}

function parseHostedExecutionAssistantDelivery(
  value: unknown,
  label: string,
): HostedExecutionAssistantDelivery {
  const record = requireObject(value, label);

  return {
    channel: requireString(record.channel, `${label}.channel`),
    idempotencyKey: requireString(
      record.idempotencyKey,
      `${label}.idempotencyKey`,
    ),
    messageLength: requireNonNegativeInteger(
      record.messageLength,
      `${label}.messageLength`,
    ),
    providerMessageId: requireNullableString(
      record.providerMessageId ?? null,
      `${label}.providerMessageId`,
    ),
    providerThreadId: requireNullableString(
      record.providerThreadId ?? null,
      `${label}.providerThreadId`,
    ),
    sentAt: requireString(record.sentAt, `${label}.sentAt`),
    target: requireString(record.target, `${label}.target`),
    targetKind: requireHostedExecutionAssistantDeliveryTargetKind(
      record.targetKind,
      `${label}.targetKind`,
    ),
  };
}

function requireNullableString(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }

  return requireString(value, label);
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
