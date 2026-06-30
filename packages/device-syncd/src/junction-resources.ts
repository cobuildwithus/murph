import { normalizeJunctionResourceName } from "@murphai/importers/device-providers/junction-resources";

export { normalizeJunctionResourceName };

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
