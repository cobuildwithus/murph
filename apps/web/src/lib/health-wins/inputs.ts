import "server-only";

import { createHash } from "node:crypto";
import type { BrowserVaultMetricSeriesCapableQueryClient } from "@murphai/query/browser-replica-client";
import { assertHostedNativeMemberAuthCurrentForRead, type HostedNativeMemberAuth } from "../better-auth/native-auth";
import { assertBrowserVaultMemberAuthority } from "../browser-vault/authority";
import { loadPublishedCompanionMetricReplica } from "../device-sync/companion-numbers";
import { readPaintedRouteArt } from "../game/progress/route-art";
import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import { getPrisma } from "../prisma";
import { lastSettledStepDay } from "../settled-step-day";
import type { HealthWinsInput } from "./engine";
import { readHealthWinExperiments } from "./experiment-inputs";
import { isHealthDietEnabled } from "./flag";
import { readHealthWinGameInputs } from "./game-inputs";
import { readHealthWinLabs } from "./lab-inputs";
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

function memberInputs(today: string, client?: BrowserVaultMetricSeriesCapableQueryClient): HealthWinsInput["member"] {
  const demographics = client?.replica.demographics;
  return { today, age: demographics?.birthYear == null ? null : Number(today.slice(0, 4)) - demographics.birthYear,
    sex: demographics?.biologicalSex ?? null, wearableProvider: null };
}

async function readReplicaInputs(client: BrowserVaultMetricSeriesCapableQueryClient, today: string, clock: Date,
  source: ReturnType<typeof sources>, dietEnabled: boolean) {
  const member = memberInputs(today, client);
  const wearable = await source.read("wearables", () => {
    const timeZone = client.replica.meals?.timeZone;
    if (!timeZone) throw Error("Missing vault time zone");
    const stepsThrough = lastSettledStepDay(clock, timeZone);
    return { ...readHealthWinWearables(client, today, stepsThrough), stepsThrough };
  });
  if (wearable) {
    member.wearableProvider = wearable.wearableProvider;
    if (!wearable.complete) source.missing.add("wearables");
  }
  const labs = await source.read("labs", () => {
    if (!("labResults" in client)) throw Error("Missing lab shard");
    return readHealthWinLabs(client.labResults.list({ to: today }), today);
  });
  const experiments = await source.read("experiments", () => readHealthWinExperiments(
    client.replica.experimentOutcomes, client.entities.list({ families: ["experiment"] }), today,
  ));
  const meals = dietEnabled ? await source.read("meals", () => readHealthWinMeals(client.replica.meals, today)) : null;
  return {
    inputs: { member, daily: wearable?.daily ?? [], sessions: client.replica.activitySessions ?? [],
      labs: labs ?? [], experiments: experiments ?? [], meals: meals ?? undefined },
    stepsThrough: wearable?.stepsThrough ?? null,
  };
}

export async function readHealthWinInputs(auth: HostedNativeMemberAuth, today: string, signal: AbortSignal) {
  const memberId = auth.member.id;
  const checkAuthority = () => getPrisma().$transaction(async tx => {
    await assertHostedNativeMemberAuthCurrentForRead(auth, tx);
    await assertBrowserVaultMemberAuthority({ memberId, prisma: tx });
  });
  await checkAuthority();
  try {
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
    const game = await source.read("game", () => readHealthWinGameInputs(auth, today, runs, clock, signal));
    if (game && !game.complete) source.missing.add("game");
    const input: HealthWinsInput = { ...vault.inputs, games: game?.games ?? [], gameStreak: game?.gameStreak ?? null };
    const distanceArtUrl = input.daily?.some(row => row.metric === "distance_km" && row.value > 0 && row.date.slice(0, 4) === today.slice(0, 4))
      ? await source.read("distanceArt", () => readPaintedRouteArt(memberId, ["steps", "walk.meters", "run.meters", "walk.steps", "run.steps"], signal))
      : null;
    const sourceRevision = createHash("sha256").update(JSON.stringify([
      client?.replica.source.dataVersion ?? null, today, vault.stepsThrough, game?.sourceRevision ?? null, distanceArtUrl, dietEnabled, [...source.missing],
    ])).digest("hex");
    signal.throwIfAborted();
    return { input, distanceArtUrl, sourceRevision, complete: !source.missing.size };
  } finally {
    // Authority loss always wins, including after a timeout or a failed independent input.
    await checkAuthority();
  }
}
