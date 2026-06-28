import "server-only";

import {
  createHostedDeviceSyncDiagnosticControlPlane,
  runHostedDeviceSyncBackfillDiagnostic,
  type HostedDeviceSyncBackfillDiagnosticResponse,
} from "../device-sync/backfill-diagnostic";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import type {
  HostedOpsDiagnosticReadSummary,
  HostedOpsDiagnosticWindow,
  HostedOpsJunctionDiagnosticInput,
  HostedOpsJunctionDiagnosticResult,
  HostedOpsHistoricalPullSummary,
  HostedOpsIntrospectionSummary,
} from "./device-sync-diagnostic-types";

const DEFAULT_LOOKBACK_DAYS = 180;
const MAX_LOOKBACK_DAYS = 180;
const DEFAULT_TIMESERIES_PROBE_DAYS = 7;
const MAX_TIMESERIES_PROBE_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOSTED_OPS_DEVICE_SYNC_MEMBER_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,256}$/u;
const HOSTED_OPS_DEVICE_SYNC_CONNECTION_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,256}$/u;
const HOSTED_OPS_DEVICE_SYNC_SOURCE_PROVIDER_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/u;

export async function runHostedOpsJunctionDiagnostic(
  input: HostedOpsJunctionDiagnosticInput,
): Promise<HostedOpsJunctionDiagnosticResult> {
  const memberId = normalizeRequiredMemberId(input.memberId);
  const connectionId = normalizeOptionalConnectionId(input.connectionId);
  const sourceProvider = normalizeRequiredSourceProvider(input.sourceProvider);
  const window = resolveOpsDiagnosticWindow(input);
  const controlPlane = createHostedDeviceSyncDiagnosticControlPlane(input.request);
  const fullDiagnostic = await runHostedDeviceSyncBackfillDiagnostic({
    connectionId,
    controlPlane,
    memberId,
    providerName: "junction",
    restProbe: {
      endpoint: "matrix",
      resource: null,
      sourceProviderSlug: sourceProvider,
      timeoutSeconds: null,
    },
    timeseriesProbeDays: window.timeseriesDays,
    windowEnd: window.windowEnd,
    windowStart: window.windowStart,
  });

  return summarizeHostedOpsJunctionDiagnostic({
    fullDiagnostic,
    memberId,
    sourceProvider,
    window,
  });
}

function summarizeHostedOpsJunctionDiagnostic(input: {
  fullDiagnostic: HostedDeviceSyncBackfillDiagnosticResponse;
  memberId: string;
  sourceProvider: string;
  window: HostedOpsJunctionDiagnosticResult["window"];
}): HostedOpsJunctionDiagnosticResult {
  const diagnostic = input.fullDiagnostic.diagnostic;
  const summary = readRecord(diagnostic.summary);
  const timeseriesProbe = readRecord(diagnostic.timeseriesProbe);
  const sourceProviders = readRecord(diagnostic.sourceProviders);
  const matrix = summarizeMatrix(input.fullDiagnostic.restProbe?.result ?? null);
  const sources = input.fullDiagnostic.webSourceProjection.map((source) => ({
    firstSeenAt: source.firstSeenAt,
    lastSeenAt: source.lastSeenAt,
    resourceCount: source.resourceCount,
    sourceKey: source.sourceKey,
    status: source.status,
  }));

  return {
    backfill: {
      hasUsefulHistoricalRecords: readBoolean(summary?.hasUsefulHistoricalRecords),
      sourceProviderCount: readNumber(sourceProviders?.sourceProviderCount ?? sourceProviders?.recordCount),
      summaryResourceCount: readArray(summary?.resources)?.length ?? null,
      timeseriesProbeDays: readNumber(timeseriesProbe?.days),
      timeseriesResourceCount: readArray(timeseriesProbe?.resources)?.length ?? null,
      window: readWindow(diagnostic.window),
    },
    generatedAt: input.fullDiagnostic.generatedAt,
    matrix,
    memberId: input.memberId,
    ok: true,
    selectedConnection: {
      connectionMatchCount: input.fullDiagnostic.selectedConnection.connectionMatchCount,
      lastErrorCode: input.fullDiagnostic.selectedConnection.lastErrorCode,
      lastSyncCompletedAt: input.fullDiagnostic.selectedConnection.lastSyncCompletedAt,
      lastSyncErrorAt: input.fullDiagnostic.selectedConnection.lastSyncErrorAt,
      lastSyncStartedAt: input.fullDiagnostic.selectedConnection.lastSyncStartedAt,
      lastWebhookAt: input.fullDiagnostic.selectedConnection.lastWebhookAt,
      nextReconcileAt: input.fullDiagnostic.selectedConnection.nextReconcileAt,
      provider: input.fullDiagnostic.selectedConnection.provider,
      setupPhase: input.fullDiagnostic.selectedConnection.setupPhase,
      status: input.fullDiagnostic.selectedConnection.status,
    },
    sourceProvider: input.sourceProvider,
    webSourceProjection: {
      sourceCount: sources.length,
      sources,
      totalResourceCount: sources.reduce((total, source) => total + source.resourceCount, 0),
    },
    window: input.window,
  };
}

function summarizeMatrix(value: unknown): HostedOpsJunctionDiagnosticResult["matrix"] {
  const matrix = readRecord(value);
  if (!matrix) {
    return null;
  }

  const request = readRecord(matrix.request);
  const reads = readArray(matrix.reads)
    ?.map(summarizeMatrixRead)
    .filter((entry): entry is HostedOpsDiagnosticReadSummary => Boolean(entry))
    ?? [];

  return {
    historicalPull: summarizeHistoricalPullEntries(matrix.historicalPull),
    introspection: summarizeIntrospectionEntries(matrix.introspection),
    readCount: reads.length,
    reads,
    resourceCount: readNumber(request?.resourceCount),
    sourceFilteredReadCount: reads.filter((entry) => entry.sourceFiltered).length,
    window: readWindow(request?.window),
  };
}

function summarizeIntrospectionEntries(value: unknown): HostedOpsIntrospectionSummary[] {
  return readArray(value)
    ?.map((entry): HostedOpsIntrospectionSummary | null => {
      const record = readRecord(entry);
      const request = readRecord(record?.request);
      const response = readRecord(record?.response);
      if (!record || !response) {
        return null;
      }

      const resources = readArray(response.resources)
        ?.map((resourceEntry) => {
          const resource = readRecord(resourceEntry);
          const resourceName = readString(resource?.resource);
          if (!resourceName) {
            return null;
          }

          return {
            lastAttemptAt: readString(resource?.lastAttemptAt),
            lastAttemptStatus: readString(resource?.lastAttemptStatus),
            newestData: readString(resource?.newestData),
            oldestData: readString(resource?.oldestData),
            resource: resourceName,
            sentCount: readNumber(resource?.sentCount),
          };
        })
        .filter((resource): resource is HostedOpsIntrospectionSummary["resources"][number] => Boolean(resource))
        ?? [];

      return {
        ok: readBoolean(response.ok),
        resourceCount: readNumber(response.resourceCount),
        resources,
        responseStatus: readNumber(response.responseStatus),
        scope: readBoolean(request?.sourceFiltered) ? "selected_source" : "all_sources",
        sentCount: resources.reduce((total, resource) => total + (resource.sentCount ?? 0), 0),
        sourceProviderCount: readNumber(response.sourceProviderCount),
      };
    })
    .filter((entry): entry is HostedOpsIntrospectionSummary => Boolean(entry))
    ?? [];
}

function summarizeHistoricalPullEntries(value: unknown): HostedOpsHistoricalPullSummary[] {
  return readArray(value)
    ?.map((entry): HostedOpsHistoricalPullSummary | null => {
      const record = readRecord(entry);
      const request = readRecord(record?.request);
      const response = readRecord(record?.response);
      if (!record || !response) {
        return null;
      }

      const pulled = readArray(response.pulled)
        ?.map((pulledEntry) => {
          const resource = readRecord(pulledEntry);
          const resourceName = readString(resource?.resource);
          if (!resourceName) {
            return null;
          }

          return {
            daysWithData: readNumber(resource?.daysWithData),
            endedAt: readString(resource?.endedAt),
            hasErrorDetails: readBoolean(resource?.hasErrorDetails) ?? false,
            rangeEnd: readString(resource?.rangeEnd),
            rangeStart: readString(resource?.rangeStart),
            resource: resourceName,
            scheduledAt: readString(resource?.scheduledAt),
            startedAt: readString(resource?.startedAt),
            status: readString(resource?.status),
          };
        })
        .filter((resource): resource is HostedOpsHistoricalPullSummary["pulled"][number] => Boolean(resource))
        ?? [];
      const notPulledResources = readArray(response.notPulled)
        ?.map((notPulledEntry) => readString(readRecord(notPulledEntry)?.resource))
        .filter((resource): resource is string => Boolean(resource))
        ?? [];

      return {
        notPulledCount: readNumber(response.notPulledCount),
        notPulledResources,
        ok: readBoolean(response.ok),
        pulled,
        pulledCount: readNumber(response.pulledCount),
        responseStatus: readNumber(response.responseStatus),
        scope: readBoolean(request?.sourceFiltered) ? "selected_source" : "all_sources",
        sourceProviderCount: readNumber(response.sourceProviderCount),
      };
    })
    .filter((entry): entry is HostedOpsHistoricalPullSummary => Boolean(entry))
    ?? [];
}

function summarizeMatrixRead(value: unknown): HostedOpsDiagnosticReadSummary | null {
  const record = readRecord(value);
  const request = readRecord(record?.request);
  const response = readRecord(record?.response);
  if (!record || !request || !response) {
    return null;
  }

  return {
    configuredResource: readBoolean(request.configuredResource),
    errorCode: readString(response.errorCode),
    ok: readBoolean(response.ok),
    recordCount: readNumber(response.recordCount),
    resource: readString(request.resource),
    resourceCategory: readString(request.resourceCategory),
    responseStatus: readNumber(response.responseStatus),
    sourceFiltered: readBoolean(request.sourceFiltered) ?? false,
  };
}

function resolveOpsDiagnosticWindow(
  input: HostedOpsJunctionDiagnosticInput,
): HostedOpsJunctionDiagnosticResult["window"] {
  const lookbackDays = normalizePositiveInteger(input.lookbackDays, DEFAULT_LOOKBACK_DAYS, MAX_LOOKBACK_DAYS);
  const timeseriesDays = normalizePositiveInteger(
    input.timeseriesDays,
    DEFAULT_TIMESERIES_PROBE_DAYS,
    MAX_TIMESERIES_PROBE_DAYS,
  );
  const windowEnd = normalizeOptionalIso(input.windowEnd, "HOSTED_OPS_JUNCTION_DIAGNOSTIC_WINDOW_END_INVALID")
    ?? new Date().toISOString();
  const windowStart = normalizeOptionalIso(input.windowStart, "HOSTED_OPS_JUNCTION_DIAGNOSTIC_WINDOW_START_INVALID")
    ?? new Date(new Date(windowEnd).getTime() - (lookbackDays * DAY_MS)).toISOString();

  if (new Date(windowStart).getTime() >= new Date(windowEnd).getTime()) {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_JUNCTION_DIAGNOSTIC_WINDOW_INVALID",
      httpStatus: 400,
      message: "Junction diagnostic window start must be before window end.",
    });
  }

  return {
    lookbackDays,
    timeseriesDays,
    windowEnd,
    windowStart,
  };
}

function normalizeRequiredMemberId(value: string | null | undefined): string {
  const normalized = value?.trim() ?? "";
  if (!HOSTED_OPS_DEVICE_SYNC_MEMBER_ID_PATTERN.test(normalized)) {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_JUNCTION_DIAGNOSTIC_MEMBER_ID_INVALID",
      httpStatus: 400,
      message: "Junction diagnostics require a valid member id.",
    });
  }

  return normalized;
}

function normalizeRequiredSourceProvider(value: string | null | undefined): string {
  const normalized = value?.trim() ?? "";
  if (!HOSTED_OPS_DEVICE_SYNC_SOURCE_PROVIDER_PATTERN.test(normalized)) {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_JUNCTION_DIAGNOSTIC_SOURCE_PROVIDER_INVALID",
      httpStatus: 400,
      message: "Junction diagnostics require a valid source provider.",
    });
  }

  return normalized;
}

function normalizeOptionalConnectionId(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return null;
  }

  if (!HOSTED_OPS_DEVICE_SYNC_CONNECTION_ID_PATTERN.test(normalized)) {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_JUNCTION_DIAGNOSTIC_CONNECTION_ID_INVALID",
      httpStatus: 400,
      message: "Junction diagnostics require a valid connection id.",
    });
  }

  return normalized;
}

function normalizePositiveInteger(
  value: number | string | null | undefined,
  fallback: number,
  max: number,
): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number.parseInt(value, 10)
      : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.trunc(parsed), max);
}

function normalizeOptionalIso(value: string | null | undefined, code: string): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return null;
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw hostedOnboardingError({
      code,
      httpStatus: 400,
      message: "Junction diagnostic dates must be valid ISO timestamps.",
    });
  }

  return date.toISOString();
}

function readWindow(value: unknown): HostedOpsDiagnosticWindow | null {
  const record = readRecord(value);
  const windowStart = readString(record?.windowStart);
  const windowEnd = readString(record?.windowEnd);
  return windowStart && windowEnd ? { windowEnd, windowStart } : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
