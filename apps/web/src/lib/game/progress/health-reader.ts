import "server-only";
import { addDaysToIsoDate } from "@murphai/contracts";
import type { HostedNativeMemberAuth } from "../../better-auth/native-auth";
import type { ClientUnits } from "../../companion/client-info";
import { assertBrowserVaultMemberAuthority } from "../../browser-vault/authority";
import { getPrisma } from "../../prisma";
import { hostedOnboardingError, isHostedOnboardingError } from "../../hosted-onboarding/errors";
import { assertGameMemberAuthCurrentTx } from "../http/auth";
import { gameNotFound } from "../http/errors";
import type { HealthMetric } from "./contract";
import { openProgress, progressLookup } from "./crypto";
import { readAwards, settleAwards } from "./awards";
import { patchMeasureState, type MeasureState, type BeforeProgressMutation } from "./state";
import { HEALTH } from "./registry";
import type { RawHealthPoint } from "../../device-sync/companion-numbers";
import type { AgeProfile } from "./norms";
import { healthAgeShare, healthBaseline, healthMeans, healthSteps, healthSums } from "./health";
import { cumulativePoints } from "./series";
import { routeView } from "./routes";
import { healthView, savedHealthView, type HealthMetricInput } from "./health-view";
import { healthJourneys, healthJourneyViews } from "./health-journeys";
import { healthMetricIds, healthValueInRange, readHealthInput, readHealthProfile, readHealthStates } from "./health-input";

async function readSavedHealth(auth: HostedNativeMemberAuth, joinedOn: string, today: string) {
  const db = getPrisma(), memberId = auth.member.id;
  await assertGameMemberAuthCurrentTx(auth, db);
  await assertBrowserVaultMemberAuthority({ memberId, prisma: db });
  const states = await readHealthStates(memberId), awards = await readAwards(memberId);
  const metrics = healthMetricIds.map(id => ({ id, ...HEALTH[id], daily: [], baseline: states.get(id)!.baseline?.value ?? null,
    wins: awards.filter(award => award.measureId === id && ["health", "healthAge"].includes(award.kind)) }));
  await assertGameMemberAuthCurrentTx(auth, db);
  await assertBrowserVaultMemberAuthority({ memberId, prisma: db });
  return savedHealthView(joinedOn, today, metrics);
}

/** The map consumes the same settled daily Steps and join-date window as Health. */
export async function readProgressStepsRoute(auth: HostedNativeMemberAuth, signal: AbortSignal) {
  const db = getPrisma(), memberId = auth.member.id;
  const { joinedOn, today } = await readHealthProfile(memberId);
  const { metrics } = await readHealthInput(auth, signal, today);
  const lookup = progressLookup(memberId, "measure", ["steps"]);
  const row = await db.gameProgressMeasure.findUnique({ where: { memberId_lookup: { memberId, lookup } }, select: { stateEncrypted: true } });
  if (!row) throw gameNotFound();
  const state = await openProgress<MeasureState>({ memberId, table: "game_progress_measure", rowId: lookup, field: "state" }, row.stateEncrypted);
  const leg = state.legs?.at(-1);
  if (!leg) throw gameNotFound();
  const points = cumulativePoints(healthSums("steps", metrics.find(metric => metric.id === "steps")!.daily, joinedOn, today));
  const route = routeView("steps", state, points, await readAwards(memberId), "us")!;
  return { polyline: leg.polyline, progress: route.progress };
}

export async function readProgressHealth(auth: HostedNativeMemberAuth, signal: AbortSignal, units: ClientUnits) {
  try {
    const db = getPrisma(), memberId = auth.member.id;
    const { timeZone, today, joinedOn } = await readHealthProfile(memberId);
    // A failed live read returns saved presentation, never a baseline or award write.
    const { snapshot, metrics } = await readHealthInput(auth, signal, today).catch(async error => {
      if (!isHostedOnboardingError(error) || error.code !== "NUMBERS_PROJECTION_UNAVAILABLE") throw error;
      const health = await readSavedHealth(auth, joinedOn, today);
      throw hostedOnboardingError({ code: error.code, httpStatus: 503, retryable: true,
        message: error.message, details: { health } });
    });
    const ageProfile = { age: snapshot?.demographics?.birthYear === null || !snapshot?.demographics
      ? null : Number(today.slice(0, 4)) - snapshot.demographics.birthYear,
    sex: snapshot?.demographics?.biologicalSex ?? null };
    // Award comparisons stay in the join-date age bracket; a birthday is not an improvement.
    const awardProfile = { ...ageProfile, age: ageProfile.age === null ? null
      : ageProfile.age - Number(today.slice(0, 4)) + Number(joinedOn.slice(0, 4)) };
    const beforeMutationTx: BeforeProgressMutation = async tx => {
      await assertGameMemberAuthCurrentTx(auth, tx);
      await assertBrowserVaultMemberAuthority({ memberId, prisma: tx });
    };
    const states = await readHealthStates(memberId);
    const previousAwards = await readAwards(memberId);
    const models: HealthMetricInput[] = [];
    const candidates = [];
    for (const { id, daily } of metrics) {
      const result = await freezeAndScoreMetric({ memberId, id, daily, joinedOn, profile: awardProfile,
        state: states.get(id)!, beforeMutationTx });
      candidates.push(...result.candidates);
      models.push(result.model);
      states.set(id, result.state);
    }
    const journeys = await healthJourneys({ memberId, metrics: models, states, joinedOn, today, timeZone, beforeMutationTx, awards: previousAwards });
    await settleAwards(memberId, [...candidates, ...journeys.candidates], beforeMutationTx);
    const awards = await readAwards(memberId);
    for (const model of models) model.wins = awards.filter(award => award.measureId === model.id && ["health", "healthAge"].includes(award.kind));
    const sums = healthJourneyViews(journeys, awards, today, units);
    // Returning private values also requires current session and health authority.
    await assertGameMemberAuthCurrentTx(auth, db);
    await assertBrowserVaultMemberAuthority({ memberId, prisma: db });
    return healthView({ joinedOn, today, snapshot, profile: ageProfile, metrics: models, sums });
  } catch (error) {
    if (isHostedOnboardingError(error)) throw error;
    throw hostedOnboardingError({ code: "PROGRESS_HEALTH_UNAVAILABLE", httpStatus: 503, retryable: true,
      message: "Health progress is temporarily unavailable." });
  }
}

async function freezeAndScoreMetric(input: {
  memberId: string; id: HealthMetric["id"]; daily: RawHealthPoint[]; joinedOn: string; profile: AgeProfile;
  state: MeasureState; beforeMutationTx: BeforeProgressMutation;
}) {
  const { memberId, id, joinedOn, profile, beforeMutationTx } = input;
  const daily = input.daily;
  let state = input.state;
  const proposed = state.baseline?.value ?? healthBaseline(id, daily, joinedOn);
  if (!state.baseline && proposed !== null) state = await patchMeasureState(memberId, id,
    { baseline: { value: proposed, from: addDaysToIsoDate(joinedOn, -28), to: addDaysToIsoDate(joinedOn, -1) } }, beforeMutationTx);
  const savedBaseline = state.baseline?.value ?? null;
  const baseline = savedBaseline !== null && healthValueInRange(id, savedBaseline) ? savedBaseline : null;
  const model: HealthMetricInput = { id, daily, baseline, ...HEALTH[id], wins: [] };
  if (baseline === null) return { model, state, candidates: [] };
  const byDate = new Map(daily.map(point => [point.date, point]));
  const means = healthMeans(id, daily).map(point => ({ ...byDate.get(point.date)!, value: point.value }));
  const context = { metric: id, joinedOn, baseline, means, profile, ...HEALTH[id] };
  return { model, state, candidates: [...healthSteps(context), ...healthAgeShare(context)] };
}
