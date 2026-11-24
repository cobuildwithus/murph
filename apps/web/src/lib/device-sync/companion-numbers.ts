import "server-only";

import { isCloudflareHostedControlBrowserVaultReplicaNotFoundError } from "@murphai/cloudflare-hosted-control/client";
import { addDaysToIsoDate, toLocalDayKey } from "@murphai/contracts";
import { isManualMetricSource, normalizeMetricValue, resolveMetricDefinition, selectMetricWindowComparison } from "@murphai/health-metrics";
import { assessBrowserVaultReplicaFreshness } from "@murphai/hosted-execution";
import { HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_SPECS } from "@murphai/hosted-execution/vault-share";
import { parseHostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/parsers";
import { getBrowserVaultMetricBucketId, type BrowserVaultMetricSeriesCapableQueryClient } from "@murphai/query/browser-replica-client";
import { generateHostedUserRecipientKeyPair } from "@murphai/runtime-state";

import { assertHostedNativeMemberAuthCurrentTx, type HostedNativeMemberAuth } from "../better-auth/native-auth";
import { assertBrowserVaultMemberAuthority } from "../browser-vault/authority";
import { decodeReadyBrowserVaultSession, parseBrowserVaultSessionResponse } from "../browser-vault/loader";
import { readHostedExecutionControlClientIfConfigured } from "../hosted-execution/control";
import { hostedOnboardingError, isHostedOnboardingError } from "../hosted-onboarding/errors";
import { requireActiveHostedMemberAuthFromBearerToken } from "../hosted-onboarding/request-auth";
import { readHostedBrowserVaultReplicaState } from "../hosted-workspace/store";
import { getPrisma } from "../prisma";
import { lastSettledStepDay } from "../settled-step-day";
import { describeCompanionProjectionFailure } from "./companion-projection-failure";

export const COMPANION_HEALTH_METRICS = {
  restingHeartRate: { key: "resting-heart-rate", unit: "bpm", precision: 0 },
  sleep: { key: "total-sleep-minutes", unit: "minutes", precision: 0 },
  steps: { key: "steps", unit: "steps", precision: 0 },
  vo2Max: { key: "estimated-vo2-max", unit: "ml/kg/min", precision: 1 },
} as const;
type MetricId = keyof typeof COMPANION_HEALTH_METRICS;
const allMetrics = Object.keys(COMPANION_HEALTH_METRICS) as MetricId[];
type ReplicaState = Awaited<ReturnType<typeof readHostedBrowserVaultReplicaState>>;
const requestedShards = ["core", "metricsIndex"] as const;
const noBody = { heightCm: null, weightKg: null } as const;
const emptyNumbers = { numbers: null, demographics: null, ...noBody, freshness: "stale" } as const;

// The stage reaches route logs as the error cause, never the response body.
function numbersUnavailable(stage: string) {
  return hostedOnboardingError({
    cause: stage, code: "NUMBERS_PROJECTION_UNAVAILABLE", httpStatus: 503, retryable: true,
    message: "Saved numbers are temporarily unavailable.",
  });
}

export async function readCompanionNumbers(request: Request) {
  const prisma = getPrisma();
  const auth = await requireActiveHostedMemberAuthFromBearerToken(request, prisma);
  if (new URL(request.url).searchParams.size !== 0) {
    throw hostedOnboardingError({
      code: "NUMBERS_INVALID_REQUEST", httpStatus: 400,
      message: "Numbers does not accept query parameters.",
    });
  }
  const snapshot = await readCompanionHealthSeries(auth, request.signal);
  if (!snapshot) return emptyNumbers;
  const { timeZone, savedAt, freshness, window, demographics, heightCm, weightKg, numbers } = snapshot;
  const baselineFrom = addDaysToIsoDate(window.through, -89);
  return {
    timeZone, savedAt, freshness, window, demographics, heightCm, weightKg,
    numbers: {
      restingHeartRate: presentNumber(numbers.restingHeartRate, COMPANION_HEALTH_METRICS.restingHeartRate, window, baselineFrom),
      sleep: presentNumber(numbers.sleep, COMPANION_HEALTH_METRICS.sleep, window, baselineFrom),
      steps: presentNumber(numbers.steps, COMPANION_HEALTH_METRICS.steps, snapshot.stepsWindow, baselineFrom),
      vo2Max: presentNumber(numbers.vo2Max, COMPANION_HEALTH_METRICS.vo2Max, window, baselineFrom),
    },
  };
}

/** Shared authority-checked input. Values retain canonical units and precision. */
export async function readCompanionHealthSeries(
  auth: HostedNativeMemberAuth, signal: AbortSignal, requestedMetrics?: readonly MetricId[], replicaState?: ReplicaState,
) {
  const metrics = requestedMetrics ?? allMetrics;
  const prisma = getPrisma();
  await assertBrowserVaultMemberAuthority({ memberId: auth.member.id, prisma });
  const snapshot = await loadSavedNumbers(auth.member.id, signal, metrics, replicaState);
  // Ciphertext I/O cannot preserve access after session, access or consent loss.
  await assertHostedNativeMemberAuthCurrentTx(auth, prisma);
  await assertBrowserVaultMemberAuthority({ memberId: auth.member.id, prisma });
  if (!snapshot) return null;
  const { client, freshness } = snapshot;
  // Null means unknown (an older replica, or memory unread): the app falls
  // back to the phone. Never the revision or any memory text.
  const projected = client.replica.demographics;
  const demographics = projected ? {
    birthYear: projected.birthYear, birthYearPrecision: projected.birthYearPrecision,
    biologicalSex: projected.biologicalSex, status: projected.status,
  } : null;
  // Core already carries the canonical vault zone, even when there are no meals.
  const timeZone = client.replica.meals?.timeZone;
  if (!timeZone) throw numbersUnavailable("replica_timezone_missing");
  const now = new Date();
  const through = toLocalDayKey(now, timeZone);
  // Charts reach back a year, all the saved replica keeps. The change still
  // counts from the first week of the last 90 days.
  const window = { from: addDaysToIsoDate(through, -364), through };
  const stepsWindow = { ...window, through: lastSettledStepDay(now, timeZone) };
  const numbers: Record<MetricId, RawHealthNumber | null> = { restingHeartRate: null, sleep: null, steps: null, vo2Max: null };
  for (const id of metrics) {
    numbers[id] = readRawHealthNumber(client, COMPANION_HEALTH_METRICS[id], id === "steps" ? stepsWindow : window);
  }
  return {
    timeZone, savedAt: client.replica.generatedAt, freshness, window, stepsWindow,
    demographics, ...(requestedMetrics ? noBody : readCompanionBody(client)), numbers,
    // Null: a replica built before run days shipped. Unknown, never zero.
    runs: client.replica.runs ?? null,
  };
}

export type CompanionBody = { heightCm: number | null; weightKg: number | null };

/** Canonical latest-valid selections, in cm and kg. They stand until replaced, however old. */
export function readCompanionBody(client: Pick<BrowserVaultMetricSeriesCapableQueryClient, "metricSelections">): CompanionBody {
  return {
    heightCm: client.metricSelections.get("body-height")?.value ?? null,
    weightKg: client.metricSelections.get("body-weight")?.value ?? null,
  };
}

/** A height-and-weight-only consumer of the same saved replica and health authority. */
export async function readSavedCompanionBody(memberId: string, signal: AbortSignal): Promise<CompanionBody> {
  const prisma = getPrisma();
  await assertBrowserVaultMemberAuthority({ memberId, prisma });
  const snapshot = await loadSavedNumbers(memberId, signal);
  await assertBrowserVaultMemberAuthority({ memberId, prisma });
  return snapshot ? readCompanionBody(snapshot.client) : noBody;
}

async function loadSavedNumbers(memberId: string, signal: AbortSignal, metrics: readonly MetricId[] = allMetrics, replicaState?: ReplicaState) {
  try {
    const workspace = replicaState === undefined ? await readHostedBrowserVaultReplicaState({ userId: memberId }) : replicaState;
    const replicaRef = parseHostedBrowserVaultReplicaRef(workspace?.browserVaultReplicaRef ?? null, "Companion numbers replica");
    if (!replicaRef) return null;
    const control = readHostedExecutionControlClientIfConfigured();
    if (!control) throw numbersUnavailable("control_unconfigured");
    const requestedMetricBuckets = [...new Set(await Promise.all(
      metrics.map(id => getBrowserVaultMetricBucketId(COMPANION_HEALTH_METRICS[id].key)),
    ))].sort();
    const keys = await generateHostedUserRecipientKeyPair();
    const session = parseBrowserVaultSessionResponse({
      ...await control.createBrowserVaultSession({
        browserPublicKeyJwk: keys.publicKeyJwk, replicaRef, requestedShards, requestedMetricBuckets, userId: memberId,
      }),
      freshness: assessBrowserVaultReplicaFreshness({ now: new Date().toISOString(), replicaRef }).freshness,
      refreshPending: false,
      deviceSyncImportPending: false,
      workspaceVersion: workspace?.version ?? null,
    });
    if (session.state !== "ready") return null;
    const loaded = await decodeReadyBrowserVaultSession({
      session, privateKeyJwk: keys.privateKeyJwk, expectedMemberId: memberId,
      requestedShards, requestedMetricBuckets, signal,
    });
    if (!("metrics" in loaded.client)) throw numbersUnavailable("replica_metrics_missing");
    return { client: loaded.client, freshness: session.freshness };
  } catch (error) {
    if (isCloudflareHostedControlBrowserVaultReplicaNotFoundError(error)) return null;
    // Keep this read's own stage; every other failure stays a retryable 503.
    if (isHostedOnboardingError(error) && error.code === "NUMBERS_PROJECTION_UNAVAILABLE") throw error;
    // Decrypt/transport failures may contain private paths or signed URLs.
    throw numbersUnavailable(describeCompanionProjectionFailure(error));
  }
}

export type RawHealthPoint = { date: string; value: number; source: string | null; observedAt: string };

export function readRawHealthNumber(
  client: BrowserVaultMetricSeriesCapableQueryClient,
  metric: (typeof COMPANION_HEALTH_METRICS)[keyof typeof COMPANION_HEALTH_METRICS],
  window: { from: string; through: string },
) {
  const definition = resolveMetricDefinition(metric.key)!;
  const { minValue, maxValue } = HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_SPECS.find(spec => spec.metricKey === metric.key)!;
  const byDate = new Map<string, RawHealthPoint>();
  const rows = client.metrics.series({ metricKey: metric.key, from: window.from, to: window.through, grain: "day" });
  // Series rows end each date on its highest-priority source, so the last stands;
  // do not average multiple observations or manufacture missing dates.
  for (const row of rows) {
    if (metric.key === "total-sleep-minutes" && row.context.sleepType === "nap") continue;
    if (row.statistic !== "value" || row.comparator != null) continue;
    const normalized = normalizeMetricValue({ metricKey: metric.key, unit: row.unit, value: row.value });
    if (normalized.canonicalValue === null || normalized.canonicalValue < minValue || normalized.canonicalValue > maxValue) continue;
    // As on the board: a worn device can hold 0 for days it counted no steps; 0 is not a reading.
    if (metric.key === "steps" && normalized.canonicalValue === 0) continue;
    byDate.set(row.date, { date: row.date, value: normalized.canonicalValue, source: row.sourceLabel, observedAt: row.observedAt });
  }
  // Source preference applies within a date, never across the saved history.
  const points = [...byDate.values()];
  const latest = points.at(-1);
  if (!latest) return null;
  return {
    unit: definition.canonicalUnit,
    source: latest.source,
    reported: isManualMetricSource(latest.source),
    latest,
    stale: latest.date < addDaysToIsoDate(window.through, -(definition.selectionPolicy.staleAfterDays ?? 14)),
    daily: points,
  };
}

export type RawHealthNumber = NonNullable<ReturnType<typeof readRawHealthNumber>>;
export type CompanionHealthSeries = NonNullable<Awaited<ReturnType<typeof readCompanionHealthSeries>>>;

function presentNumber(
  number: RawHealthNumber | null,
  metric: (typeof COMPANION_HEALTH_METRICS)[keyof typeof COMPANION_HEALTH_METRICS],
  window: { from: string; through: string },
  baselineFrom: string,
) {
  if (!number) return null;
  const definition = resolveMetricDefinition(metric.key)!;
  const round = (value: number) => Number(value.toFixed(metric.precision));
  const { daily: points, latest } = number;
  const intermittent = definition.selectionPolicy.kind === "latest-device-estimate";
  const comparison = selectMetricWindowComparison({
    metricKey: metric.key,
    points: points.map(point => ({ ...point, metricKey: metric.key, unit: definition.canonicalUnit })),
    baselineWindow: { start: baselineFrom, end: addDaysToIsoDate(baselineFrom, 6) },
    comparisonWindow: { start: addDaysToIsoDate(window.through, -6), end: window.through },
    statistic: intermittent ? definition.trendPolicy?.aggregation : "mean",
    minimumPoints: intermittent ? definition.trendPolicy?.minimumPoints : 4,
  });
  return {
    unit: metric.unit,
    source: latest.source,
    reported: isManualMetricSource(latest.source),
    latest: { date: latest.date, value: round(latest.value), observedAt: latest.observedAt },
    stale: number.stale,
    daily: points.map(point => ({ date: point.date, value: round(point.value) })),
    comparison: comparison.status === "ready" && comparison.baseline.value !== null
      && comparison.comparison.value !== null && comparison.delta !== null ? {
        baseline: {
          from: comparison.baseline.start, through: comparison.baseline.end,
          value: round(comparison.baseline.value), days: comparison.baseline.daysWithData,
        },
        current: {
          from: comparison.comparison.start, through: comparison.comparison.end,
          value: round(comparison.comparison.value), days: comparison.comparison.daysWithData,
        },
        delta: round(comparison.delta),
      } : null,
  };
}
