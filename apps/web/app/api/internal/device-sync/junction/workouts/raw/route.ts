import { JunctionClient } from "@murphai/device-syncd";
import { readConfiguredJunctionDeviceSyncProviderConfig } from "@murphai/device-syncd/config";
import { deviceSyncError } from "@murphai/device-syncd/errors";

import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/http";

const ENABLE_JUNCTION_RAW_WORKOUT_DIAGNOSTIC_ENV = "MURPH_ENABLE_JUNCTION_RAW_WORKOUT_DIAGNOSTIC";
const DEFAULT_LOOKBACK_DAYS = 14;
const MAX_LOOKBACK_DAYS = 90;
const DEFAULT_SOURCE_PROVIDER_SLUG = "whoop_v2";

export const GET = withJsonError(async (request: Request): Promise<Response> => {
  assertJunctionRawWorkoutDiagnosticAllowed(request);

  const config = readConfiguredJunctionDeviceSyncProviderConfig(process.env);
  if (!config) {
    throw deviceSyncError({
      code: "JUNCTION_DIAGNOSTIC_CONFIG_MISSING",
      message: "Junction diagnostic requires configured Junction credentials.",
      retryable: false,
      httpStatus: 503,
    });
  }

  const url = new URL(request.url);
  const window = resolveDiagnosticWindow(url.searchParams);
  const sourceProviderSlug = normalizeOptionalString(url.searchParams.get("sourceProviderSlug"))
    ?? DEFAULT_SOURCE_PROVIDER_SLUG;
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  const user = await controlPlane.requireAuthenticatedUser();
  const connections = await controlPlane.store.listConnectionsForUser(user.id);
  const connectionId = normalizeOptionalString(url.searchParams.get("connectionId"));
  const connection = connections.find((candidate) =>
    candidate.provider === "junction"
    && candidate.status !== "disconnected"
    && (!connectionId || candidate.id === connectionId)
  );

  if (!connection?.externalAccountId) {
    throw deviceSyncError({
      code: "JUNCTION_DIAGNOSTIC_CONNECTION_MISSING",
      message: "No active Junction connection is available for this user.",
      retryable: false,
      httpStatus: 404,
    });
  }

  const records = await new JunctionClient(config).listSummary({
    resource: "workouts",
    sourceProviderSlug,
    userId: connection.externalAccountId,
    windowEnd: window.end,
    windowStart: window.start,
  });

  return jsonOk({
    ok: true,
    diagnostic: "junction-workouts-raw",
    sourceProviderSlug,
    window,
    connection: {
      id: connection.id,
      provider: connection.provider,
      status: connection.status,
    },
    count: records.length,
    recordShapes: records.map(summarizeRecordShape),
    records,
  });
});

function assertJunctionRawWorkoutDiagnosticAllowed(request: Request): void {
  if (process.env[ENABLE_JUNCTION_RAW_WORKOUT_DIAGNOSTIC_ENV] !== "1") {
    throw deviceSyncError({
      code: "JUNCTION_DIAGNOSTIC_DISABLED",
      message: `Junction raw workout diagnostic is disabled. Set ${ENABLE_JUNCTION_RAW_WORKOUT_DIAGNOSTIC_ENV}=1 locally to enable it.`,
      retryable: false,
      httpStatus: 404,
    });
  }

  if (process.env.NODE_ENV === "production" || !isLocalhostRequest(request)) {
    throw deviceSyncError({
      code: "JUNCTION_DIAGNOSTIC_LOCAL_ONLY",
      message: "Junction raw workout diagnostic is only available on localhost outside production.",
      retryable: false,
      httpStatus: 404,
    });
  }
}

function isLocalhostRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function resolveDiagnosticWindow(searchParams: URLSearchParams): { start: string; end: string } {
  const now = new Date();
  const end = parseIsoDate(searchParams.get("end")) ?? now;
  const explicitStart = parseIsoDate(searchParams.get("start"));
  const days = clampLookbackDays(searchParams.get("days"));
  const start = explicitStart ?? new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

  if (start.getTime() > end.getTime()) {
    throw deviceSyncError({
      code: "JUNCTION_DIAGNOSTIC_INVALID_WINDOW",
      message: "Junction workout diagnostic start must be before end.",
      retryable: false,
      httpStatus: 400,
    });
  }
  if (end.getTime() - start.getTime() > MAX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000) {
    throw deviceSyncError({
      code: "JUNCTION_DIAGNOSTIC_WINDOW_TOO_LARGE",
      message: `Junction workout diagnostic window must be ${MAX_LOOKBACK_DAYS} days or less.`,
      retryable: false,
      httpStatus: 400,
    });
  }

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function parseIsoDate(value: string | null): Date | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return null;
  }

  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) {
    throw deviceSyncError({
      code: "JUNCTION_DIAGNOSTIC_INVALID_DATE",
      message: "Junction workout diagnostic dates must be valid ISO timestamps.",
      retryable: false,
      httpStatus: 400,
    });
  }

  return date;
}

function clampLookbackDays(value: string | null): number {
  const parsed = value ? Number(value) : DEFAULT_LOOKBACK_DAYS;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LOOKBACK_DAYS;
  }
  return Math.min(Math.floor(parsed), MAX_LOOKBACK_DAYS);
}

function summarizeRecordShape(record: unknown): {
  keys: string[];
  sportKeys: string[];
  sourceProviderSlug: string | null;
  sourceType: string | null;
} {
  const objectRecord = readPlainObject(record);
  const sport = readPlainObject(objectRecord?.sport);

  return {
    keys: objectRecord ? Object.keys(objectRecord).sort() : [],
    sportKeys: sport ? Object.keys(sport).sort() : [],
    sourceProviderSlug: normalizeOptionalString(objectRecord?.sourceProviderSlug),
    sourceType: normalizeOptionalString(objectRecord?.sourceType),
  };
}

function readPlainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
