import "server-only";
import { ProgressReadTiming } from "./read-timing";
import { addDaysToIsoDate, toLocalDayKey } from "@murphai/contracts";
import type { HostedBrowserVaultReplicaRef } from "@murphai/hosted-execution";
import { HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_SPECS } from "@murphai/hosted-execution/vault-share";
import type { HostedNativeMemberAuth } from "../../better-auth/native-auth";
import type { ClientUnits } from "../../companion/client-info";
import { assertBrowserVaultMemberAuthority } from "../../browser-vault/authority";
import { COMPANION_HEALTH_METRICS, readCompanionHealthSeries } from "../../device-sync/companion-numbers";
import { readHostedBrowserVaultReplicaState } from "../../hosted-workspace/store";
import { lastSettledStepDay } from "../../settled-step-day";
import { getPrisma } from "../../prisma";
import { hostedOnboardingError, isHostedOnboardingError } from "../../hosted-onboarding/errors";
import { assertGameMemberAuthCurrentTx } from "../http/auth";
import { gameHttpError, gameNotFound, invalidGameRequest } from "../http/errors";
import type { GoalsQuery, HealthMetric, SetMeasureBody } from "./contract";
import { openProgress, openProgressMany, progressLookup } from "./crypto";
import { readAwards, settleAwards } from "./awards";
import { attachRouteArt } from "./route-art";
import { memberPlaceFixer } from "./place-fix";
import { patchMeasureState, type MeasureState, type BeforeProgressMutation } from "./state";
import { saveVaultRuns } from "./vault-runs";
import { HEALTH, type Candidate } from "./registry";
import type { CompanionHealthSeries, RawHealthPoint } from "../../device-sync/companion-numbers";
import type { AgeProfile } from "./norms";
import { healthAgeShare, healthBaseline, healthMeans, healthSteps, healthSums, progressHealthDays } from "./health";
import { cumulativePoints } from "./series";
import { readRouteGoals, routeLegs, routeProgressIncomplete, routeView, setRouteGoal } from "./routes";
import { healthView, savedHealthView, type HealthMetricInput } from "./health-view";
import { healthJourneyMeasure, healthJourneys, healthJourneyView, healthJourneyViews } from "./health-journeys";

const metricIds = Object.keys(HEALTH) as HealthMetric["id"][];

async function readHealthStates(memberId: string): Promise<Map<string, MeasureState>> {
  const lookups = metricIds.map(id => progressLookup(memberId, "measure", [id]));
  const rows = await getPrisma().gameProgressMeasure.findMany({ where: { memberId, lookup: { in: lookups } },
    take: 4, select: { lookup: true, stateEncrypted: true } });
  const opened = await openProgressMany<MeasureState>(rows.map(row => ({ memberId, table: "game_progress_measure",
    rowId: row.lookup, field: "state", value: row.stateEncrypted })));
  return new Map(metricIds.map((id, index) => [id, opened[rows.findIndex(row => row.lookup === lookups[index])] ?? {}]));
}

async function readSavedHealth(auth: HostedNativeMemberAuth, joinedOn: string, today: string, timing: ProgressReadTiming) {
  const db = getPrisma(), memberId = auth.member.id;
  await timing.measure("auth", () => assertGameMemberAuthCurrentTx(auth, db));
  await timing.measure("auth", () => assertBrowserVaultMemberAuthority({ memberId, prisma: db }));
  const states = await timing.measure("states", () => readHealthStates(memberId));
  const awards = await timing.measure("awards", () => readAwards(memberId));
  const metrics = metricIds.map(id => ({ id, ...HEALTH[id], daily: [], baseline: states.get(id)!.baseline?.value ?? null,
    wins: awards.filter(award => award.measureId === id && ["health", "healthAge"].includes(award.kind)) }));
  await timing.measure("auth", () => assertGameMemberAuthCurrentTx(auth, db));
  await timing.measure("auth", () => assertBrowserVaultMemberAuthority({ memberId, prisma: db }));
  return timing.measure("render", () => savedHealthView(joinedOn, today, metrics));
}

/** Steps reads and writes: the member's session, and their vault's authority over health data. */
export function healthAuthority(auth: HostedNativeMemberAuth): BeforeProgressMutation {
  return async tx => {
    await assertGameMemberAuthCurrentTx(auth, tx);
    await assertBrowserVaultMemberAuthority({ memberId: auth.member.id, prisma: tx });
  };
}

async function readStepsAmounts(auth: HostedNativeMemberAuth, signal: AbortSignal) {
  const snapshot = await readCompanionHealthSeries(auth, signal, ["steps"]);
  const profile = await getPrisma().gameProfile.findUnique({ where: { memberId: auth.member.id }, select: { createdAt: true, timeZone: true } });
  if (!profile) throw gameNotFound();
  const { timeZone } = profile;
  const joinedOn = toLocalDayKey(profile.createdAt, timeZone), today = toLocalDayKey(new Date(), timeZone);
  const inRange = healthValueRange("steps");
  const daily = snapshot?.numbers.steps?.daily.filter(point => inRange(point.value)) ?? [];
  return { amounts: snapshot ? healthSums("steps", daily, joinedOn, today) : null, today, timeZone };
}

/** The map consumes the same settled daily Steps and join-date window as Health. */
export async function readProgressStepsRoute(auth: HostedNativeMemberAuth, signal: AbortSignal) {
  const db = getPrisma(), memberId = auth.member.id;
  const { amounts } = await readStepsAmounts(auth, signal);
  // Unread steps fail as the Steps page does: drawn from none, the map would show nothing walked under this walk's link.
  if (amounts === null) throw routeProgressIncomplete();
  const lookup = progressLookup(memberId, "measure", ["steps"]);
  const row = await db.gameProgressMeasure.findUnique({ where: { memberId_lookup: { memberId, lookup } }, select: { stateEncrypted: true } });
  if (!row) throw gameNotFound();
  const state = await openProgress<MeasureState>({ memberId, table: "game_progress_measure", rowId: lookup, field: "state" }, row.stateEncrypted);
  const leg = state.legs?.at(-1);
  if (!leg) throw gameNotFound();
  const route = routeView("steps", state, cumulativePoints(amounts), await readAwards(memberId), "us")!;
  return { polyline: leg.polyline, progress: route.progress };
}

async function readStepsMeasure(auth: HostedNativeMemberAuth, signal: AbortSignal, includeAwards: boolean) {
  const { amounts, today, timeZone } = await readStepsAmounts(auth, signal);
  if (amounts === null) throw routeProgressIncomplete();
  // Typing a goal only needs awards when no observed days remain.
  const awards = includeAwards || !amounts.length ? await readAwards(auth.member.id) : [];
  const measure = healthJourneyMeasure("steps", amounts, awards);
  if (!measure) throw gameNotFound();
  return { measure, points: cumulativePoints(amounts), awards, today, timeZone };
}

export async function readStepsGoals(auth: HostedNativeMemberAuth, signal: AbortSignal, query: GoalsQuery, units: ClientUnits) {
  const { points } = await readStepsMeasure(auth, signal, false);
  const goals = await readRouteGoals(query.q, "steps", points.at(-1)?.[1] ?? 0, units, memberPlaceFixer(auth.member.id));
  await healthAuthority(auth)(getPrisma());
  return goals;
}

export async function setStepsMeasure(auth: HostedNativeMemberAuth, signal: AbortSignal, body: SetMeasureBody, units: ClientUnits) {
  if ("perDay" in body) throw invalidGameRequest("This measure already has an amount.");
  const { measure, points, awards, today, timeZone } = await readStepsMeasure(auth, signal, true);
  const beforeMutationTx = healthAuthority(auth), memberId = auth.member.id;
  const state = await setRouteGoal(memberId, "steps", body.goal, { points, awards, incomplete: false, today, beforeMutationTx });
  const candidates = routeLegs({ measureId: "steps", legs: state.legs!, points });
  const inserted = await settleAwards(memberId, candidates, beforeMutationTx, { awards, timeZone });
  const currentAwards = inserted ? await readAwards(memberId) : awards;
  const view = healthJourneyView(measure, state, currentAwards, today, units);
  // A new route's map and first posters start now, not on the next Health read.
  await attachRouteArt([view], new Map([["steps", state]]), { memberId, beforeMutationTx });
  await beforeMutationTx(getPrisma());
  return view;
}

export async function readProgressHealth(auth: HostedNativeMemberAuth, signal: AbortSignal, units: ClientUnits, timing = new ProgressReadTiming()) {
  try {
    const db = getPrisma(), memberId = auth.member.id;
    const profile = await timing.measure("profile", () => db.gameProfile.findUnique({ where: { memberId }, select: { createdAt: true, timeZone: true } }));
    if (!profile) throw gameHttpError("PROFILE_REQUIRED", 409, "Add your first name and time zone first.");
    const timeZone = profile.timeZone;
    const now = new Date();
    const today = toLocalDayKey(now, timeZone), joinedOn = toLocalDayKey(profile.createdAt, timeZone);
    // A failed live read returns saved presentation, never a baseline or award write.
    const snapshot = await timing.measure("ownReplica", () => readCompanionHealthSeries(auth, signal, metricIds)).catch(async error => {
      if (!isHostedOnboardingError(error) || error.code !== "NUMBERS_PROJECTION_UNAVAILABLE") throw error;
      const health = await readSavedHealth(auth, joinedOn, today, timing);
      throw hostedOnboardingError({ code: error.code, httpStatus: 503, retryable: true,
        message: error.message, details: { health } });
    });
    const states = await timing.measure("states", () => readHealthStates(memberId));
    const { models, journeys, ageProfile, previousAwards, attemptedInsert } = await settleProgressHealth(auth, snapshot, profile, states, now, timing);
    const awards = attemptedInsert ? await timing.measure("awards", () => readAwards(memberId)) : previousAwards;
    for (const model of models) model.wins = awards.filter(award => award.measureId === model.id && ["health", "healthAge"].includes(award.kind));
    const sums = await timing.measure("render", () => healthJourneyViews(journeys, awards, today, units));
    // The Steps map and its places' posters: start what's missing, after the response.
    await timing.measure("art", () => attachRouteArt(sums, journeys.states, { memberId, beforeMutationTx: healthAuthority(auth) }));
    // Returning private values also requires current session and health authority.
    await timing.measure("auth", () => assertGameMemberAuthCurrentTx(auth, db));
    await timing.measure("auth", () => assertBrowserVaultMemberAuthority({ memberId, prisma: db }));
    return await timing.measure("render", () => healthView({ joinedOn, today, snapshot, profile: ageProfile, metrics: models, sums }));
  } catch (error) {
    if (isHostedOnboardingError(error)) throw error;
    throw hostedOnboardingError({ code: "PROGRESS_HEALTH_UNAVAILABLE", httpStatus: 503, retryable: true,
      message: "Health progress is temporarily unavailable." });
  }
}

/** A completed batch, not a baseline write, proves this replica has been scored. */
export function healthSettlementCurrent(
  receipt: MeasureState["healthSettlement"], savedAt: string, profileTimeZone: string, now: Date,
): boolean {
  if (!receipt || receipt.savedAt !== savedAt || receipt.profileTimeZone !== profileTimeZone) return false;
  const checked = new Date(receipt.checkedAt);
  return toLocalDayKey(checked, profileTimeZone) === toLocalDayKey(now, profileTimeZone)
    && toLocalDayKey(checked, receipt.timeZone) === toLocalDayKey(now, receipt.timeZone)
    && lastSettledStepDay(checked, receipt.timeZone) === lastSettledStepDay(now, receipt.timeZone);
}

/** Post-response health work never constructs the page or its saved-error response. */
export async function settleProgressHealthInBackground(auth: HostedNativeMemberAuth) {
  const db = getPrisma(), memberId = auth.member.id;
  await assertGameMemberAuthCurrentTx(auth, db);
  try {
    await assertBrowserVaultMemberAuthority({ memberId, prisma: db });
  } catch (error) {
    if (isHostedOnboardingError(error) && [401, 403].includes(error.httpStatus)) return;
    throw error;
  }
  const workspace = await readHostedBrowserVaultReplicaState({ userId: memberId });
  // The publication owner already validated the stored reference.
  const ref = workspace?.browserVaultReplicaRef as Pick<HostedBrowserVaultReplicaRef, "generatedAt"> | null;
  if (!ref) return;
  const profile = await db.gameProfile.findUniqueOrThrow({ where: { memberId }, select: { createdAt: true, timeZone: true } });
  const states = await readHealthStates(memberId), now = new Date();
  if (healthSettlementCurrent(states.get("restingHeartRate")!.healthSettlement, ref.generatedAt, profile.timeZone, now)) return;
  const snapshot = await readCompanionHealthSeries(auth, new AbortController().signal, metricIds, workspace);
  if (!snapshot) return;
  await settleProgressHealth(auth, snapshot, profile, states, now);
  const authority: BeforeProgressMutation = async tx => {
    await assertGameMemberAuthCurrentTx(auth, tx);
    await assertBrowserVaultMemberAuthority({ memberId, prisma: tx });
  };
  // Totals and its goals read Running's saved vault runs; this is their one replica read.
  await saveVaultRuns(memberId, snapshot.savedAt, snapshot.runs, authority);
  await patchMeasureState(memberId, "restingHeartRate", previous => {
    const receipt = previous.healthSettlement;
    if (receipt && (Date.parse(receipt.savedAt) > Date.parse(snapshot.savedAt)
      || (receipt.savedAt === snapshot.savedAt && Date.parse(receipt.checkedAt) > now.getTime()))) return previous;
    return { healthSettlement: { savedAt: snapshot.savedAt, checkedAt: now.toISOString(), timeZone: snapshot.timeZone, profileTimeZone: profile.timeZone } };
  }, authority);
}

/** The page and background share every baseline, journey and award write. */
async function settleProgressHealth(
  auth: HostedNativeMemberAuth, snapshot: CompanionHealthSeries | null,
  profile: { createdAt: Date; timeZone: string }, states: Map<string, MeasureState>, now: Date, timing = new ProgressReadTiming(),
) {
  const memberId = auth.member.id, timeZone = profile.timeZone;
  const today = toLocalDayKey(now, timeZone), joinedOn = toLocalDayKey(profile.createdAt, timeZone);
  const ageProfile = { age: snapshot?.demographics?.birthYear === null || !snapshot?.demographics
    ? null : Number(today.slice(0, 4)) - snapshot.demographics.birthYear,
  sex: snapshot?.demographics?.biologicalSex ?? null };
  // Award comparisons stay in the join-date age bracket; a birthday is not an improvement.
  const awardProfile = { ...ageProfile, age: ageProfile.age === null ? null
    : ageProfile.age - Number(today.slice(0, 4)) + Number(joinedOn.slice(0, 4)) };
  const beforeMutationTx = healthAuthority(auth);
  const previousAwards = await timing.measure("awards", () => readAwards(memberId));
  const models: HealthMetricInput[] = [];
  const candidates: Candidate[] = [];
  for (const id of metricIds) {
    const daily = progressHealthDays(id, (snapshot?.numbers[id]?.daily ?? [])
      .filter(point => point.date >= addDaysToIsoDate(today, -364) && point.date <= today));
    const result = await timing.measure("scoring", () => freezeAndScoreMetric({ memberId, id, daily, joinedOn, profile: awardProfile,
      state: states.get(id)!, beforeMutationTx }));
    candidates.push(...result.candidates);
    models.push(result.model);
    states.set(id, result.state);
  }
  const journeys = await timing.measure("journeys", () => healthJourneys({ memberId, metrics: models, states, joinedOn, today, timeZone, beforeMutationTx, awards: previousAwards }));
  const attemptedInsert = await timing.measure("awards", () => settleAwards(memberId, [...candidates, ...journeys.candidates], beforeMutationTx, { awards: previousAwards, timeZone }));
  return { models, journeys, ageProfile, previousAwards, attemptedInsert };
}

function healthValueRange(id: HealthMetric["id"]) {
  const { minValue, maxValue } = HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_SPECS
    .find(spec => spec.metricKey === COMPANION_HEALTH_METRICS[id].key)!;
  const scale = id === "sleep" ? 60 : 1;
  // Reuse the reporting owner's bounds for live readings and frozen baselines.
  return (value: number) => value >= minValue * scale && value <= maxValue * scale;
}

async function freezeAndScoreMetric(input: {
  memberId: string; id: HealthMetric["id"]; daily: RawHealthPoint[]; joinedOn: string; profile: AgeProfile;
  state: MeasureState; beforeMutationTx: BeforeProgressMutation;
}) {
  const { memberId, id, joinedOn, profile, beforeMutationTx } = input;
  const inRange = healthValueRange(id);
  const daily = input.daily.filter(point => inRange(point.value));
  let state = input.state;
  const proposed = state.baseline?.value ?? healthBaseline(daily, joinedOn);
  if (!state.baseline && proposed !== null) state = await patchMeasureState(memberId, id,
    { baseline: { value: proposed, from: addDaysToIsoDate(joinedOn, -28), to: addDaysToIsoDate(joinedOn, -1) } }, beforeMutationTx);
  const savedBaseline = state.baseline?.value ?? null;
  const baseline = savedBaseline !== null && inRange(savedBaseline) ? savedBaseline : null;
  const model: HealthMetricInput = { id, daily, baseline, ...HEALTH[id], wins: [] };
  if (baseline === null) return { model, state, candidates: [] };
  const byDate = new Map(daily.map(point => [point.date, point]));
  const means = healthMeans(daily).map(point => ({ ...byDate.get(point.date)!, value: point.value }));
  const context = { metric: id, joinedOn, baseline, means, profile, ...HEALTH[id] };
  return { model, state, candidates: [...healthSteps(context), ...healthAgeShare(context)] };
}
