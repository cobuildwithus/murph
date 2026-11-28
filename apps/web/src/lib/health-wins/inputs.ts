import "server-only";

import { createHash } from "node:crypto";
import type { BrowserVaultCoreCapableQueryClient } from "@murphai/query/browser-replica-client";
import type { HostedNativeMemberAuth } from "../better-auth/native-auth";
import { assertPrivateHealthAuthority, withInputAuthority } from "./input-authority";
import { loadPublishedCompanionMetricReplica } from "../device-sync/companion-numbers";
import { readPaintedRouteArt } from "../game/progress/route-art";
import { hostedOnboardingError, isHostedOnboardingError } from "../hosted-onboarding/errors";
import { lastSettledStepDay } from "../settled-step-day";
import { isMetric } from "./engine/metrics";
import type { HealthWinsInput, Measure, Metric } from "./engine/types";
import { readHealthWinExperiments } from "./experiment-inputs";
import { isHealthDietEnabled } from "./flag";
import { readHealthWinGameInputs } from "./game-inputs";
import { readHealthWinAnalyte, readHealthWinLabs } from "./lab-inputs";
import { readHealthWinMeals } from "./meal-inputs";
import { readHealthWinWearables, WIN_METRIC_KEYS } from "./wearable-inputs";

function sources(signal: AbortSignal) {
  const missing = new Set<string>();
  async function read<T>(name: string, load: () => T | Promise<T>): Promise<T | null> {
    signal.throwIfAborted();
    try {
      return await load();
    } catch (error) {
      if (isHostedOnboardingError(error) && [401, 403].includes(error.httpStatus)) throw error;
      signal.throwIfAborted();
      missing.add(name);
      return null;
    }
  }
  return { read, missing };
}

function memberInputs(today: string, client?: BrowserVaultCoreCapableQueryClient): HealthWinsInput["member"] {
  const demographics = client?.replica.demographics;
  return { today, age: demographics?.birthYear == null ? null : Number(today.slice(0, 4)) - demographics.birthYear,
    sex: demographics?.biologicalSex ?? null, wearableProvider: null };
}

function wearableInputs(client: BrowserVaultCoreCapableQueryClient, today: string, clock: Date, metrics?: Metric[]) {
  if (!("metrics" in client)) throw Error("Missing metrics shard");
  let stepsThrough = today;
  if (!metrics || metrics.includes("steps")) {
    const timeZone = client.replica.meals?.timeZone;
    if (!timeZone) throw Error("Missing vault time zone");
    stepsThrough = lastSettledStepDay(clock, timeZone);
  }
  return { ...readHealthWinWearables(client, today, stepsThrough, metrics), stepsThrough };
}

function labRows(client: BrowserVaultCoreCapableQueryClient, today: string) {
  if (!("labResults" in client)) throw Error("Missing lab shard");
  return client.labResults.list({ to: today });
}

async function readReplicaInputs(client: BrowserVaultCoreCapableQueryClient, today: string, clock: Date,
  source: ReturnType<typeof sources>, dietEnabled: boolean) {
  const member = memberInputs(today, client);
  const wearable = await source.read("wearables", () => wearableInputs(client, today, clock));
  if (wearable) {
    member.wearableProvider = wearable.wearableProvider;
    if (!wearable.complete) source.missing.add("wearables");
  }
  const labs = await source.read("labs", () => readHealthWinLabs(labRows(client, today), today));
  const experiments = await source.read("experiments", () => {
    if (!("experimentOutcomes" in client.replica)) throw Error("Missing experiment outcomes");
    if (!client.replica.experimentOutcomes?.length) return [];
    const sessions = client.replica.policy?.includedFamilies.includes("event")
      ? client.entities.list({ families: ["event"], kinds: ["intervention_session"] }) : null;
    return readHealthWinExperiments(client.replica.experimentOutcomes, client.entities.list({ families: ["experiment"] }), sessions, today);
  });
  const meals = dietEnabled ? await source.read("meals", () => readHealthWinMeals(client.replica.meals, today)) : null;
  return {
    inputs: { member, daily: wearable?.daily ?? [], sessions: client.replica.activitySessions ?? [],
      labs: labs ?? [], experiments: experiments ?? [], meals: meals ?? undefined },
    stepsThrough: wearable?.stepsThrough ?? null,
  };
}

export async function readHealthWinInputs(memberId: string, checkAuthority: () => Promise<void>, today: string, signal: AbortSignal) {
  return withInputAuthority(checkAuthority, async () => {
    const source = sources(signal);
    const saved = await source.read("replica", () => loadPublishedCompanionMetricReplica({
      memberId, signal, metricKeys: Object.values(WIN_METRIC_KEYS), requestedShards: ["core", "metricsIndex", "labs"],
      timeoutMs: 6000,
    }));
    if (saved?.state === "not_ready") source.missing.add("replica");
    const client = saved?.state === "ready" ? saved.client : null;
    const clock = new Date();
    const dietEnabled = isHealthDietEnabled(memberId);
    const vault = client ? await readReplicaInputs(client, today, clock, source, dietEnabled)
      : { inputs: { member: memberInputs(today) }, stepsThrough: null };
    // Older readable replicas can reuse Progress's matching run cache. A failed or missing replica cannot.
    const runs = client ? client.replica.runs ?? null : { days: [] };
    const game = await source.read("game", () => readHealthWinGameInputs(memberId, today, runs, clock, signal))
      ?? { complete: false, games: [], gameStreak: null, sourceRevision: null, milestones: [] };
    if (!game.complete) source.missing.add("game");
    const input: HealthWinsInput = { ...vault.inputs, games: game.games, gameStreak: game.gameStreak ?? null };
    const distanceArtUrl = input.daily?.some(row => row.metric === "distance_km" && row.value > 0 && row.date.slice(0, 4) === today.slice(0, 4))
      ? await source.read("distanceArt", () => readPaintedRouteArt(memberId, ["steps", "walk.meters", "run.meters", "walk.steps", "run.steps"], signal))
      : null;
    const sourceRevision = createHash("sha256").update(JSON.stringify([
      client?.replica.source.dataVersion ?? null, today, vault.stepsThrough, game.sourceRevision, distanceArtUrl, dietEnabled, [...source.missing],
    ])).digest("hex");
    signal.throwIfAborted();
    return { input, milestones: game.milestones, distanceArtUrl, sourceRevision, complete: !source.missing.size };
  });
}

const MEASURE_READ_BUDGET_MS = 4000;

function measureUnavailable() {
  return hostedOnboardingError({ code: "HEALTH_SEE_YOURS_UNAVAILABLE", httpStatus: 503, retryable: true,
    message: "Your card is temporarily unavailable." });
}

async function readMeasureSource(memberId: string, today: string, measure: Measure, signal: AbortSignal):
  Promise<{ input: HealthWinsInput; observed: boolean }> {
  signal.throwIfAborted();
  const saved = await loadPublishedCompanionMetricReplica({
    memberId, signal, timeoutMs: MEASURE_READ_BUDGET_MS,
    ...(isMetric(measure) ? { requestedShards: ["core", "metricsIndex"], metricKeys: [WIN_METRIC_KEYS[measure]] }
      : { requestedShards: ["core", "labs"], metricKeys: [] }),
  });
  if (saved.state === "not_ready") throw measureUnavailable();
  if (saved.state === "unpublished") return { input: { member: memberInputs(today) }, observed: false };
  signal.throwIfAborted();
  const member = memberInputs(today, saved.client);
  if (!isMetric(measure)) {
    const { labs, observed } = readHealthWinAnalyte(labRows(saved.client, today), today, measure);
    return { input: { member, labs }, observed };
  }
  const { daily, wearableProvider, complete, observed } = wearableInputs(saved.client, today, new Date(), [measure]);
  if (!complete) throw measureUnavailable();
  return { input: { member: { ...member, wearableProvider }, daily }, observed };
}

export async function readMeasureInputs(auth: HostedNativeMemberAuth, today: string, measure: Measure, requestSignal: AbortSignal) {
  const deadline = AbortSignal.timeout(MEASURE_READ_BUDGET_MS);
  const signal = AbortSignal.any([requestSignal, deadline]);
  const memberId = auth.member.id;
  try {
    const result = await withInputAuthority(() => assertPrivateHealthAuthority(auth), () => readMeasureSource(memberId, today, measure, signal));
    signal.throwIfAborted();
    return result;
  } catch (error) {
    if (isHostedOnboardingError(error) && [401, 403].includes(error.httpStatus)) throw error;
    requestSignal.throwIfAborted();
    // Transport and decryption errors may contain private replica locators.
    throw measureUnavailable();
  }
}
