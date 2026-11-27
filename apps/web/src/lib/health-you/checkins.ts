import { toLocalDayKey } from "@murphai/contracts";
import type { BrowserVaultEntity, BrowserVaultMetricRow } from "@murphai/query/browser-replica-client";
import { isRecord } from "../primitives";
import { day, lookup, type MemberEvidence, type Observation } from "./engine/model";
import { score } from "./engine";

function projectedAssessment(row: BrowserVaultEntity, from: string, asOf: string, timeZone: string) {
  const entry = row.attributes.checkIn;
  if (
    !isRecord(entry) ||
    typeof entry.date !== "string" ||
    !day(entry.date) ||
    entry.date < from ||
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
    value: { date: entry.date, source: "member-assessment", reported_at: reported },
  };
}

/** The canonical projector exposes only the checked response at attributes.checkIn. */
export function assessmentInputs(rows: BrowserVaultEntity[], from: string, asOf: string, timeZone: string) {
  const checkins: Observation[] = [],
    tests: Observation[] = [];
  for (const row of rows) {
    const assessment = projectedAssessment(row, from, asOf, timeZone);
    if (!assessment) continue;
    const { response, value } = assessment;
    if (
      response.instrument === "you-answer" &&
      isRecord(response.answer) &&
      response.answer.key === "whoopZones" &&
      ["yes", "no", "notSure"].includes(String(response.answer.value))
    ) {
      checkins.push({ ...value, whoop_standard_zones: response.answer.value });
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
      tests.push(...submittedTests(response.tests, { ...value, session_id: row.id }));
    }
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
/** Preview of the contribution of validated, protocol-qualified results. Omit for self-counted tests. */
export function combineAgeEffect(evidence: MemberEvidence, date: string, tests: Observation[]) {
  const before = score(evidence, date),
    after = score({ ...evidence, fitness_tests: [...(evidence.fitness_tests ?? []), ...tests] }, date);
  if (
    !before ||
    !after ||
    !["grip", "floor_rise", "balance"].some((k) => after.rows[k] && after.rows[k].years !== before.rows[k]?.years)
  )
    return undefined;
  const total = (rows: typeof after.rows) => Object.values(rows).reduce((s, r) => s + r.years, 0);
  return Math.round(10 * (total(after.rows) - total(before.rows))) / 10;
}
