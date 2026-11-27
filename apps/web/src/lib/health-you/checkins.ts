import { oneOffAnswerSchema, toLocalDayKey, type CheckInInstrument } from "@murphai/contracts";
import type { BrowserVaultEntity, BrowserVaultMetricRow } from "@murphai/query/browser-replica-client";
import { isRecord } from "../primitives";
import { day, lookup, type Observation } from "./engine/model";
import type { YouInputs } from "./evidence";
import { withheld } from "./views";
import { score } from "./engine";

function projectedAssessment(row: BrowserVaultEntity, from: string, asOf: string, timeZone: string) {
  const entry = row.attributes.checkIn;
  if (
    !isRecord(entry) ||
    typeof entry.date !== "string" ||
    !day(entry.date) ||
    (entry.date < from && (!isRecord(entry.response) || entry.response.instrument !== "you-answer")) ||
    entry.date > asOf ||
    !isRecord(entry.response) ||
    entry.response.instrumentVersion !== 1 ||
    !row.occurredAt
  )
    return null;
  const reported = toLocalDayKey(row.occurredAt, timeZone);
  if (reported > asOf) return null;
  return {
    response: entry.response,
    instant: Date.parse(row.occurredAt),
    value: { date: entry.date, source: "member-assessment", reported_at: reported },
  };
}

type Answer = Extract<CheckInInstrument, { instrument: "you-answer" }>["answer"];

function modelAnswer(answer: Answer): Observation {
  switch (answer.key) {
    case "whoopZones": return { whoop_standard_zones: answer.value };
    case "smoking": return { smoking: answer.value };
    case "quitDate": return { quit_date: answer.value };
    case "alcoholDrinksPerWeek": return { alcohol_drinks_per_week: answer.value };
    case "diabetes":
    case "seriousDisease":
      return { [answer.key === "diabetes" ? "diabetes" : "serious_disease"]:
        answer.value === "unsure" ? null : answer.value === "yes" };
    case "selfRatedHealth": return { health: answer.value === "veryGood" ? "very good" : answer.value };
  }
}

/** The canonical projector exposes only the checked response at attributes.checkIn. */
export function assessmentInputs(rows: BrowserVaultEntity[], from: string, asOf: string, timeZone: string) {
  const checkins: Observation[] = [],
    tests: Observation[] = [];
  const answers: { answer: Answer; date: string; instant: number; id: string }[] = [];
  for (const row of rows) {
    const assessment = projectedAssessment(row, from, asOf, timeZone);
    if (!assessment) continue;
    const { response, value } = assessment;
    if (response.instrument === "you-answer") {
      const parsed = oneOffAnswerSchema.safeParse(response.answer);
      if (parsed.success) answers.push({ answer: parsed.data, date: value.reported_at, instant: assessment.instant, id: row.id });
    }
    if (response.instrument === "food-week" && Array.isArray(response.answers)) {
      const aliases: Record<string, string> = {
        plants: "beans_nuts_seeds",
        sweet_drinks: "sweet_drinks_juice",
        seafood: "fish",
        plant_oil: "plant_oil_pct",
        packaged_days: "salty_days",
      };
      const answers = Object.fromEntries(
        response.answers.flatMap((a) =>
          isRecord(a) && typeof a.key === "string" && typeof a.value === "number"
            ? [[lookup(aliases, a.key) ?? a.key, a.value]]
            : [],
        ),
      );
      checkins.push({ ...value, food_week: { complete: true, answers } });
    }
    if (response.instrument === "combine" && response.date === value.date && Array.isArray(response.tests)) {
      tests.push(...submittedTests(response.tests, { ...value, session_id: isRecord(row.attributes.checkIn) ? row.attributes.checkIn.id : row.id }));
    }
  }
  // A revision replaces the old answer from its reporting day onwards, including an explicit unsure.
  answers.sort((a, b) => b.instant - a.instant || b.id.localeCompare(a.id));
  const latest = new Map<Answer["key"], string>();
  for (const { answer, date } of answers) {
    const until = latest.get(answer.key);
    checkins.push({ date, reported_at: date, superseded_on: until, answerKey: answer.key,
      source: "member-assessment", ...modelAnswer(answer) });
    latest.set(answer.key, date);
  }
  return { checkins, tests };
}
function submittedTests(input: unknown[], event: Observation): Observation[] {
  return input.flatMap((test) => {
    if (
      !isRecord(test) ||
      test.skipped ||
      typeof test.key !== "string" ||
      typeof test.value !== "number" ||
      !Number.isFinite(test.value)
    )
      return [];
    const stations: Record<string, [string, string]> = {
      sitting_rising: ["sit_and_rise", "points"],
      single_leg_10s: ["one_leg_balance", "s"],
      grip_strength: ["grip_strength", "kg"],
      broad_jump: ["standing_broad_jump", "cm"],
      chair_stand_30s: ["chair_stands", "count"],
      squats_max: ["squats", "count"],
      step_3min: ["step_recovery", "bpm"],
      march_2min: ["march_recovery", "count"],
    };
    const [key, unit] = lookup(stations, test.key) ?? [test.key, undefined];
    return [
      {
        ...event,
        test: key,
        value: test.value,
        unit,
        variant: test.variant,
        protocol: "murph-combine-v1",
        verified: "self",
        source: "self-report",
      },
    ];
  });
}
function pressureMethod(row: BrowserVaultMetricRow) {
  const q = isRecord(row.context.qualifiers) ? row.context.qualifiers : {};
  return {
    source: String(row.context.provider ?? row.sourceLabel ?? "canonical-measurement"),
    setting: row.context.setting ?? q.setting,
    validated: row.context.validated ?? q.validated,
  };
}
function pressureIdentity(r: BrowserVaultMetricRow) {
  // Canonical pairs share their event ID. Relay observations must carry an acquisition
  // instant and an identified source; day aggregates cannot establish a pair.
  return r.sourceKind === "measurement" && r.recordIds.length === 1
    ? r.recordIds[0]
    : r.sourceKind === "observation" && r.grain === "event" && r.sourceLabel
      ? "relay"
      : null;
}
/** A daily rollup cannot establish simultaneous readings. Use the canonical action pair identity and local time. */
export function pressureInputs(rows: BrowserVaultMetricRow[], timeZone: string): Observation[] {
  const pairs = new Map<
    string,
    {
      date: string;
      time: string;
      upper: Set<number>;
      lower: Set<number>;
      validated: unknown;
      setting: unknown;
      source: string;
    }
  >();
  for (const r of rows) {
    const id = pressureIdentity(r);
    if (
      typeof id !== "string" ||
      !id ||
      r.comparator != null ||
      typeof r.value !== "number" ||
      !Number.isFinite(r.value) ||
      r.unit?.toLowerCase() !== "mmhg" ||
      !r.observedAt ||
      r.statistic !== "value"
    )
      continue;
    const stamp = new Date(r.observedAt);
    if (!Number.isFinite(stamp.valueOf())) continue;
    const local = new Intl.DateTimeFormat("sv-SE", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .format(stamp)
      .replace(" ", "T");
    if (day(local) !== r.date) continue;
    const method = pressureMethod(r);
    const k = JSON.stringify([id, r.observedAt, r.date, method]);
    const pair = pairs.get(k) ?? { date: r.date, time: local, upper: new Set(), lower: new Set(), ...method };
    (r.metricKey === "systolic-blood-pressure" ? pair.upper : pair.lower).add(r.value);
    pairs.set(k, pair);
  }
  return [...pairs.values()]
    .filter((p) => p.upper.size === 1 && p.lower.size === 1)
    .map((p) => ({
      date: p.date,
      datetime: p.time,
      systolic: [...p.upper][0],
      diastolic: [...p.lower][0],
      unit: "mmHg",
      source: p.source,
      setting: p.setting,
      validated: p.validated,
    }));
}
/** Replays the current panel with and without this session, including after publication or retry. */
export function combineAgeEffect(input: YouInputs, id: string, session: Extract<CheckInInstrument, { instrument: "combine" }>) {
  const { evidence, asOf } = input;
  const prior = (evidence.fitness_tests ?? []).filter(row => row.session_id !== id);
  const tests = submittedTests(session.tests, { date: session.date, session_id: id });
  const before = score({ ...evidence, fitness_tests: prior }, asOf);
  const after = score({ ...evidence, fitness_tests: [...prior, ...tests] }, asOf);
  if (!before || !after || withheld(input, asOf, before) || withheld(input, asOf, after)
    || !tests.some(t => (t.test === "sit_and_rise" && after.rows.floor_rise) ||
      (t.test === "one_leg_balance" && t.value === 10 && after.rows.balance))) return undefined;
  return Math.round(10 * (after.unrounded - before.unrounded)) / 10;
}
