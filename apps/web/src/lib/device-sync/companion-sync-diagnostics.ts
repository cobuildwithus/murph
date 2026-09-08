import { deviceSyncError } from "@murphai/device-syncd/errors";
import type { HostedRuntimeLogEntry, HostedRuntimeRedactedJson } from "@murphai/hosted-execution/runtime-control";

export const COMPANION_SYNC_DIAGNOSTIC_EVENT = "device-sync.companion_diagnostic" as const;
export const COMPANION_SYNC_DIAGNOSTIC_BODY_LIMIT = 16 * 1024;
const triggers = [
  "launch", "foreground", "sync_requested", "manual_completed", "status_received",
  "status_failed", "session_unverified", "session_signed_out", "session_reset",
  "explicit_sign_out", "junction_identified", "junction_failed", "health_access_requested",
] as const;
const outcomes = ["none", "data_sent", "no_new_data", "needs_attention", "still_running"] as const;
const syncStates = [
  "deprioritized", "started", "read_chunk", "uploaded_chunk", "cancelled", "completed",
  "no_data", "error", "revalidating", "timed_out", "expected_error",
  "connection_paused", "connection_destroyed", "unknown",
] as const;
const keys = [
  "schemaVersion", "observedAt", "diagnosticSessionId", "appVersion", "appBuild", "osVersion",
  "trigger", "outcome", "sdkSignedIn", "connectionState", "syncPaused", "backgroundRefresh",
  "lowPowerMode", "protectedDataAvailable", "appState", "resourceCount", "resources",
] as const;
const resourceKeys = ["resource", "status", "startedAt", "endedAt", "dataCount", "background", "historical", "backgroundRefreshUnavailable", "lowPowerMode"] as const;
const resourceNames = [
  "workouts", "activity", "sleep", "body", "workout_stream", "sleep_stream", "profile",
  "blood_pressure", "blood_oxygen", "glucose", "heartrate", "heartrate_variability",
  "weight", "fat", "meal", "water", "caffeine", "mindfulness_minutes", "calories_active",
  "calories_basal", "distance", "floors_climbed", "steps", "respiratory_rate", "vo2_max",
  "stress", "electrocardiogram", "temperature", "menstrual_cycle", "heart_rate_alert",
  "afib_burden", "stand_hour", "stand_duration", "sleep_apnea_alert", "sleep_breathing_disturbance",
  "wheelchair_push", "forced_expiratory_volume_1", "forced_vital_capacity",
  "peak_expiratory_flow_rate", "inhaler_usage", "fall", "uv_exposure", "daylight_exposure",
  "handwashing", "basal_body_temperature", "heart_rate_recovery_one_minute", "unknown",
] as const;

/** Strict native observations, never health facts or client-selected member authority. */
export function parseCompanionSyncDiagnostic(value: unknown, now = new Date()): HostedRuntimeLogEntry {
  const body = object(value, keys);
  if (body.schemaVersion !== 1) invalid();
  const observedAt = timestamp(body.observedAt);
  // Phone time is evidence only. The indexed log timestamp is always server receipt time.
  if (Math.abs(Date.parse(observedAt) - now.getTime()) > 7 * 86_400_000) invalid();
  const resources = body.resources;
  if (!Array.isArray(resources) || resources.length > 16) invalid();
  const resourceCount = count(body.resourceCount, 256);
  if (resources.length > resourceCount) invalid();
  const redactedJson: HostedRuntimeRedactedJson = {
    schema: "murph.companion-sync-diagnostic.v1",
    evidenceOrigin: "client_observation",
    clientObservedAt: observedAt,
    diagnosticSessionId: text(body.diagnosticSessionId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u),
    appVersion: text(body.appVersion, /^\d{1,4}(?:\.\d{1,4}){1,3}$/u),
    appBuild: text(body.appBuild, /^\d{1,9}$/u),
    osVersion: text(body.osVersion, /^\d{1,4}(?:\.\d{1,4}){1,3}$/u),
    trigger: choice(body.trigger, triggers),
    outcome: choice(body.outcome, outcomes),
    sdkSignedIn: bool(body.sdkSignedIn),
    connectionState: choice(body.connectionState, ["connected", "auto_connect", "paused", "disconnected", "unknown"]),
    syncPaused: bool(body.syncPaused),
    backgroundRefresh: choice(body.backgroundRefresh, ["available", "denied", "restricted", "unknown"]),
    lowPowerMode: bool(body.lowPowerMode),
    protectedDataAvailable: bool(body.protectedDataAvailable),
    appState: choice(body.appState, ["active", "inactive", "background", "unknown"]),
    resourceCount,
    resourceSamplesTruncated: resources.length < resourceCount,
    // Closed SDK resource names and attempt metadata only; never HealthKit
    // object ids, sample dates, values, source devices or SDK error prose.
    companionSyncAttempts: resources.map((value) => {
      const resource = object(value, resourceKeys);
      return {
        resource: choice(resource.resource, resourceNames),
        status: choice(resource.status, syncStates),
        startedAt: timestamp(resource.startedAt),
        endedAt: resource.endedAt == null ? null : timestamp(resource.endedAt),
        dataCount: count(resource.dataCount, 100_000_000),
        background: bool(resource.background),
        historical: bool(resource.historical),
        backgroundRefreshUnavailable: bool(resource.backgroundRefreshUnavailable),
        lowPowerMode: bool(resource.lowPowerMode),
      };
    }),
  };
  return {
    at: now.toISOString(),
    component: "device-sync",
    phase: "fetch",
    eventCode: COMPANION_SYNC_DIAGNOSTIC_EVENT,
    level: "info",
    redactedJson,
  };
}

function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !allowed.includes(key))) invalid();
  return body;
}
function text(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || value.length > 64 || !pattern.test(value)) return invalid();
  return value;
}
function timestamp(value: unknown): string {
  const result = text(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u);
  if (!Number.isFinite(Date.parse(result))) invalid();
  return new Date(result).toISOString();
}
function choice(value: unknown, allowed: readonly string[]): string {
  if (typeof value !== "string" || !allowed.includes(value)) return invalid();
  return value;
}
function count(value: unknown, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max) return invalid();
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") return invalid();
  return value;
}
function invalid(): never {
  throw deviceSyncError({
    code: "COMPANION_DIAGNOSTIC_INVALID",
    message: "Sync diagnostics must use the supported metadata-only format.",
    httpStatus: 400,
    retryable: false,
  });
}
