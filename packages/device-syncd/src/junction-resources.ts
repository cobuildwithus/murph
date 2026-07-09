import { normalizeJunctionResourceName } from "@murphai/importers/device-providers/junction-resources";

export { normalizeJunctionResourceName };

/**
 * Closed companion-only resource carried through the Junction device-sync
 * account. It is not a Junction API resource and must be handled before the
 * configured Junction resource allowlist.
 */
export const JUNCTION_COMPANION_HEALTH_METADATA_RESOURCE = "companion_health_metadata";
export const JUNCTION_COMPANION_HEALTH_METADATA_EVENT_TYPE = "companion.health_metadata.v1";
export const JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER = "apple-health-kit";
export const JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_TYPE =
  "companion-whoop-metadata-unverified";
export const JUNCTION_COMPANION_HEALTH_METADATA_SCHEMA_VERSION = 1;
export const JUNCTION_COMPANION_HEALTH_METADATA_MAX_BATCH_BYTES = 64_000;
export const JUNCTION_COMPANION_HEALTH_METADATA_MAX_RECORDS = 200;
export const JUNCTION_COMPANION_HEALTH_METADATA_MAX_HISTORY_MS = 366 * 24 * 60 * 60 * 1_000;
export const JUNCTION_COMPANION_HEALTH_METADATA_MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1_000;

/**
 * Resolves the normalized Junction resource name carried by a webhook event
 * type such as `daily.data.sleep.created`. Lifecycle events such as
 * `provider.connection.created` carry no data resource and resolve to null.
 */
export function readJunctionWebhookResourceName(eventType: string): string | null {
  return normalizeJunctionResourceName(readJunctionWebhookResourceFromEventType(eventType));
}

function readJunctionWebhookResourceFromEventType(eventType: string): string | null {
  const parts = eventType.split(".").map((part) => part.trim()).filter(Boolean);
  const dataIndex = parts.indexOf("data");

  if (dataIndex >= 0 && parts[dataIndex + 1]) {
    return parts[dataIndex + 1] ?? null;
  }

  return null;
}
