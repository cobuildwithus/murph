import type { BrowserVaultEntity, BrowserVaultMetricRow } from "@murphai/query/browser-replica-client";
import { isRecord } from "../primitives";
import { day, type MemberEvidence, type Observation } from "./engine/model";
import { score } from "./engine";

const answerValues: Record<string, readonly unknown[]> = {
  smoking: ["current", "former", "never"],
  diabetes: [true, false],
  serious_disease: [true, false],
  health: [1, 2, 3, 4, 5],
  pregnant: [true, false],
  postpartum: [true, false],
};
export function checkInAnswer(key: unknown, value: unknown, date: string): Observation | null {
  if (typeof key !== "string" || !day(date)) return null;
  if (Object.hasOwn(answerValues, key) && answerValues[key].includes(value)) return { date, [key]: value, source: "member-assessment" };
  if (key === "alcohol_g_day" && typeof value === "number" && value >= 0 && value <= 300)
    return { date, alcohol_g_day: value, source: "member-assessment" };
  return null;
}
/** Read only the versioned numeric/categorical projection. Narrative fields never enter the engine. */
export function assessmentInputs(rows: BrowserVaultEntity[], asOf: string) {
  const checkins: Observation[] = [],
    tests: Observation[] = [];
  for (const row of rows) {
    const a = row.attributes,
      date = row.date;
    if (!date || !day(date) || date > asOf || !isRecord(a.responses)) continue;
    const r = a.responses;
    if (a.questionnaireSlug === "health-you-answer-v1") {
      const answer = checkInAnswer(r.key, r.value, date);
      if (answer) checkins.push(answer);
    }
    if (a.questionnaireSlug === "health-food-week-v1" && typeof r.habitual_fibre_g_day === "number")
      checkins.push({ date, source: "member-assessment", habitual_fibre_g_day: r.habitual_fibre_g_day });
    if (a.questionnaireSlug === "health-combine-v1" && Array.isArray(r.tests) && r.safety === "clear") {
      for (const t of r.tests)
        if (isRecord(t) && !t.skipped && typeof t.value === "number" && Number.isFinite(t.value))
          tests.push({
            date,
            test: t.key,
            value: t.value,
            unit: t.unit,
            source: "self-report",
            protocol: "murph-combine-v1",
          });
    }
  }
  return { checkins, tests };
}
/** A daily rollup cannot establish simultaneous readings. Use the canonical action pair identity and local time. */
export function pressureInputs(rows: BrowserVaultMetricRow[], timeZone: string): Observation[] {
  const pairs = new Map<
    string,
    { date: string; time: string; upper: Set<number>; lower: Set<number>; validated: boolean; setting: string }
  >();
  for (const r of rows) {
    const id = r.context.pairId;
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
    const k = JSON.stringify([id, r.observedAt, r.date]),
      setting = String(r.context.setting ?? "home");
    const pair = pairs.get(k) ?? {
      date: r.date,
      time: local,
      upper: new Set(),
      lower: new Set(),
      validated: r.context.validated === true,
      setting,
    };
    if (pair.setting !== setting || r.context.validated !== true) pair.validated = false;
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
      source: "canonical-measurement",
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
