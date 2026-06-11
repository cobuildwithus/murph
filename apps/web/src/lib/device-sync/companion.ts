import "server-only";

import {
  deviceSyncError,
  normalizeJunctionResourceName,
  readJunctionWebhookResourceName,
} from "@murphai/device-syncd/public-ingress";

import type { PrismaDeviceSyncControlPlaneStore } from "./prisma-store";
import { isAvailableConnectionSourceResource } from "./public-ingress-service";

/** The companion app's only device-sync provider. */
export const COMPANION_DEVICE_SYNC_PROVIDER = "junction";

const COMPANION_METADATA_STRING_MAX_LENGTH = 200;
const COMPANION_SDK_VERSION_MAX_ENTRIES = 10;

/**
 * Validates the optional companion sign-in request metadata and discards it.
 *
 * A `companion_installations` record was considered in the MVP spec and is
 * deliberately deferred until operationally needed: the metadata carries no
 * load-bearing behavior today, so we validate the shape for forward
 * compatibility and persist or log nothing from it.
 */
export function validateCompanionSignInRequestBody(body: Record<string, unknown>): void {
  const platform = readOptionalBoundedString(body, "platform");
  if (platform !== null && platform !== "ios") {
    throw companionRequestInvalid("platform must be ios when provided.");
  }
  readOptionalBoundedString(body, "appInstallationId");
  readOptionalBoundedString(body, "appVersion");

  const sdkVersions = body.sdkVersions;
  if (sdkVersions === undefined || sdkVersions === null) {
    return;
  }

  if (typeof sdkVersions !== "object" || Array.isArray(sdkVersions)) {
    throw companionRequestInvalid("sdkVersions must be an object of string values.");
  }

  const entries = Object.entries(sdkVersions as Record<string, unknown>);
  if (entries.length > COMPANION_SDK_VERSION_MAX_ENTRIES) {
    throw companionRequestInvalid("sdkVersions has too many entries.");
  }

  for (const [, value] of entries) {
    if (typeof value !== "string" || value.length > COMPANION_METADATA_STRING_MAX_LENGTH) {
      throw companionRequestInvalid("sdkVersions must be an object of string values.");
    }
  }
}

export interface CompanionDeviceSyncResourceStatus {
  lastReceivedAt: string | null;
}

export interface CompanionDeviceSyncStatusResponse {
  lastDataReceivedAt: string | null;
  resources: Record<string, CompanionDeviceSyncResourceStatus>;
}

/**
 * Backend-confirmed sync evidence for the member's Junction connection,
 * sourced from existing read models only (no new persisted state):
 *
 * - Per-resource `lastReceivedAt` comes from durable webhook receipt signals
 *   (`device_sync_signal` rows with `kind: "webhook_hint"`, written once per
 *   durably accepted Junction webhook). The Junction resource name is parsed
 *   from the webhook event type (`daily.data.<resource>.*`); lifecycle events
 *   such as `provider.connection.created` carry no resource and are excluded.
 * - `lastDataReceivedAt` is the max of those per-resource receipt times, so it
 *   only reflects actual data webhooks, never connection lifecycle events.
 * - Resource keys additionally include resources Junction reports available
 *   for connected sources (`device_connection_source.resourceAvailabilitySummary`,
 *   projected by the reconcile floor), with `lastReceivedAt: null` until the
 *   first receipt, so the app can render honest "waiting for first data"
 *   states per resource.
 *
 * Known limits, accepted for the MVP status surface: Junction is
 * push-primary, so webhook receipts are the delivery evidence; data imported
 * by the pull floor alone does not advance these timestamps, and receipt
 * evidence is bounded to the most recent webhook signals. No health values
 * are ever included - timestamps and resource names only.
 */
export async function readCompanionDeviceSyncStatus(input: {
  memberId: string;
  store: PrismaDeviceSyncControlPlaneStore;
}): Promise<CompanionDeviceSyncStatusResponse> {
  const connections = (await input.store.listConnectionsForUser(input.memberId)).filter(
    (connection) =>
      connection.provider === COMPANION_DEVICE_SYNC_PROVIDER
      && connection.status !== "disconnected",
  );

  const resources: Record<string, CompanionDeviceSyncResourceStatus> = {};

  for (const connection of connections) {
    const sources = await input.store.listConnectionSources(connection.id);

    for (const source of sources) {
      // Only currently connected sources contribute "waiting for first data"
      // resource keys; stale availability on disconnected/errored sources
      // would otherwise advertise resources that cannot arrive.
      if (source.status !== "connected") {
        continue;
      }

      for (const [resource, availability] of Object.entries(source.resourceAvailabilitySummary ?? {})) {
        if (!isAvailableConnectionSourceResource(resource, availability)) {
          continue;
        }

        // Availability summaries carry Junction's raw resource keys (for
        // example `heart_rate`); normalize them with the same alias mapping
        // webhook receipts use so one resource never splits into two entries.
        const resourceName = normalizeJunctionResourceName(resource);
        if (!resourceName) {
          continue;
        }

        resources[resourceName] ??= { lastReceivedAt: null };
      }
    }
  }

  let lastDataReceivedAt: string | null = null;

  if (connections.length > 0) {
    const signals = await input.store.listRecentConnectionWebhookSignals({
      userId: input.memberId,
      connectionIds: connections.map((connection) => connection.id),
    });

    for (const signal of signals) {
      const resource = signal.eventType
        ? readJunctionWebhookResourceName(signal.eventType)
        : null;

      if (!resource) {
        continue;
      }

      const receivedAt = signal.createdAt;
      const entry = (resources[resource] ??= { lastReceivedAt: null });
      entry.lastReceivedAt = maxIsoTimestamp(entry.lastReceivedAt, receivedAt);
      lastDataReceivedAt = maxIsoTimestamp(lastDataReceivedAt, receivedAt);
    }
  }

  return {
    lastDataReceivedAt,
    resources,
  };
}

function maxIsoTimestamp(current: string | null, candidate: string | null): string | null {
  if (!candidate) {
    return current;
  }

  if (!current) {
    return candidate;
  }

  return Date.parse(candidate) > Date.parse(current) ? candidate : current;
}

function readOptionalBoundedString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string" || value.length > COMPANION_METADATA_STRING_MAX_LENGTH) {
    throw companionRequestInvalid(`${key} must be a short string when provided.`);
  }

  return value;
}

function companionRequestInvalid(message: string) {
  return deviceSyncError({
    code: "COMPANION_REQUEST_INVALID",
    message,
    retryable: false,
    httpStatus: 400,
  });
}
