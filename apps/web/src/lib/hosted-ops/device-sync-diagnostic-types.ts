export interface HostedOpsJunctionDiagnosticInput {
  connectionId?: string | null;
  lookbackDays?: number | string | null;
  memberId?: string | null;
  request: Request;
  sourceProvider?: string | null;
  timeseriesDays?: number | string | null;
  windowEnd?: string | null;
  windowStart?: string | null;
}

export interface HostedOpsJunctionDiagnosticResult {
  backfill: {
    hasUsefulHistoricalRecords: boolean | null;
    sourceProviderCount: number | null;
    summaryResourceCount: number | null;
    timeseriesProbeDays: number | null;
    timeseriesResourceCount: number | null;
    window: HostedOpsDiagnosticWindow | null;
  };
  generatedAt: string;
  matrix: {
    historicalPull: HostedOpsHistoricalPullSummary[];
    introspection: HostedOpsIntrospectionSummary[];
    readCount: number;
    reads: HostedOpsDiagnosticReadSummary[];
    resourceCount: number | null;
    sourceFilteredReadCount: number;
    window: HostedOpsDiagnosticWindow | null;
  } | null;
  memberId: string;
  ok: true;
  selectedConnection: {
    connectionMatchCount: number;
    lastErrorCode: string | null;
    lastSyncCompletedAt: string | null;
    lastSyncErrorAt: string | null;
    lastSyncStartedAt: string | null;
    lastWebhookAt: string | null;
    nextReconcileAt: string | null;
    provider: string;
    setupPhase: string | null;
    status: string;
  };
  sourceProvider: string;
  webSourceProjection: {
    sourceCount: number;
    sources: Array<{
      firstSeenAt: string;
      lastSeenAt: string;
      resourceCount: number;
      sourceKey: string;
      status: string;
    }>;
    totalResourceCount: number;
  };
  window: {
    lookbackDays: number;
    timeseriesDays: number;
    windowEnd: string;
    windowStart: string;
  };
}

export interface HostedOpsDiagnosticWindow {
  windowEnd: string;
  windowStart: string;
}

export interface HostedOpsIntrospectionSummary {
  ok: boolean | null;
  resourceCount: number | null;
  resources: Array<{
    lastAttemptAt: string | null;
    lastAttemptStatus: string | null;
    newestData: string | null;
    oldestData: string | null;
    resource: string;
    sentCount: number | null;
  }>;
  responseStatus: number | null;
  scope: "all_sources" | "selected_source";
  sentCount: number;
  sourceProviderCount: number | null;
}

export interface HostedOpsHistoricalPullSummary {
  notPulledCount: number | null;
  notPulledResources: string[];
  ok: boolean | null;
  pulled: Array<{
    daysWithData: number | null;
    endedAt: string | null;
    hasErrorDetails: boolean;
    rangeEnd: string | null;
    rangeStart: string | null;
    resource: string;
    scheduledAt: string | null;
    startedAt: string | null;
    status: string | null;
  }>;
  pulledCount: number | null;
  responseStatus: number | null;
  scope: "all_sources" | "selected_source";
  sourceProviderCount: number | null;
}

export interface HostedOpsDiagnosticReadSummary {
  configuredResource: boolean | null;
  errorCode: string | null;
  ok: boolean | null;
  recordCount: number | null;
  resource: string | null;
  resourceCategory: string | null;
  responseStatus: number | null;
  sourceFiltered: boolean;
}
