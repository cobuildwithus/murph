import "server-only";
import {
  addDaysToIsoDate, bloodPressureFields, combineTestsSchema, foodWeekAnswersSchema, memberActionIdV1Schema,
  oneOffAnswerSchema, projectedCheckInSchema, toLocalDayKey, type MemberActionV1, type CheckInInstrument,
} from "@murphai/contracts";
import * as z from "@murphai/contracts/zod-runtime";
import type { HostedNativeMemberAuth } from "../../better-auth/native-auth";
import { hostedAuthRateLimitStorage } from "../../better-auth/rate-limit";
import { submitCompanionMemberAction } from "../../device-sync/companion-member-actions";
import { loadPublishedCompanionMetricReplica } from "../../device-sync/companion-numbers";
import { assertHealthYouEnabled } from "../../health-wins/flag";
import { withHealthRoute } from "../../health-wins/http";
import { assertPrivateHealthAuthority, withInputAuthority } from "../../health-wins/input-authority";
import { hostedOnboardingError, isHostedOnboardingError } from "../../hosted-onboarding/errors";
import { readHostedOnboardingJsonObject } from "../../hosted-onboarding/http";
import { getPrisma } from "../../prisma";
import { model } from "../engine/model";
import { bpValue } from "../engine/observations";
import { combineAgeEffect, localPressureTime, pressureInputs } from "../checkins";
import { readYouInputs } from "../inputs";
import { combineResult, combineStations } from "./combine";
import { foodWeekQuestions } from "./food-week";

function error(httpStatus: number, message: string) {
  return hostedOnboardingError({ code: `HEALTH_CHECK_IN_${httpStatus}`, httpStatus, message, retryable: httpStatus >= 500 || httpStatus === 429 });
}
type Handler = (request: Request, auth: HostedNativeMemberAuth) => Promise<unknown>;
export function checkInRoute(handler: Handler) {
  return withHealthRoute(async (request, auth) => {
    assertHealthYouEnabled(auth.member.id);
    if (new URL(request.url).searchParams.size) throw error(400, "Unexpected check-in parameters.");
    const budget = await hostedAuthRateLimitStorage(getPrisma()).consume(`health-check-in:member:${auth.member.id}`, { max: 60, window: 60 });
    if (!budget.allowed) throw error(429, "Please wait a minute and try again.");
    return Response.json(await handler(request, auth));
  });
}

async function body(request: Request) {
  return readHostedOnboardingJsonObject(request, {
    limitBytes: 10_240, tooLargeErrorCode: "HEALTH_CHECK_IN_INVALID", tooLargeErrorMessage: "This check-in is too large.",
  });
}
function validate<T>(schema: z.ZodType<T>, value: unknown) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw error(400, "Check the submitted values and try again.");
  return parsed.data;
}

async function checkInReplica(request: Request, auth: HostedNativeMemberAuth, metricKeys: string[] = []) {
  const memberId = auth.member.id;
  return withInputAuthority(() => assertPrivateHealthAuthority(auth), async () => {
    const loaded = await loadPublishedCompanionMetricReplica({
      memberId, signal: request.signal, metricKeys, requestedShards: metricKeys.length ? ["core", "metricsIndex"] : ["core"], timeoutMs: 5000,
    });
    if (loaded.state !== "ready" || (request.method === "GET" && loaded.freshness !== "fresh") || (loaded.client.replica.generation ?? 0) < 21
      || !loaded.client.replica.sleepTiming || !loaded.client.replica.meals) {
      throw error(503, "Your private health data is getting ready. Try again soon.");
    }
    return { client: loaded.client, freshness: loaded.freshness, replica: loaded.client.replica, meals: loaded.client.replica.meals };
  });
}
async function submit(auth: HostedNativeMemberAuth, id: string, action: MemberActionV1, requestedAt = new Date().toISOString()) {
  await submitCompanionMemberAction({ auth, prisma: getPrisma(),
    request: { actionId: id, requestedAt, schemaVersion: 1, action } });
  return { state: "accepted" as const, countsBy: "Counts in your age soon" };
}
const id = memberActionIdV1Schema;
const pressureRequest = bloodPressureFields.safeExtend({ id });
export async function saveBloodPressure(request: Request, auth: HostedNativeMemberAuth) {
  const { id, takenAt, ...pair } = validate(pressureRequest, await body(request));
  if (Date.parse(takenAt) > Date.now()) throw error(400, "Choose a reading taken in the past.");
  const keys = pair.setting ? ["systolic-blood-pressure", "diastolic-blood-pressure"] : [];
  const { client, freshness, meals } = await checkInReplica(request, auth, keys);
  const timestamp = new Date(takenAt).toISOString();
  const today = toLocalDayKey(Date.now(), meals.timeZone);
  const datetime = localPressureTime(new Date(timestamp), meals.timeZone);
  const reading = { ...pair, validated: pair.setting === "home" && model.policy.protocol.member_entered_home_cuff_assumed_validated, datetime, date: datetime.slice(0, 10) };
  let qualifies = false;
  if (pair.setting && freshness === "fresh" && "metrics" in client) {
    const from = addDaysToIsoDate(today, -model.policy.protocol.bp_days);
    const rows = keys.flatMap(metricKey => client.metrics.list({ metricKey, from, to: today }));
    const bp = [...pressureInputs(rows, meals.timeZone), reading];
    qualifies = bpValue({ profile: {}, bp }, today, reading)?.includesSubmitted === true;
  }
  const receipt = await submit(auth, id, { kind: "measurement.blood-pressure", version: 1, ...pair, takenAt: timestamp }, timestamp);
  if (qualifies) return receipt;
  const next = pair.setting === "home" ? "For a home series, add morning and evening pairs on 3 days."
    : pair.setting === "clinic" ? "For a clinic series, add a pair of readings on 2 days."
    : "Choose home or clinic on future readings to count a series.";
  return { state: "recorded", next };
}

const foodRequest = z.object({ id, answers: foodWeekAnswersSchema }).strict();
export async function saveFoodWeek(request: Request, auth: HostedNativeMemberAuth) {
  const { id, answers } = validate(foodRequest, await body(request));
  await checkInReplica(request, auth);
  return submit(auth, id, { kind: "assessment.respond", version: 1,
    response: { instrument: "food-week", instrumentVersion: 1, answers: answers.sort((a, b) => a.key.localeCompare(b.key)) } });
}
const answerRequest = z.strictObject({ id, key: z.string(), value: z.union([z.string(), z.number()]) });
export async function saveAnswer(request: Request, auth: HostedNativeMemberAuth) {
  const { id, ...fields } = validate(answerRequest, await body(request));
  const answer = validate(oneOffAnswerSchema, fields);
  const { meals } = await checkInReplica(request, auth);
  if (answer.key === "quitDate" && answer.value > toLocalDayKey(Date.now(), meals.timeZone))
    throw error(400, "Choose a quit date through today.");
  return submit(auth, id, { kind: "assessment.respond", version: 1, response: { instrument: "you-answer", instrumentVersion: 1, answer } });
}

type Replica = Awaited<ReturnType<typeof checkInReplica>>["replica"];
function latestCheckIn(replica: Replica, instrument: "food-week" | "combine", through: string) {
  return replica.entities.filter(row => row.family === "assessment").flatMap(row => {
    const parsed = projectedCheckInSchema.safeParse(row.attributes.checkIn);
    return parsed.success && parsed.data.date <= through && parsed.data.response.instrument === instrument
      ? [{ ...parsed.data, recordedAt: row.occurredAt ?? "" }] : [];
  }).sort((a, b) => b.date.localeCompare(a.date) || b.recordedAt.localeCompare(a.recordedAt) || a.id.localeCompare(b.id))[0];
}
export async function readFoodWeek(request: Request, auth: HostedNativeMemberAuth) {
  const { replica, meals } = await checkInReplica(request, auth);
  const today = toLocalDayKey(Date.now(), meals.timeZone);
  const start = addDaysToIsoDate(today, -6);
  const daysLogged = meals.days.filter(row => row.date >= start && row.date <= today && row.mealCount > 0).length;
  const last = latestCheckIn(replica, "food-week", today);
  return { state: last && addDaysToIsoDate(last.date, 42) > today ? "done" : "ready", daysLogged, questions: foodWeekQuestions,
    ...(last ? { last: { date: last.date } } : {}) };
}
async function scoreSession(request: Request, auth: HostedNativeMemberAuth, replica: Replica, id: string,
  session: Extract<CheckInInstrument, { instrument: "combine" }>) {
  const today = toLocalDayKey(Date.now(), replica.meals!.timeZone);
  const eligible = session.date >= addDaysToIsoDate(today, -49) && session.tests.some(test => !test.skipped &&
    (test.key === "sitting_rising" || (test.key === "single_leg_10s" && test.value === 10)));
  if (!eligible) return combineResult(id, session, replica.demographics);
  return withInputAuthority(() => assertPrivateHealthAuthority(auth), async () => {
    try {
      const inputs = await readYouInputs(auth.member.id, request.signal, new Date(), auth.member.createdAt, undefined);
      if (inputs.sourceRevision === replica.source.dataVersion) {
        return combineResult(id, session, replica.demographics, () => combineAgeEffect(inputs, id, session));
      }
    } catch (error) {
      request.signal.throwIfAborted();
      if (isHostedOnboardingError(error) && error.httpStatus < 500) throw error;
    }
    return combineResult(id, session, replica.demographics);
  });
}
export async function readCombine(request: Request, auth: HostedNativeMemberAuth) {
  const { replica, meals } = await checkInReplica(request, auth);
  const last = latestCheckIn(replica, "combine", toLocalDayKey(Date.now(), meals.timeZone));
  const latest = last?.response.instrument === "combine" ? await scoreSession(request, auth, replica, last.id, last.response) : undefined;
  return { minutes: 30, tests: combineStations, ...(latest ? { latest, nextAt: latest.retestOn } : {}) };
}
const sessionRequest = z.object({ id, date: z.iso.date(), tests: combineTestsSchema,
  safety: z.object({ answer: z.literal("clear") }).strict() }).strict();
export async function saveCombine(request: Request, auth: HostedNativeMemberAuth) {
  const payload = await body(request);
  if (z.object({ answer: z.literal("stop") }).safeParse(payload.safety).success) {
    throw error(409, "Stop the session and rest. Your results were not submitted.");
  }
  const { id, date, tests } = validate(sessionRequest, payload);
  const { replica, meals } = await checkInReplica(request, auth);
  if (date > toLocalDayKey(Date.now(), meals.timeZone)) throw error(400, "Choose a session date through today.");
  const response = { instrument: "combine", instrumentVersion: 1, date, tests } as const;
  const preview = await scoreSession(request, auth, replica, id, response);
  const saved = await submit(auth, id, { kind: "assessment.respond", version: 1, response });
  return { ...preview, saveState: saved.state, countsBy: saved.countsBy };
}
