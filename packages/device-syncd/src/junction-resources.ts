import { COMPANION_HRV_RMSSD_RESOURCE } from "@murphai/contracts";
import { normalizeJunctionResourceName } from "@murphai/importers/device-providers/junction-resources";
import { normalizeJunctionProviderSlug } from "./config/connect-routes.ts";

export { normalizeJunctionResourceName };
/** Exact Junction connection-source owner for companion WHOOP HRV uploads. */
export const JUNCTION_COMPANION_HRV_SOURCE_PROVIDER = "whoop_v2";
export const JUNCTION_COMPANION_HRV_OBSERVATION_INVALID_CODE =
  "JUNCTION_COMPANION_HRV_OBSERVATION_INVALID";
export const JUNCTION_CALENDAR_REFRESH_EMPTY_IDENTITY_INVALID_CODE =
  "JUNCTION_CALENDAR_REFRESH_EMPTY_IDENTITY_INVALID";
export const JUNCTION_CALENDAR_REFRESH_JOB_INVALID_CODE =
  "JUNCTION_CALENDAR_REFRESH_JOB_INVALID";
export {
  JUNCTION_COMPANION_HEALTH_METADATA_EVENT_TYPE,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_BATCH_BYTES,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_FUTURE_SKEW_MS,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_HISTORY_MS,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_RECORDS,
  JUNCTION_COMPANION_HEALTH_METADATA_RESOURCE,
  JUNCTION_COMPANION_HEALTH_METADATA_SCHEMA_VERSION,
  JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_PROVIDER,
  JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_TYPE,
} from "./companion-health-metadata.ts";
export {
  JunctionCompanionHealthMetadataParseError,
  parseJunctionCompanionHealthMetadataBatch,
  type JunctionCompanionHealthMetadataBatch,
  type JunctionCompanionHealthMetadataKind,
  type JunctionCompanionHealthMetadataRecord,
} from "./companion-health-metadata-parser.ts";

/**
 * Resolves the normalized Junction resource name carried by a webhook event
 * type such as `daily.data.sleep.created`. Lifecycle events such as
 * `provider.connection.created` carry no data resource and resolve to null.
 */
export function readJunctionWebhookResourceName(eventType: string): string | null {
  return normalizeJunctionResourceName(readJunctionWebhookResourceFromEventType(eventType));
}

export function isJunctionCompanionHrvRmssdJob(input: {
  kind?: string | null;
  payload?: Record<string, unknown> | null;
  provider?: string | null;
}): boolean {
  return input.provider === "junction"
    && input.kind === "resource"
    && input.payload?.resource === COMPANION_HRV_RMSSD_RESOURCE;
}

export function isJunctionSparseCalendarRefreshJob(input: {
  kind?: string | null;
  payload?: Record<string, unknown> | null;
  provider?: string | null;
}): boolean {
  return input.provider === "junction"
    && input.kind === "resource"
    && typeof input.payload?.calendarRefreshDay === "string";
}

export function isJunctionSparseCalendarRefreshPayloadValid(
  payload: Record<string, unknown> | null | undefined,
): boolean {
  const dayKey = payload?.calendarRefreshDay;
  const parsedDay = typeof dayKey === "string"
    ? new Date(`${dayKey}T00:00:00.000Z`)
    : null;
  const resource = normalizeJunctionResourceName(payload?.resource);
  return typeof dayKey === "string"
    && /^\d{4}-\d{2}-\d{2}$/u.test(dayKey)
    && parsedDay !== null
    && Number.isFinite(parsedDay.getTime())
    && parsedDay.toISOString().slice(0, 10) === dayKey
    && (resource === "caffeine" || resource === "water" || resource === "mindfulness_minutes")
    && normalizeJunctionProviderSlug(payload?.sourceProviderSlug) !== null;
}

export function isJunctionRetainedAcceptedWorkJob(input: {
  kind?: string | null;
  payload?: Record<string, unknown> | null;
  provider?: string | null;
}): boolean {
  return isJunctionCompanionHrvRmssdJob(input)
    || isJunctionSparseCalendarRefreshJob(input);
}

export function isJunctionSparseCalendarRefreshTerminalFailureCode(code: string): boolean {
  return code === JUNCTION_CALENDAR_REFRESH_JOB_INVALID_CODE
    || code === JUNCTION_CALENDAR_REFRESH_EMPTY_IDENTITY_INVALID_CODE;
}

function readJunctionWebhookResourceFromEventType(eventType: string): string | null {
  const parts = eventType.split(".").map((part) => part.trim()).filter(Boolean);
  const dataIndex = parts.indexOf("data");

  if (dataIndex >= 0 && parts[dataIndex + 1]) {
    return parts[dataIndex + 1] ?? null;
  }

  return null;
}
