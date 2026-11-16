import "server-only";
import { addDaysToIsoDate, toLocalDayKey } from "@murphai/contracts";
import type { HostedNativeMemberAuth } from "../../better-auth/native-auth";
import { assertBrowserVaultMemberAuthority } from "../../browser-vault/authority";
import { readCompanionHealthSeries } from "../../device-sync/companion-numbers";
import { getPrisma } from "../../prisma";
import { hostedOnboardingError, isHostedOnboardingError } from "../../hosted-onboarding/errors";
import { assertGameMemberAuthCurrentTx } from "../http/auth";
import { gameHttpError } from "../http/errors";
import type { HealthMetric } from "./contract";
import { openProgressMany, progressLookup } from "./crypto";
import { readAwards, settleAwards } from "./awards";
import { patchMeasureState, type MeasureState, type BeforeProgressMutation } from "./state";
import { HEALTH } from "./registry";
import type { RawHealthPoint } from "../../device-sync/companion-numbers";
import type { AgeProfile } from "./norms";
import { healthAgeShare, healthBaseline, healthMeans, healthSteps, progressHealthDays } from "./health";
import { healthView, type HealthMetricInput } from "./health-view";
import { healthJourneys, healthJourneyViews } from "./health-journeys";

export async function readProgressHealth(auth: HostedNativeMemberAuth, signal: AbortSignal) {
  try {
    const db = getPrisma(), memberId = auth.member.id;
    const profile = await db.gameProfile.findUnique({ where: { memberId }, select: { createdAt: true, timeZone: true } });
    if (!profile) throw gameHttpError("PROFILE_REQUIRED", 409, "Add your first name and time zone first.");
    // A failed vault read exits before any baseline or award can be written.
    const snapshot = await readCompanionHealthSeries(auth, signal);
    const timeZone = profile.timeZone;
    const today = toLocalDayKey(new Date(), timeZone), joinedOn = toLocalDayKey(profile.createdAt, timeZone);
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
    const ids = Object.keys(HEALTH) as HealthMetric["id"][];
    const lookups = ids.map(id => progressLookup(memberId, "measure", [id]));
    const rows = await db.gameProgressMeasure.findMany({ where: { memberId, lookup: { in: lookups } },
      take: 4, select: { lookup: true, stateEncrypted: true } });
    const opened = await openProgressMany<MeasureState>(rows.map(row => ({ memberId, table: "game_progress_measure",
      rowId: row.lookup, field: "state", value: row.stateEncrypted })));
    const previousAwards = await readAwards(memberId);
    const models: HealthMetricInput[] = [];
    const states = new Map<string, MeasureState>();
    const candidates = [];
    for (const [index, id] of ids.entries()) {
      const daily = progressHealthDays(id, (snapshot?.numbers[id]?.daily ?? [])
        .filter(point => point.date >= addDaysToIsoDate(today, -364) && point.date <= today));
      const result = await freezeAndScoreMetric({ memberId, id, daily, joinedOn, profile: awardProfile,
        state: opened[rows.findIndex(row => row.lookup === lookups[index])] ?? {}, beforeMutationTx });
      candidates.push(...result.candidates);
      models.push(result.model);
      states.set(id, result.state);
    }
    const journeys = await healthJourneys({ memberId, metrics: models, states, joinedOn, today, timeZone, beforeMutationTx, awards: previousAwards });
    await settleAwards(memberId, [...candidates, ...journeys.candidates], beforeMutationTx);
    const awards = await readAwards(memberId);
    for (const model of models) model.wins = awards.filter(award => award.measureId === model.id && ["health", "healthAge"].includes(award.kind));
    const sums = healthJourneyViews(journeys, awards, today);
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
  const { memberId, id, daily, joinedOn, profile, beforeMutationTx } = input;
  let state = input.state;
  const proposed = state.baseline?.value ?? healthBaseline(id, daily, joinedOn);
  if (!state.baseline && proposed !== null) state = await patchMeasureState(memberId, id,
    { baseline: { value: proposed, from: addDaysToIsoDate(joinedOn, -28), to: addDaysToIsoDate(joinedOn, -1) } }, beforeMutationTx);
  const baseline = state.baseline?.value ?? null;
  const model: HealthMetricInput = { id, daily, baseline, ...HEALTH[id], wins: [] };
  if (baseline === null) return { model, state, candidates: [] };
  const byDate = new Map(daily.map(point => [point.date, point]));
  const means = healthMeans(id, daily).map(point => ({ ...byDate.get(point.date)!, value: point.value }));
  const context = { metric: id, joinedOn, baseline, means, profile, ...HEALTH[id] };
  return { model, state, candidates: [...healthSteps(context), ...healthAgeShare(context)] };
}
