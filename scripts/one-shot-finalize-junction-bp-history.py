from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


manifest_path = Path("packages/device-syncd/src/config/provider-manifests.ts")
manifest = manifest_path.read_text()
manifest = replace_once(
    manifest,
    '''      companionObservationJson: stringJobField({ includeInHostedHint: true }),
      eventType: stringJobField({ includeInHostedHint: true }),
''',
    '''      companionObservationJson: stringJobField({ includeInHostedHint: true }),
      emptyBackfillAttempts: numberJobField({ includeInHostedHint: true }),
      eventType: stringJobField({ includeInHostedHint: true }),
      historicalBackfill: booleanJobField({ includeInHostedHint: true }),
      historicalRecordsSeen: booleanJobField({ includeInHostedHint: true }),
      historicalWindowStart: stringJobField({ includeInHostedHint: true }),
''',
    "Junction resource manifest fields",
)
manifest_path.write_text(manifest)

source_path = Path("packages/device-syncd/src/providers/junction.ts")
source = source_path.read_text()

source = replace_once(
    source,
    '''interface JunctionTimeseriesImportResult {
  yieldedAt: string | null;
}
''',
    '''interface JunctionTimeseriesImportResult {
  yieldedAt: string | null;
}

interface JunctionPreciseTimeseriesImportResult extends JunctionTimeseriesImportResult {
  fetchComplete: boolean;
  recordCount: number;
}
''',
    "precise timeseries result type",
)

source = replace_once(
    source,
    '''const JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCES = Object.freeze([
  "blood_pressure",
] as const);
const JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCE_SET = new Set<string>(
  JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCES,
);
''',
    '''const JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCES = Object.freeze([
  "blood_pressure",
] as const);
const JUNCTION_EXTENDED_TIMESERIES_BACKFILL_POLICIES = Object.freeze({
  blood_pressure: {
    metadataKey: "junctionBloodPressureHistoryBackfillVersion",
    version: 1,
  },
} as const satisfies Record<
  (typeof JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCES)[number],
  { metadataKey: string; version: number }
>);
const JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCE_SET = new Set<string>(
  JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCES,
);
''',
    "extended timeseries policy",
)

source = replace_once(
    source,
    '''  function createScheduledJobs(
    account: StoredDeviceSyncAccount,
    now: string,
  ): ProviderScheduleResult {
    const scheduledHistoricalBackfillJobs = buildScheduledHistoricalBackfillJobs(account, now);
    const nextReconcileAt = resolveJunctionNextReconcileAt(
''',
    '''  function createScheduledJobs(
    account: StoredDeviceSyncAccount,
    now: string,
  ): ProviderScheduleResult {
    const scheduledHistoricalBackfillJobs = buildScheduledHistoricalBackfillJobs(account, now);
    const scheduledExtendedTimeseriesBackfillJobs =
      buildScheduledExtendedTimeseriesBackfillJobs(account, now);
    const nextReconcileAt = resolveJunctionNextReconcileAt(
''',
    "scheduled extended backfill declaration",
)
source = replace_once(
    source,
    '''        ...scheduledHistoricalBackfillJobs,
        ...buildPushSourceRecoveryJobs(account, now),
''',
    '''        ...scheduledHistoricalBackfillJobs,
        ...scheduledExtendedTimeseriesBackfillJobs,
        ...buildPushSourceRecoveryJobs(account, now),
''',
    "scheduled extended backfill jobs",
)

scheduled_anchor = '''  /**
   * A dead push carrier cannot recover on its own and no pull can rediscover
'''
scheduled_helper = '''  function buildScheduledExtendedTimeseriesBackfillJobs(
    account: StoredDeviceSyncAccount,
    now: string,
  ): DeviceSyncJobInput[] {
    const window = buildExtendedTimeseriesBackfillWindow(account.connectedAt);

    return extendedBackfillTimeseriesResources.flatMap((resource) => {
      const policy = resolveJunctionExtendedTimeseriesBackfillPolicy(resource);
      const storedVersion = policy ? account.metadata[policy.metadataKey] : null;
      if (
        !policy
        || (
          typeof storedVersion === "number"
          && Number.isSafeInteger(storedVersion)
          && storedVersion >= policy.version
        )
      ) {
        return [];
      }

      return [buildExtendedTimeseriesBackfillJob({
        availableAt: now,
        historicalWindowStart: window.windowStart,
        resource,
        sourceProviderSlug: null,
        windowEnd: window.windowEnd,
        windowStart: window.windowStart,
      })];
    });
  }

'''
source = replace_once(
    source,
    scheduled_anchor,
    scheduled_helper + scheduled_anchor,
    "scheduled extended backfill helper",
)

source = replace_once(
    source,
    '''  async function importTimeseriesPreciseSnapshots(
    context: ProviderJobContext,
    sourceProviders: readonly JunctionProviderConnection[],
    windowStart: string,
    windowEnd: string,
    skippedOptionalResources: JunctionSkippedOptionalResource[],
    resources: readonly string[],
    sourceProviderSlug?: string | null,
  ): Promise<JunctionTimeseriesImportResult> {
    const accumulatedTimeseries: Record<string, unknown[]> = {};
    let executionWindowEnd: string | null = null;
    let executionWindowStart: string | null = null;
    let yieldedAt: string | null = null;
''',
    '''  async function importTimeseriesPreciseSnapshots(
    context: ProviderJobContext,
    sourceProviders: readonly JunctionProviderConnection[],
    windowStart: string,
    windowEnd: string,
    skippedOptionalResources: JunctionSkippedOptionalResource[],
    resources: readonly string[],
    sourceProviderSlug?: string | null,
  ): Promise<JunctionPreciseTimeseriesImportResult> {
    const accumulatedTimeseries: Record<string, unknown[]> = {};
    let executionWindowEnd: string | null = null;
    let executionWindowStart: string | null = null;
    let fetchComplete = true;
    let yieldedAt: string | null = null;
''',
    "precise timeseries signature",
)

precise_start = source.index("  async function importTimeseriesPreciseSnapshots(")
precise_end = source.index("\n  async function importTimeseriesDailySnapshots(", precise_start)
precise = source[precise_start:precise_end]
precise = replace_once(
    precise,
    '''      if (context.shouldYield?.()) {
        yieldedAt = window.windowStart;
        break;
      }
''',
    '''      if (context.shouldYield?.()) {
        fetchComplete = false;
        yieldedAt = window.windowStart;
        break;
      }
''',
    "precise yield completeness",
)
precise = replace_once(
    precise,
    '''      if (skippedOptionalResources.length > skippedResourceCountBeforeFetch) {
        break;
      }
''',
    '''      if (skippedOptionalResources.length > skippedResourceCountBeforeFetch) {
        fetchComplete = false;
        break;
      }
''',
    "precise skipped completeness",
)
precise = replace_once(
    precise,
    '''    return {
      yieldedAt,
    };
''',
    '''    const recordCount = Object.values(dedupedTimeseries)
      .reduce((count, records) => count + records.length, 0);

    return {
      fetchComplete,
      recordCount,
      yieldedAt,
    };
''',
    "precise result fields",
)
source = source[:precise_start] + precise + source[precise_end:]

source = replace_once(
    source,
    '''  function buildYieldedJunctionJobResult(input: {
    context: ProviderJobContext;
    job: DeviceSyncJobRecord;
    timeseriesCursor?: string | null;
    windowEnd: string;
    windowStart: string;
  }): ProviderJobResult {
''',
    '''  function buildYieldedJunctionJobResult(input: {
    context: ProviderJobContext;
    historicalRecordsSeen?: boolean;
    job: DeviceSyncJobRecord;
    timeseriesCursor?: string | null;
    windowEnd: string;
    windowStart: string;
  }): ProviderJobResult {
''',
    "yielded result input",
)
source = replace_once(
    source,
    '''  function buildYieldedJunctionFollowUpJob(input: {
    job: DeviceSyncJobRecord;
    timeseriesCursor?: string | null;
    windowEnd: string;
    windowStart: string;
  }): DeviceSyncJobInput | null {
''',
    '''  function buildYieldedJunctionFollowUpJob(input: {
    historicalRecordsSeen?: boolean;
    job: DeviceSyncJobRecord;
    timeseriesCursor?: string | null;
    windowEnd: string;
    windowStart: string;
  }): DeviceSyncJobInput | null {
''',
    "yielded follow-up input",
)
source = replace_once(
    source,
    '''    const payload: Record<string, unknown> = {
      ...input.job.payload,
      windowEnd: input.windowEnd,
      windowStart: input.windowStart,
    };
    return {
      kind: "resource",
      payload,
      priority: input.job.priority,
      dedupeKey: sha256Text(JSON.stringify([
        "junction",
        "yield-follow-up",
        input.windowStart,
        input.windowEnd,
        normalizeString(payload.eventType),
        normalizeString(payload.objectId),
        normalizeString(payload.occurredAt),
        normalizeString(payload.resource),
        normalizeString(payload.resourceCategory),
        normalizeString(payload.sourceProviderSlug),
      ])),
    };
''',
    '''    const payload: Record<string, unknown> = {
      ...input.job.payload,
      ...(input.historicalRecordsSeen === undefined
        ? {}
        : { historicalRecordsSeen: input.historicalRecordsSeen }),
      windowEnd: input.windowEnd,
      windowStart: input.windowStart,
    };
    return {
      kind: "resource",
      payload,
      priority: input.job.priority,
      dedupeKey:
        buildJunctionExtendedTimeseriesBackfillDedupeKey(payload)
        ?? sha256Text(JSON.stringify([
          "junction",
          "yield-follow-up",
          input.windowStart,
          input.windowEnd,
          normalizeString(payload.eventType),
          normalizeString(payload.objectId),
          normalizeString(payload.occurredAt),
          normalizeString(payload.resource),
          normalizeString(payload.resourceCategory),
          normalizeString(payload.sourceProviderSlug),
        ])),
    };
''',
    "resource yield state and dedupe",
)

helper_anchor = '''  function withJunctionHistoricalCoverageVerification(
'''
extended_follow_up = '''  function withJunctionExtendedTimeseriesBackfillFollowUp(input: {
    context: ProviderJobContext;
    importResult: JunctionPreciseTimeseriesImportResult;
    job: DeviceSyncJobRecord;
    resource: string;
    result: ProviderJobResult;
    skippedOptionalResources: readonly JunctionSkippedOptionalResource[];
    window: { windowEnd: string; windowStart: string };
  }): ProviderJobResult {
    if (!isJunctionExtendedTimeseriesBackfillJob(input.job, input.resource)) {
      return input.result;
    }

    const sourceProviderSlug = normalizeProviderSlug(input.job.payload.sourceProviderSlug);
    const recordsSeen =
      input.job.payload.historicalRecordsSeen === true
      || input.importResult.recordCount > 0;
    const terminalOptionalFailure = input.skippedOptionalResources.some((entry) =>
      entry.resource === input.resource
      && (entry.reason === "not_found" || entry.reason === "unsupported")
    );

    if (
      terminalOptionalFailure
      || (input.importResult.fetchComplete && recordsSeen)
    ) {
      return withJunctionMetadataPatch(
        input.result,
        buildJunctionExtendedTimeseriesBackfillCompletionMetadataPatch(
          input.context,
          input.resource,
          sourceProviderSlug,
        ),
      );
    }

    const emptyBackfillAttempts =
      readHistoricalBackfillJobEmptyAttempts(input.job) + 1;
    const retryDelayMs =
      EMPTY_HISTORICAL_BACKFILL_RETRY_DELAYS_MS[emptyBackfillAttempts - 1]
      ?? null;
    if (retryDelayMs === null) {
      return withJunctionMetadataPatch(
        input.result,
        buildJunctionExtendedTimeseriesBackfillCompletionMetadataPatch(
          input.context,
          input.resource,
          sourceProviderSlug,
        ),
      );
    }

    const historicalWindowStart =
      toIsoTimestampIfValid(normalizeString(input.job.payload.historicalWindowStart))
      ?? input.window.windowStart;
    const retryAt = addMilliseconds(input.context.now, retryDelayMs);
    return {
      ...input.result,
      scheduledJobs: [
        ...(input.result.scheduledJobs ?? []),
        buildExtendedTimeseriesBackfillJob({
          availableAt: retryAt,
          emptyBackfillAttempts,
          historicalRecordsSeen: recordsSeen,
          historicalWindowStart,
          resource: input.resource,
          sourceProviderSlug,
          windowEnd: input.window.windowEnd,
          windowStart: input.window.windowStart,
        }),
      ],
    };
  }

  function buildJunctionExtendedTimeseriesBackfillCompletionMetadataPatch(
    context: ProviderJobContext,
    resource: string,
    sourceProviderSlug: string | null,
  ): Record<string, unknown> {
    if (sourceProviderSlug) {
      return {};
    }

    const policy = resolveJunctionExtendedTimeseriesBackfillPolicy(resource);
    if (!policy) {
      return {};
    }

    const existingVersion = context.account.metadata[policy.metadataKey];
    if (
      typeof existingVersion === "number"
      && Number.isSafeInteger(existingVersion)
      && existingVersion >= policy.version
    ) {
      return {};
    }

    return {
      [policy.metadataKey]: policy.version,
    };
  }

  function isJunctionExtendedTimeseriesBackfillJob(
    job: DeviceSyncJobRecord,
    resource: string,
  ): boolean {
    return job.kind === "resource"
      && job.payload.historicalBackfill === true
      && JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCE_SET.has(resource);
  }

'''
source = replace_once(
    source,
    helper_anchor,
    extended_follow_up + helper_anchor,
    "extended backfill completion and retry helper",
)

old_timeseries_branch = '''      if (inferredCategory === "timeseries") {
        const sourceProviders = await loadAndProjectSourceProviders();
        const timeseriesImport = await importTimeseriesPreciseSnapshots(
          context,
          sourceProviders,
          window.windowStart,
          window.windowEnd,
          skippedOptionalResources,
          [effectiveResource],
          sourceProviderSlug,
        );
        if (timeseriesImport.yieldedAt) {
          return withJunctionSkippedResourceMetadata(
            context,
            buildYieldedJunctionJobResult({
              context,
              job,
              windowEnd: window.windowEnd,
              windowStart: timeseriesImport.yieldedAt,
            }),
            skippedOptionalResources,
          );
        }
        return withJunctionHistoricalCoverageVerification(
          context,
          job,
          window,
          withJunctionSkippedResourceMetadata(
            context,
            {
              nextReconcileAt: clampWebhookJobNextReconcileAt(context),
            },
            skippedOptionalResources,
          ),
        );
      }
'''
new_timeseries_branch = '''      if (inferredCategory === "timeseries") {
        const sourceProviders = await loadAndProjectSourceProviders();
        const timeseriesImport = await importTimeseriesPreciseSnapshots(
          context,
          sourceProviders,
          window.windowStart,
          window.windowEnd,
          skippedOptionalResources,
          [effectiveResource],
          sourceProviderSlug,
        );
        const extendedHistoricalBackfill =
          isJunctionExtendedTimeseriesBackfillJob(job, effectiveResource);
        const historicalRecordsSeen = extendedHistoricalBackfill
          ? job.payload.historicalRecordsSeen === true
            || timeseriesImport.recordCount > 0
          : undefined;
        if (timeseriesImport.yieldedAt) {
          return withJunctionSkippedResourceMetadata(
            context,
            buildYieldedJunctionJobResult({
              context,
              historicalRecordsSeen,
              job,
              windowEnd: window.windowEnd,
              windowStart: timeseriesImport.yieldedAt,
            }),
            skippedOptionalResources,
          );
        }

        const result = withJunctionSkippedResourceMetadata(
          context,
          {
            nextReconcileAt: clampWebhookJobNextReconcileAt(context),
          },
          skippedOptionalResources,
        );
        return withJunctionHistoricalCoverageVerification(
          context,
          job,
          window,
          withJunctionExtendedTimeseriesBackfillFollowUp({
            context,
            importResult: timeseriesImport,
            job,
            resource: effectiveResource,
            result,
            skippedOptionalResources,
            window,
          }),
        );
      }
'''
source = replace_once(
    source,
    old_timeseries_branch,
    new_timeseries_branch,
    "timeseries resource execution",
)

block_pattern = re.compile(
    r'''  function buildExtendedTimeseriesBackfillJob\(input: \{.*?\n\}\n\nfunction buildInitialJobs\(.*?\n\}\n\nreturn \{''',
    re.S,
)
replacement = '''  function buildExtendedTimeseriesBackfillWindow(
    anchorAt: string,
  ): { windowEnd: string; windowStart: string } {
    const windowEnd = floorUtcDayTimestamp(anchorAt);
    return {
      windowEnd,
      windowStart: floorUtcDayTimestamp(
        subtractDays(windowEnd, extendedTimeseriesBackfillDays),
      ),
    };
  }

  function buildExtendedTimeseriesBackfillJob(input: {
    availableAt: string;
    emptyBackfillAttempts?: number;
    historicalRecordsSeen?: boolean;
    historicalWindowStart: string;
    resource: string;
    sourceProviderSlug: string | null;
    windowEnd: string;
    windowStart: string;
  }): DeviceSyncJobInput {
    const payload = {
      ...(input.emptyBackfillAttempts && input.emptyBackfillAttempts > 0
        ? { emptyBackfillAttempts: input.emptyBackfillAttempts }
        : {}),
      historicalBackfill: true,
      ...(input.historicalRecordsSeen
        ? { historicalRecordsSeen: true }
        : {}),
      historicalWindowStart: input.historicalWindowStart,
      resource: input.resource,
      resourceCategory: "timeseries",
      ...(input.sourceProviderSlug
        ? { sourceProviderSlug: input.sourceProviderSlug }
        : {}),
      windowEnd: input.windowEnd,
      windowStart: input.windowStart,
    } satisfies JunctionDeviceSyncJobPayloads["resource"];
    const dedupeKey =
      buildJunctionExtendedTimeseriesBackfillDedupeKey(payload);
    if (!dedupeKey) {
      throw new TypeError("Junction extended timeseries backfill identity was invalid.");
    }

    return {
      kind: "resource",
      payload,
      availableAt: input.availableAt,
      priority: JUNCTION_HISTORICAL_BACKFILL_PRIORITY,
      dedupeKey,
    };
  }

  function buildJunctionExtendedTimeseriesBackfillDedupeKey(
    payload: Record<string, unknown>,
  ): string | null {
    if (payload.historicalBackfill !== true) {
      return null;
    }

    const historicalWindowStart =
      toIsoTimestampIfValid(normalizeString(payload.historicalWindowStart));
    const resource = normalizeJunctionResourceName(payload.resource);
    const windowEnd = toIsoTimestampIfValid(normalizeString(payload.windowEnd));
    if (
      !historicalWindowStart
      || !resource
      || !windowEnd
      || !JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCE_SET.has(resource)
    ) {
      return null;
    }

    return sha256Text(JSON.stringify([
      "junction",
      "extended-timeseries-backfill",
      normalizeProviderSlug(payload.sourceProviderSlug),
      resource,
      historicalWindowStart,
      windowEnd,
    ]));
  }

  function resolveJunctionExtendedTimeseriesBackfillPolicy(
    resource: string,
  ): { metadataKey: string; version: number } | null {
    if (
      !Object.prototype.hasOwnProperty.call(
        JUNCTION_EXTENDED_TIMESERIES_BACKFILL_POLICIES,
        resource,
      )
    ) {
      return null;
    }

    return JUNCTION_EXTENDED_TIMESERIES_BACKFILL_POLICIES[
      resource as keyof typeof JUNCTION_EXTENDED_TIMESERIES_BACKFILL_POLICIES
    ];
  }

  function buildInitialJobs(
    now: string,
    sourceProviderSlug?: string | null,
  ): DeviceSyncJobInput[] {
    const normalizedSourceProviderSlug = normalizeProviderSlug(sourceProviderSlug);
    const payload = normalizedSourceProviderSlug
      ? { sourceProviderSlug: normalizedSourceProviderSlug }
      : undefined;
    const extendedWindow = buildExtendedTimeseriesBackfillWindow(now);
    return [
      buildWindowJob({
        kind: "backfill",
        now,
        payload,
        windowStart: subtractDays(now, summaryBackfillDays),
        priority: JUNCTION_HISTORICAL_BACKFILL_PRIORITY,
      }),
      ...extendedBackfillTimeseriesResources.map((resource) =>
        buildExtendedTimeseriesBackfillJob({
          availableAt: now,
          historicalWindowStart: extendedWindow.windowStart,
          resource,
          sourceProviderSlug: normalizedSourceProviderSlug,
          windowEnd: extendedWindow.windowEnd,
          windowStart: extendedWindow.windowStart,
        })
      ),
      buildWindowJob({
        kind: "reconcile",
        now,
        payload,
        windowStart: subtractDays(now, reconcileDays),
        priority: JUNCTION_SCHEDULED_RECONCILE_PRIORITY,
      }),
    ];
  }

  return {'''
source, count = block_pattern.subn(replacement, source, count=1)
if count != 1:
    raise RuntimeError(
        f"extended backfill builder block: expected one match, found {count}"
    )

source_path.write_text(source)

test_path = Path("packages/device-syncd/test/junction-blood-pressure-backfill.test.ts")
test_path.write_text(r'''import assert from "node:assert/strict";
import { test } from "vitest";

import { createJunctionDeviceSyncProvider } from "../src/providers/junction.ts";
import { createJsonResponse, readUrl, requireValue } from "./helpers.ts";

import type {
  DeviceSyncAccount,
  DeviceSyncJobInput,
  DeviceSyncJobRecord,
  ProviderJobContext,
  StoredDeviceSyncAccount,
} from "../src/types.ts";

const NOW = "2026-06-11T12:00:00.000Z";
const SAME_DAY_LATER = "2026-06-11T18:00:00.000Z";
const BACKFILL_WINDOW_END = "2026-06-11T00:00:00.000Z";
const BP_HISTORY_VERSION_KEY = "junctionBloodPressureHistoryBackfillVersion";

interface TimeseriesRequest {
  end: string | null;
  resource: string;
  start: string | null;
}

function createAccount(input: {
  connectedAt?: string;
  metadata?: Record<string, unknown>;
  now?: string;
} = {}): DeviceSyncAccount {
  const now = input.now ?? NOW;
  return {
    id: "acct-junction-bp-1",
    provider: "junction",
    externalAccountId: "junction-user-1",
    disconnectGeneration: 0,
    credential: {
      kind: "provider_config",
      providerConfigKey: "junction",
      credentialMetadata: {},
    },
    displayName: "Junction",
    status: "active",
    scopes: [],
    accessTokenExpiresAt: null,
    metadata: input.metadata ?? {},
    connectedAt: input.connectedAt ?? NOW,
    lastWebhookAt: null,
    lastSyncStartedAt: null,
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextReconcileAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function createStoredAccount(input: {
  connectedAt?: string;
  metadata?: Record<string, unknown>;
} = {}): StoredDeviceSyncAccount {
  return {
    ...createAccount(input),
    hostedObservedConnectionRevision: 0,
    hostedObservedTokenRevision: 0,
    hostedObservedTokenVersion: null,
    hostedObservedUpdatedAt: null,
    localConnectionRevision: 0,
    localTokenRevision: 0,
  };
}

function toJobRecord(input: DeviceSyncJobInput, index: number): DeviceSyncJobRecord {
  return {
    id: `job-${index}`,
    provider: "junction",
    accountId: "acct-junction-bp-1",
    kind: input.kind,
    payload: input.payload ?? {},
    priority: input.priority ?? 0,
    availableAt: input.availableAt ?? NOW,
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 5,
    dedupeKey: input.dedupeKey ?? null,
    status: "queued",
    leaseOwner: null,
    leaseExpiresAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: NOW,
    updatedAt: NOW,
    startedAt: null,
    finishedAt: null,
  };
}

function createJobContext(input: {
  account?: DeviceSyncAccount;
  importedSnapshots?: unknown[];
  now?: string;
  shouldYield?: () => boolean;
} = {}): ProviderJobContext {
  const account = input.account ?? createAccount();
  return {
    account,
    now: input.now ?? NOW,
    importSnapshot: async (snapshot) => {
      input.importedSnapshots?.push(snapshot);
      return { imported: true };
    },
    upsertConnectionSource: (sourceInput) => ({
      id: "src-1",
      connectionId: account.id,
      ...sourceInput,
      displayName: sourceInput.displayName ?? null,
      resourceAvailabilitySummary: sourceInput.resourceAvailabilitySummary ?? {},
      lastErrorCode: sourceInput.lastErrorCode ?? null,
      lastErrorMessage: sourceInput.lastErrorMessage ?? null,
      firstSeenAt: sourceInput.firstSeenAt ?? sourceInput.lastSeenAt,
      lastDataAt: sourceInput.lastDataAt ?? null,
      createdAt: sourceInput.lastSeenAt,
      updatedAt: sourceInput.lastSeenAt,
    }),
    refreshAccountTokens: async () => account,
    ...(input.shouldYield ? { shouldYield: input.shouldYield } : {}),
    logger: {},
  };
}

function createProvider(input: {
  bloodPressureRecords?: readonly Record<string, unknown>[];
  requests: TimeseriesRequest[];
  timeseriesBackfillDays?: number;
}) {
  return createJunctionDeviceSyncProvider({
    apiKey: "sk_us_test_123",
    clientUserIdSecret: "junction-client-user-id-secret",
    environment: "sandbox",
    region: "us",
    summaryResources: ["activity"],
    summaryBackfillDays: 30,
    timeseriesResources: ["blood_pressure", "stress_level"],
    ...(input.timeseriesBackfillDays === undefined
      ? {}
      : { timeseriesBackfillDays: input.timeseriesBackfillDays }),
    fetchImpl: async (request) => {
      const url = new URL(readUrl(request));

      if (url.pathname.includes("/v2/user/resolve/")) {
        return createJsonResponse({ user_id: "junction-user-1" });
      }
      if (url.pathname === "/v2/user/providers/junction-user-1") {
        return createJsonResponse({
          providers: [{
            id: "provider-omron-1",
            slug: "omron",
            name: "Omron",
            status: "connected",
            resource_availability: {
              activity: true,
              blood_pressure: true,
              stress_level: true,
            },
          }],
        });
      }
      if (url.pathname === "/v2/summary/activity/junction-user-1") {
        return createJsonResponse({ data: [] });
      }
      if (url.pathname === "/v2/introspect/historical_pull") {
        return createJsonResponse({ data: [] });
      }
      const timeseriesPrefix = "/v2/timeseries/junction-user-1/";
      if (url.pathname.startsWith(timeseriesPrefix)) {
        const resource = url.pathname
          .slice(timeseriesPrefix.length)
          .replace(/\/grouped$/u, "");
        input.requests.push({
          end: url.searchParams.get("end_date"),
          resource,
          start: url.searchParams.get("start_date"),
        });
        const records = resource === "blood_pressure"
          ? [...(input.bloodPressureRecords ?? [])]
          : [];
        return createJsonResponse(
          records.length > 0
            ? { groups: { omron: [{ data: records }] } }
            : { groups: {} },
        );
      }

      throw new Error(`Unexpected request: ${url.toString()}`);
    },
  });
}

function findBloodPressureJob(jobs: readonly DeviceSyncJobInput[]): DeviceSyncJobInput {
  return requireValue(jobs.find((job) =>
    job.kind === "resource"
    && job.payload?.resource === "blood_pressure"
  ));
}

test("Junction gives sparse blood pressure its own full-history resumable job", async () => {
  const requests: TimeseriesRequest[] = [];
  const provider = createProvider({ requests });
  const connection = await requireValue(provider.sdkConnectionHandler).ensureConnection({
    ownerId: "member-1",
    now: NOW,
  });
  const jobs = connection.initialJobs ?? [];
  const backfill = requireValue(jobs.find((job) => job.kind === "backfill"));
  const bloodPressure = findBloodPressureJob(jobs);

  assert.equal(bloodPressure.availableAt, NOW);
  assert.deepEqual(bloodPressure.payload, {
    historicalBackfill: true,
    historicalWindowStart: "2026-05-12T00:00:00.000Z",
    resource: "blood_pressure",
    resourceCategory: "timeseries",
    windowStart: "2026-05-12T00:00:00.000Z",
    windowEnd: BACKFILL_WINDOW_END,
  });

  const executor = requireValue(provider.jobExecutor);
  await executor.executeJob(createJobContext(), toJobRecord(backfill, 1));
  const boundedRequests = [...requests];
  assert.equal(boundedRequests.length, 14);
  assert.equal(
    boundedRequests.every((request) => request.resource === "stress_level"),
    true,
  );
  assert.equal(
    boundedRequests.some((request) => request.resource === "blood_pressure"),
    false,
  );

  const result = await executor.executeJob(
    createJobContext(),
    toJobRecord(bloodPressure, 2),
  );
  const bloodPressureRequests = requests.filter(
    (request) => request.resource === "blood_pressure",
  );
  assert.equal(bloodPressureRequests.length, 30);
  assert.equal(
    bloodPressureRequests[0]?.start,
    "2026-05-12T00:00:00.000Z",
  );
  assert.equal(bloodPressureRequests.at(-1)?.end, BACKFILL_WINDOW_END);
  const retry = findBloodPressureJob(result.scheduledJobs ?? []);
  assert.equal(retry.availableAt, "2026-06-11T12:15:00.000Z");
  assert.equal(retry.payload?.emptyBackfillAttempts, 1);
  assert.equal(retry.payload?.historicalWindowStart, "2026-05-12T00:00:00.000Z");
});

test("empty blood-pressure history retries are bounded and mark account-wide coverage terminal", async () => {
  const provider = createProvider({ requests: [] });
  const connection = await requireValue(provider.sdkConnectionHandler).ensureConnection({
    ownerId: "member-1",
    now: NOW,
  });
  const bloodPressure = findBloodPressureJob(connection.initialJobs ?? []);
  const exhausted = {
    ...bloodPressure,
    payload: {
      ...bloodPressure.payload,
      emptyBackfillAttempts: 4,
    },
  };
  const result = await requireValue(provider.jobExecutor).executeJob(
    createJobContext(),
    toJobRecord(exhausted, 1),
  );

  assert.equal(result.scheduledJobs?.length ?? 0, 0);
  assert.equal(result.metadataPatch?.[BP_HISTORY_VERSION_KEY], 1);
});

test("a source-scoped terminal pass does not suppress the account-wide migration", async () => {
  const provider = createProvider({ requests: [] });
  const connection = await requireValue(provider.sdkConnectionHandler).ensureConnection({
    ownerId: "member-1",
    now: NOW,
  });
  const bloodPressure = findBloodPressureJob(connection.initialJobs ?? []);
  const sourceScoped = {
    ...bloodPressure,
    payload: {
      ...bloodPressure.payload,
      emptyBackfillAttempts: 4,
      sourceProviderSlug: "omron",
    },
  };
  const result = await requireValue(provider.jobExecutor).executeJob(
    createJobContext(),
    toJobRecord(sourceScoped, 1),
  );

  assert.equal(result.scheduledJobs?.length ?? 0, 0);
  assert.equal(result.metadataPatch?.[BP_HISTORY_VERSION_KEY], undefined);
});

test("an existing account receives one account-wide migration anchored to its connection window", () => {
  const provider = createProvider({ requests: [] });
  const createScheduledJobs = requireValue(
    requireValue(provider.jobExecutor).createScheduledJobs,
  );
  const connectedAt = "2026-04-20T17:45:00.000Z";
  const scheduled = createScheduledJobs(
    createStoredAccount({ connectedAt }),
    NOW,
  );
  const bloodPressure = findBloodPressureJob(scheduled.jobs);

  assert.equal(bloodPressure.availableAt, NOW);
  assert.equal(bloodPressure.payload?.historicalWindowStart, "2026-03-21T00:00:00.000Z");
  assert.equal(bloodPressure.payload?.windowStart, "2026-03-21T00:00:00.000Z");
  assert.equal(bloodPressure.payload?.windowEnd, "2026-04-20T00:00:00.000Z");

  const completed = createScheduledJobs(
    createStoredAccount({
      connectedAt,
      metadata: { [BP_HISTORY_VERSION_KEY]: 1 },
    }),
    NOW,
  );
  assert.equal(
    completed.jobs.some((job) =>
      job.kind === "resource"
      && job.payload?.resource === "blood_pressure"
    ),
    false,
  );
});

test("a fetched blood-pressure record completes without an empty retry", async () => {
  const provider = createProvider({
    bloodPressureRecords: [{
      id: "bp-1",
      timestamp: "2026-05-20T08:30:00.000Z",
      systolic: 121,
      diastolic: 79,
    }],
    requests: [],
  });
  const connection = await requireValue(provider.sdkConnectionHandler).ensureConnection({
    ownerId: "member-1",
    now: NOW,
  });
  const result = await requireValue(provider.jobExecutor).executeJob(
    createJobContext(),
    toJobRecord(findBloodPressureJob(connection.initialJobs ?? []), 1),
  );

  assert.equal(result.scheduledJobs?.length ?? 0, 0);
  assert.equal(result.metadataPatch?.[BP_HISTORY_VERSION_KEY], 1);
});

test("ordinary empty webhook fetches do not enter the historical retry ladder", async () => {
  const provider = createProvider({ requests: [] });
  const webhookJob: DeviceSyncJobInput = {
    kind: "resource",
    payload: {
      eventType: "daily.data.blood_pressure.created",
      objectId: "bp-webhook-1",
      occurredAt: NOW,
      resource: "blood_pressure",
      resourceCategory: "timeseries",
      windowStart: "2026-06-10T00:00:00.000Z",
      windowEnd: BACKFILL_WINDOW_END,
    },
    priority: 65,
  };
  const result = await requireValue(provider.jobExecutor).executeJob(
    createJobContext(),
    toJobRecord(webhookJob, 1),
  );

  assert.equal(result.scheduledJobs?.length ?? 0, 0);
  assert.equal(result.metadataPatch?.[BP_HISTORY_VERSION_KEY], undefined);
});

test("yielded blood-pressure history keeps one durable identity and remembers earlier records", async () => {
  const provider = createProvider({
    bloodPressureRecords: [{
      id: "bp-first-day",
      timestamp: "2026-05-12T08:30:00.000Z",
      systolic: 118,
      diastolic: 76,
    }],
    requests: [],
  });
  const connection = await requireValue(provider.sdkConnectionHandler).ensureConnection({
    ownerId: "member-1",
    now: NOW,
  });
  const bloodPressure = findBloodPressureJob(connection.initialJobs ?? []);
  let yieldChecks = 0;
  const result = await requireValue(provider.jobExecutor).executeJob(
    createJobContext({
      shouldYield: () => {
        yieldChecks += 1;
        return yieldChecks > 1;
      },
    }),
    toJobRecord(bloodPressure, 1),
  );
  const followUp = findBloodPressureJob(result.scheduledJobs ?? []);

  assert.equal(followUp.dedupeKey, bloodPressure.dedupeKey);
  assert.equal(followUp.payload?.historicalRecordsSeen, true);
  assert.equal(
    followUp.payload?.historicalWindowStart,
    "2026-05-12T00:00:00.000Z",
  );
  assert.equal(followUp.payload?.windowStart, "2026-05-13T00:00:00.000Z");
  assert.equal(followUp.payload?.windowEnd, BACKFILL_WINDOW_END);
});

test("same-day SDK ensures coalesce to one blood-pressure history identity", async () => {
  const provider = createProvider({ requests: [] });
  const sdk = requireValue(provider.sdkConnectionHandler);
  const first = await sdk.ensureConnection({
    ownerId: "member-1",
    now: NOW,
  });
  const second = await sdk.ensureConnection({
    ownerId: "member-1",
    now: SAME_DAY_LATER,
  });
  const firstBloodPressure = findBloodPressureJob(first.initialJobs ?? []);
  const secondBloodPressure = findBloodPressureJob(second.initialJobs ?? []);

  assert.equal(firstBloodPressure.dedupeKey, secondBloodPressure.dedupeKey);
  assert.deepEqual(firstBloodPressure.payload, secondBloodPressure.payload);
  assert.equal(firstBloodPressure.availableAt, NOW);
  assert.equal(secondBloodPressure.availableAt, SAME_DAY_LATER);
});

test("an explicit Junction timeseries backfill window still governs blood pressure", async () => {
  const provider = createProvider({
    requests: [],
    timeseriesBackfillDays: 5,
  });
  const connection = await requireValue(provider.sdkConnectionHandler).ensureConnection({
    ownerId: "member-1",
    now: NOW,
  });
  const bloodPressure = findBloodPressureJob(connection.initialJobs ?? []);

  assert.equal(bloodPressure.payload?.windowStart, "2026-06-06T00:00:00.000Z");
  assert.equal(bloodPressure.payload?.windowEnd, BACKFILL_WINDOW_END);
});
''')
