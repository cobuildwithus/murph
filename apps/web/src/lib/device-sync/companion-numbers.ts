import "server-only";

import { isCloudflareHostedControlBrowserVaultReplicaNotFoundError } from "@murphai/cloudflare-hosted-control/client";
import { addDaysToIsoDate, toLocalDayKey } from "@murphai/contracts";
import { normalizeMetricValue, resolveMetricDefinition, selectMetricWindowComparison } from "@murphai/health-metrics";
import { assessBrowserVaultReplicaFreshness } from "@murphai/hosted-execution";
import { parseHostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/parsers";
import { getBrowserVaultMetricBucketId, type BrowserVaultMetricSeriesCapableQueryClient } from "@murphai/query/browser-replica-client";
import { generateHostedUserRecipientKeyPair } from "@murphai/runtime-state";

import { assertHostedNativeMemberAuthCurrentTx } from "../better-auth/native-auth";
import { assertBrowserVaultMemberAuthority } from "../browser-vault/authority";
import { decodeReadyBrowserVaultSession, parseBrowserVaultSessionResponse } from "../browser-vault/loader";
import { readHostedExecutionControlClientIfConfigured } from "../hosted-execution/control";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { requireActiveHostedMemberAuthFromBearerToken } from "../hosted-onboarding/request-auth";
import { readHostedWorkspace } from "../hosted-workspace/store";
import { getPrisma } from "../prisma";

const metrics = {
  restingHeartRate: { key: "resting-heart-rate", unit: "bpm", precision: 0 },
  sleep: { key: "total-sleep-minutes", unit: "minutes", precision: 0 },
  steps: { key: "steps", unit: "steps", precision: 0 },
  vo2Max: { key: "estimated-vo2-max", unit: "ml/kg/min", precision: 1 },
} as const;
const requestedShards = ["core", "metricsIndex"] as const;
const emptyNumbers = { numbers: null, demographics: null, freshness: "stale" } as const;

function numbersUnavailable() {
  return hostedOnboardingError({
    code: "NUMBERS_PROJECTION_UNAVAILABLE", httpStatus: 503, retryable: true,
    message: "Saved numbers are temporarily unavailable.",
  });
}

export async function readCompanionNumbers(request: Request) {
  const prisma = getPrisma();
  const auth = await requireActiveHostedMemberAuthFromBearerToken(request, prisma);
  await assertBrowserVaultMemberAuthority({ memberId: auth.member.id, prisma });
  if (new URL(request.url).searchParams.size !== 0) {
    throw hostedOnboardingError({
      code: "NUMBERS_INVALID_REQUEST", httpStatus: 400,
      message: "Numbers does not accept query parameters.",
    });
  }
  const snapshot = await loadSavedNumbers(auth.member.id, request.signal);
  // Ciphertext I/O cannot preserve access after session, access or consent loss.
  await assertHostedNativeMemberAuthCurrentTx(auth, prisma);
  await assertBrowserVaultMemberAuthority({ memberId: auth.member.id, prisma });
  if (!snapshot) return emptyNumbers;
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
  if (!timeZone) throw numbersUnavailable();
  const through = toLocalDayKey(new Date(), timeZone);
  const window = { from: addDaysToIsoDate(through, -89), through };
  return {
    timeZone, savedAt: client.replica.generatedAt, freshness, window,
    demographics,
    numbers: {
      restingHeartRate: presentNumber(client, metrics.restingHeartRate, window),
      sleep: presentNumber(client, metrics.sleep, window),
      steps: presentNumber(client, metrics.steps, window),
      vo2Max: presentNumber(client, metrics.vo2Max, window),
    },
  };
}

async function loadSavedNumbers(memberId: string, signal: AbortSignal) {
  try {
    const workspace = await readHostedWorkspace({ userId: memberId });
    const replicaRef = parseHostedBrowserVaultReplicaRef(workspace?.browserVaultReplicaRef ?? null, "Companion numbers replica");
    if (!replicaRef) return null;
    const control = readHostedExecutionControlClientIfConfigured();
    if (!control) throw numbersUnavailable();
    const requestedMetricBuckets = [...new Set(await Promise.all(
      Object.values(metrics).map(metric => getBrowserVaultMetricBucketId(metric.key)),
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
    if (!("metrics" in loaded.client)) throw numbersUnavailable();
    return { client: loaded.client, freshness: session.freshness };
  } catch (error) {
    if (isCloudflareHostedControlBrowserVaultReplicaNotFoundError(error)) return null;
    // Decrypt/transport failures may contain private paths or signed URLs.
    throw numbersUnavailable();
  }
}

function presentNumber(
  client: BrowserVaultMetricSeriesCapableQueryClient,
  metric: (typeof metrics)[keyof typeof metrics],
  window: { from: string; through: string },
) {
  const definition = resolveMetricDefinition(metric.key)!;
  const round = (value: number) => Number(value.toFixed(metric.precision));
  const byDate = new Map<string, { date: string; value: number }>();
  const rows = client.metrics.series({ metricKey: metric.key, from: window.from, to: window.through, grain: "day" });
  // Saved projection owns provider precedence. Keep its latest value on a date;
  // do not average multiple observations or manufacture missing dates.
  for (const row of rows) {
    if (row.statistic !== "value" || row.comparator != null) continue;
    const normalized = normalizeMetricValue({ metricKey: metric.key, unit: row.unit, value: row.value });
    if (normalized.canonicalValue === null) continue;
    byDate.set(row.date, { date: row.date, value: normalized.canonicalValue });
  }
  const points = [...byDate.values()];
  const latest = points.at(-1);
  if (!latest) return null;
  const intermittent = definition.selectionPolicy.kind === "latest-device-estimate";
  const comparison = selectMetricWindowComparison({
    metricKey: metric.key,
    points: points.map(point => ({ ...point, metricKey: metric.key, unit: definition.canonicalUnit })),
    baselineWindow: { start: window.from, end: addDaysToIsoDate(window.from, 6) },
    comparisonWindow: { start: addDaysToIsoDate(window.through, -6), end: window.through },
    statistic: intermittent ? definition.trendPolicy?.aggregation : "mean",
    minimumPoints: intermittent ? definition.trendPolicy?.minimumPoints : 4,
  });
  return {
    unit: metric.unit,
    latest: { date: latest.date, value: round(latest.value) },
    stale: latest.date < addDaysToIsoDate(window.through, -(definition.selectionPolicy.staleAfterDays ?? 14)),
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
