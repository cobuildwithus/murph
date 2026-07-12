/**
 * Closed companion-only resource carried through the Junction device-sync
 * account. It is not a Junction API resource, so the provider handles it
 * before applying the configured Junction resource allowlist.
 *
 * Keep this module dependency-free because hosted-runtime identity helpers are
 * part of the runner's static boot closure.
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
