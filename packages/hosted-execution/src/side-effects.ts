import {
  gatewayDeliveryTargetKindValues,
  type GatewayDeliveryTargetKind,
} from "@murphai/gateway-core";

export const HOSTED_ASSISTANT_DELIVERY_KIND = "assistant.delivery" as const;

export const hostedAssistantDeliveryTargetKindValues =
  gatewayDeliveryTargetKindValues;

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
export type HostedAssistantDeliveryTargetKind = GatewayDeliveryTargetKind;

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

export interface HostedAssistantDeliveryReceipt {
  channel: string;
  idempotencyKey: string;
  messageLength: number;
  providerMessageId: string | null;
  providerThreadId: string | null;
  sentAt: string;
  target: string;
  targetKind: HostedAssistantDeliveryTargetKind;
}

export type HostedExecutionAssistantDelivery = HostedAssistantDeliveryReceipt;

interface HostedAssistantDeliveryRecordBase {
  effectId: string;
  fingerprint: string;
  intentId: string;
  kind: HostedAssistantDeliveryKind;
  recordedAt: string;
}

export interface HostedAssistantDeliveryPreparedRecord
  extends HostedAssistantDeliveryRecordBase {
  state: "prepared";
}

export interface HostedAssistantDeliverySentRecord
  extends HostedAssistantDeliveryRecordBase {
  delivery: HostedAssistantDeliveryReceipt;
  state: "sent";
}

export type HostedAssistantDeliveryPreparedSideEffectRecord =
  HostedAssistantDeliveryPreparedRecord;

export type HostedAssistantDeliverySentSideEffectRecord =
  HostedAssistantDeliverySentRecord;

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
}): HostedAssistantDeliveryPreparedRecord {
  return {
    ...buildHostedAssistantDeliverySideEffect(input),
    recordedAt: requireString(input.recordedAt, "Hosted assistant prepared side effect recordedAt"),
    state: "prepared",
  };
}

export function buildHostedAssistantDeliverySentRecord(input: {
  dedupeKey: string;
  delivery: HostedAssistantDeliveryReceipt;
  intentId: string;
}): HostedAssistantDeliverySentRecord {
  return {
    ...buildHostedAssistantDeliverySideEffect(input),
    delivery: parseHostedAssistantDeliveryReceipt(
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
            delivery: parseHostedAssistantDeliveryReceipt(
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
  const record = requireObject(value, "Hosted assistant delivery side effect");

  return {
    effectId: requireString(
      record.effectId,
      "Hosted assistant delivery side effect effectId",
    ),
    fingerprint: requireString(
      record.fingerprint,
      "Hosted assistant delivery side effect fingerprint",
    ),
    intentId: requireString(
      record.intentId,
      "Hosted assistant delivery side effect intentId",
    ),
    kind: requireHostedAssistantDeliveryKind(
      record.kind,
      "Hosted assistant delivery side effect kind",
    ),
  };
}

export function parseHostedAssistantDeliverySideEffects(
  value: unknown,
): HostedAssistantDeliverySideEffect[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => parseHostedAssistantDeliverySideEffect(entry));
}

export function parseHostedAssistantDeliveryRecord(
  value: unknown,
): HostedAssistantDeliveryRecord {
  const record = requireObject(value, "Hosted assistant delivery record");
  const kind = requireHostedAssistantDeliveryKind(
    record.kind,
    "Hosted assistant delivery record kind",
  );
  const state = requireHostedAssistantDeliveryRecordState(
    record.state,
    "Hosted assistant delivery record state",
  );
  const baseRecord = {
    effectId: requireString(
      record.effectId,
      "Hosted assistant delivery record effectId",
    ),
    fingerprint: requireString(
      record.fingerprint,
      "Hosted assistant delivery record fingerprint",
    ),
    intentId: requireString(
      record.intentId,
      "Hosted assistant delivery record intentId",
    ),
    kind,
    recordedAt: requireString(
      record.recordedAt,
      "Hosted assistant delivery record recordedAt",
    ),
  };

  return state === "sent"
    ? {
        ...baseRecord,
        delivery: parseHostedAssistantDeliveryReceipt(
          record.delivery,
          "Hosted assistant delivery record delivery",
        ),
        state,
      }
    : {
        ...baseRecord,
        state,
      };
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

export function sameHostedAssistantDeliveryReceipt(
  left: HostedAssistantDeliveryReceipt,
  right: HostedAssistantDeliveryReceipt,
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

export function sameHostedExecutionAssistantDelivery(
  left: HostedExecutionAssistantDelivery,
  right: HostedExecutionAssistantDelivery,
): boolean {
  return sameHostedAssistantDeliveryReceipt(left, right);
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

function requireHostedAssistantDeliveryKind(
  value: unknown,
  label: string,
): HostedAssistantDeliveryKind {
  const kind = requireString(value, label);

  if (isHostedAssistantDeliveryKind(kind)) {
    return kind;
  }

  throw new TypeError(`Unsupported hosted assistant delivery kind: ${kind}`);
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

function requireHostedAssistantDeliveryRecordState(
  value: unknown,
  label: string,
): HostedAssistantDeliveryRecordState {
  const state = requireString(value, label);

  if (isHostedAssistantDeliveryRecordState(state)) {
    return state;
  }

  throw new TypeError(`Unsupported hosted assistant delivery record state: ${state}`);
}

export function isHostedExecutionSideEffectKind(
  value: string,
): value is HostedExecutionSideEffectKind {
  return isHostedAssistantDeliveryKind(value);
}

export function isHostedExecutionSideEffectRecordState(
  value: string,
): value is HostedExecutionSideEffectRecordState {
  return isHostedAssistantDeliveryRecordState(value);
}

export function isHostedAssistantDeliveryKind(
  value: string,
): value is HostedAssistantDeliveryKind {
  return value === HOSTED_ASSISTANT_DELIVERY_KIND;
}

export function isHostedAssistantDeliveryRecordState(
  value: string,
): value is HostedAssistantDeliveryRecordState {
  return (hostedAssistantDeliveryRecordStateValues as readonly string[]).includes(value);
}

function parseHostedAssistantDeliveryReceipt(
  value: unknown,
  label: string,
): HostedAssistantDeliveryReceipt {
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
): HostedAssistantDeliveryTargetKind {
  const targetKind = requireString(value, label);

  if ((hostedAssistantDeliveryTargetKindValues as readonly string[]).includes(targetKind)) {
    return targetKind as HostedAssistantDeliveryTargetKind;
  }

  throw new TypeError(
    `Unsupported hosted execution assistant delivery target kind: ${targetKind}`,
  );
}
