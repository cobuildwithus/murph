import { shapeConfiguredDeviceSyncHostedHintPayload } from "./provider-job-definitions.ts";

import type { DeviceSyncJobInput } from "./types.ts";

export function shapeHostedDeviceSyncJobHintPayload(
  provider: string,
  job: Pick<DeviceSyncJobInput, "kind" | "payload">,
): Record<string, unknown> {
  return shapeConfiguredDeviceSyncHostedHintPayload(provider, job);
}

const GARMIN_COALESCIBLE_FETCH_RESOURCES = new Set([
  "steps", "distance", "calories_active", "respiratory_rate",
]);
const GARMIN_FETCH_PAYLOAD_FIELDS = new Set([
  "eventType", "objectId", "occurredAt", "resource", "resourceCategory",
  "sourceProviderSlug", "windowStart", "windowEnd",
]);

/** Only notification-triggered pull work can share a fetch; inline data is never discarded. */
export function describeHostedDeviceSyncCoalescibleFetch(
  provider: string,
  job: DeviceSyncJobInput,
): { key: string; start: number; end: number } | null {
  const payload = job.payload ?? {};
  if (
    provider !== "junction" || job.kind !== "resource"
    || payload.sourceProviderSlug !== "garmin" || payload.resourceCategory !== "timeseries"
    || typeof payload.resource !== "string" || !GARMIN_COALESCIBLE_FETCH_RESOURCES.has(payload.resource)
    || typeof payload.eventType !== "string"
    || !new RegExp(`^(daily|historical)\\.data\\.${payload.resource}\\.(created|updated)$`).test(payload.eventType)
    || Object.keys(payload).some((key) => !GARMIN_FETCH_PAYLOAD_FIELDS.has(key))
    || typeof payload.windowStart !== "string" || typeof payload.windowEnd !== "string"
  ) return null;
  const start = Date.parse(payload.windowStart);
  const end = Date.parse(payload.windowEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start
    || end - start > 366 * 86_400_000) return null;
  return { key: JSON.stringify([payload.sourceProviderSlug, payload.resource, payload.eventType]), start, end };
}
