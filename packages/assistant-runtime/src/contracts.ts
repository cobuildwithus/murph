export {
  assistantChannelDeliverySchema,
  assistantOutboxIntentSchema,
  resolveAssistantStatePaths,
} from "healthybob";

export type {
  AssistantChannelDelivery,
  AssistantOutboxDispatchHooks,
  AssistantOutboxIntent,
} from "healthybob";

import {
  assistantChannelDeliverySchema,
  type AssistantChannelDelivery,
} from "healthybob";

export interface HostedAssistantDeliverySideEffect {
  effectId: string;
  fingerprint: string;
  intentId: string;
  kind: "assistant.delivery";
}

export type HostedExecutionSideEffect = HostedAssistantDeliverySideEffect;

export interface HostedAssistantDeliverySideEffectRecord {
  delivery: AssistantChannelDelivery;
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
  const kind = requireString(record.kind, "Hosted execution side effect kind");

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
  const kind = requireString(record.kind, "Hosted execution side effect record kind");

  switch (kind) {
    case "assistant.delivery":
      return {
        delivery: assistantChannelDeliverySchema.parse(record.delivery),
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
