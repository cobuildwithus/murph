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
    case "delete":
      return pickHostedWakePayloadFields(payload, {
        dataType: "string",
        objectId: "string",
        occurredAt: "string",
        sourceEventType: "string",
      });
    default:
      return {};
  }
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
