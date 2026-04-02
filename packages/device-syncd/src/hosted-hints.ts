import type { DeviceSyncJobInput } from "./types.ts";

export function shapeHostedDeviceSyncJobHintPayload(
  provider: string,
  job: Pick<DeviceSyncJobInput, "kind" | "payload">,
): Record<string, unknown> {
  const payload = job.payload ?? {};

  switch (provider) {
    case "garmin":
      return shapeHostedGarminJobHintPayload(job.kind, payload);
    case "oura":
      return shapeHostedOuraJobHintPayload(job.kind, payload);
    case "whoop":
      return shapeHostedWhoopJobHintPayload(job.kind, payload);
    default:
      return {};
  }
}

function shapeHostedGarminJobHintPayload(
  kind: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  switch (kind) {
    case "backfill":
    case "reconcile":
      return pickHostedWakePayloadFields(payload, {
        includeProfile: "boolean",
        windowEnd: "string",
        windowStart: "string",
      });
    default:
      return {};
  }
}

function shapeHostedOuraJobHintPayload(
  kind: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  switch (kind) {
    case "backfill":
    case "reconcile":
      return pickHostedWakePayloadFields(payload, {
        includePersonalInfo: "boolean",
        windowEnd: "string",
        windowStart: "string",
      });
    case "resource":
      return pickHostedWakePayloadFields(payload, {
        dataType: "string",
        includePersonalInfo: "boolean",
        objectId: "string",
        occurredAt: "string",
        windowEnd: "string",
        windowStart: "string",
      });
    case "delete": {
      const shaped = pickHostedWakePayloadFields(payload, {
        dataType: "string",
        objectId: "string",
        occurredAt: "string",
        sourceEventType: "string",
      });
      const webhookPayload = shapeHostedOuraDeleteWebhookPayload(payload.webhookPayload);
      return webhookPayload ? { ...shaped, webhookPayload } : shaped;
    }
    default:
      return {};
  }
}

function shapeHostedOuraDeleteWebhookPayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const payload = pickHostedWakePayloadFields(value as Record<string, unknown>, {
    data_type: "string",
    dataType: "string",
    event_time: "string",
    eventTime: "string",
    event_type: "string",
    eventType: "string",
    id: "string",
    object_id: "string",
    objectId: "string",
    trace_id: "string",
    traceId: "string",
    user_id: "string",
    userId: "string",
  });

  return Object.keys(payload).length > 0 ? payload : null;
}

function shapeHostedWhoopJobHintPayload(
  kind: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  switch (kind) {
    case "backfill":
    case "reconcile":
      return pickHostedWakePayloadFields(payload, {
        windowEnd: "string",
        windowStart: "string",
      });
    case "resource":
    case "delete":
      return pickHostedWakePayloadFields(payload, {
        eventType: "string",
        occurredAt: "string",
        resourceId: "string",
        resourceType: "string",
      });
    default:
      return {};
  }
}

function pickHostedWakePayloadFields(
  payload: Record<string, unknown>,
  allowlist: Record<string, "boolean" | "number" | "string">,
): Record<string, unknown> {
  const shaped: Record<string, unknown> = {};

  for (const [key, valueType] of Object.entries(allowlist)) {
    const value = payload[key];
    if (typeof value === valueType) {
      shaped[key] = value;
    }
  }

  return shaped;
}
