import { REVIEWED_BIOMARKER_FALLBACK_RANGES } from "@murphai/health-metrics";
import type { LabNormMetric } from "../../game/progress/norms";
import { percentileCandidate } from "./percentiles";
import { cardDateKey, cardText, formatLabValue, formatNumber, formatWinDate, isDate, labUnitKey, mad, median } from "./shared";
import type { Analyte, Candidate, HealthWinRank, HealthWinsInput, LabDraw } from "./types";

interface Bound { value: number; inclusive: boolean }
interface Interval { low?: Bound; high?: Bound; source: string }
export interface LabCharts {
  lab_change: {
    type: "lab_trend"; unit: string;
    baseline: { value: number; draws: number };
    latest: { value: number; date: string };
  };
  lab_range: { type: "gauge"; value: number; unit: string; range: Interval; date: string };
}

interface LabRule { label: string; unit: string; rankMetric?: LabNormMetric; step?: number; fallbackKey?: string }
const analytes: Record<Analyte, LabRule> = {
  hdl: { label: "HDL", unit: "mg/dL", rankMetric: "hdlCholesterol", step: 5 },
  ldl: { label: "LDL", unit: "mg/dL", rankMetric: "ldlCholesterol", step: 10, fallbackKey: "biomarker:ldl-c" },
  triglycerides: { label: "triglycerides", unit: "mg/dL", rankMetric: "triglycerides", step: 15, fallbackKey: "biomarker:triglycerides" },
  total_chol: { label: "total cholesterol", unit: "mg/dL", rankMetric: "totalCholesterol", fallbackKey: "biomarker:total-cholesterol" },
  hs_crp: { label: "hs-CRP", unit: "mg/L", rankMetric: "hsCrp", step: 0.3, fallbackKey: "biomarker:hs-crp" },
  insulin: { label: "insulin", unit: "µIU/mL", rankMetric: "fastingInsulin", step: 2 },
  a1c: { label: "A1c", unit: "%", rankMetric: "hba1c", step: 0.2 },
  glucose: { label: "glucose", unit: "mg/dL", step: 5 },
};

function sameDraw(a: LabDraw, b: LabDraw): boolean {
  return a.value === b.value && a.unit === b.unit && a.flag === b.flag && (a.fasting ?? null) === (b.fasting ?? null)
    && a.specimen === b.specimen && a.referenceRange?.low === b.referenceRange?.low
    && a.referenceRange?.high === b.referenceRange?.high;
}

/** Day-level imports can repeat. Ambiguous dates cannot supply independent draw evidence. */
function drawHistory(rows: readonly LabDraw[], analyte: Analyte, today: string) {
  const days = new Map<string, LabDraw | null>();
  for (const draw of rows) {
    if (draw.analyte !== analyte || !isDate(draw.date) || draw.date > today) continue;
    const existing = days.get(draw.date);
    days.set(draw.date, existing === undefined || (existing && sameDraw(existing, draw)) ? draw : null);
  }
  const dates = [...days.keys()].sort();
  const latestDay = dates.pop();
  const latest = latestDay && days.get(latestDay);
  if (!latest || !latest.unit.trim() || cardText(latest.unit) !== latest.unit.trim() || !Number.isFinite(latest.value) || latest.value < 0
    || latest.flag === "high" || latest.flag === "low") return;
  const prior = dates.flatMap(date => {
    const draw = days.get(date);
    return draw && labUnitKey(draw.unit) === labUnitKey(latest.unit) && Number.isFinite(draw.value) && draw.value >= 0 ? [draw] : [];
  });
  return { latest, prior };
}

function reportedInterval({ low, high }: NonNullable<LabDraw["referenceRange"]>): Interval | undefined {
  if (low === undefined && high === undefined) return;
  if (low !== undefined && !Number.isFinite(low)) return;
  if (high !== undefined && !Number.isFinite(high)) return;
  if (low !== undefined && high !== undefined && low > high) return;
  return {
    low: low === undefined ? undefined : { value: low, inclusive: true },
    high: high === undefined ? undefined : { value: high, inclusive: true },
    source: "Reporting laboratory reference range",
  };
}

function publishedInterval(draw: LabDraw, age: number | null, rule: LabRule): Interval | undefined {
  if (!rule.fallbackKey || age === null || age < 18 || draw.specimen !== "serum"
    || (draw.analyte === "triglycerides" && draw.fasting !== true)) return;
  const row = REVIEWED_BIOMARKER_FALLBACK_RANGES[rule.fallbackKey]?.find(({ displayFallback, range }) =>
    displayFallback && range.unit === draw.unit && range.eligibleSpecimenKinds.includes("serum"));
  if (row) return {
    low: row.range.lowerBound, high: row.range.upperBound,
    source: `${row.range.label} (${row.range.source.organization}, ${row.range.source.year})`,
  };
}

function includesValue(range: Interval, value: number): boolean {
  return (!range.low || value > range.low.value || (value === range.low.value && range.low.inclusive))
    && (!range.high || value < range.high.value || (value === range.high.value && range.high.inclusive));
}

function intervalSubtitle({ low, high }: Interval, unit: string): string {
  // Keep exact bounds in the gauge when rounding them would change the stated range.
  if ([low, high].some(bound => bound && !Number.isInteger(bound.value * 10))) return "within the reference range";
  if (low && high) return `within ${formatNumber(low.value)}–${formatLabValue(high.value, unit)}`;
  if (low) return `${low.inclusive ? "at or above" : "above"} ${formatLabValue(low.value, unit)}`;
  return `${high!.inclusive ? "at or below" : "below"} ${formatLabValue(high!.value, unit)}`;
}

function labChange(latest: LabDraw, prior: LabDraw[], rule: LabRule, dateLabel: string): Candidate | undefined {
  if (!rule.step || labUnitKey(rule.unit) !== labUnitKey(latest.unit)) return;
  let reference = prior;
  const fastingRelevant = latest.analyte === "glucose" || latest.analyte === "triglycerides";
  const fastingKnown = fastingRelevant && (latest.fasting != null || prior.some(draw => draw.fasting != null));
  if (fastingKnown) {
    if (latest.fasting !== true) return;
    reference = prior.filter(draw => draw.fasting === true);
  }
  if (reference.length < 2) return;
  const values = reference.map(draw => draw.value);
  const baseline = median(values);
  // Decimal lab units can land one floating-point ulp below an exact clinical step.
  const delta = Number((latest.value - baseline).toPrecision(12));
  const effect = latest.analyte === "hdl" ? delta : -delta;
  if (effect < rule.step) return;
  return {
    date: latest.date, effect, noise: Math.max(rule.step, mad(values)),
    card: {
      id: `lab-change-${latest.analyte}-${cardDateKey(latest.date)}`, kind: "lab_change", filter: "Labs",
      title: { number: `${delta > 0 ? "+" : "−"}${formatLabValue(effect, latest.unit === "%" ? "pp" : latest.unit)}`, measure: rule.label },
      subtitle: `compared with the median of ${values.length} prior draws`,
      source_note: `Latest draw on ${dateLabel}. ${fastingKnown ? "Fasting draws" : "Lab draws"} in ${latest.unit}.`,
      chart: { type: "lab_trend", unit: latest.unit, baseline: { value: baseline, draws: values.length }, latest: { date: dateLabel, value: latest.value } },
    },
  };
}

export function labCandidates(input: HealthWinsInput, rank: HealthWinRank): Candidate[] {
  const candidates: Candidate[] = [];
  for (const analyte of Object.keys(analytes) as Analyte[]) {
    const rule = analytes[analyte];
    const history = drawHistory(input.labs ?? [], analyte, input.member.today);
    if (!history) continue;
    const { latest, prior } = history;
    const interval = latest.referenceRange
      ? reportedInterval(latest.referenceRange)
      : publishedInterval(latest, input.member.age, rule);
    const within = interval && includesValue(interval, latest.value);
    if (latest.referenceRange && !within) continue;

    const dateLabel = formatWinDate(latest.date, input.member.today);
    const change = labChange(latest, prior, rule, dateLabel);
    if (change) candidates.push(change);
    const percentile = rule.rankMetric && percentileCandidate({
      rank: rank(rule.rankMetric, latest.value, { member: input.member, unit: latest.unit, fasting: latest.fasting }),
      value: latest.value,
      id: analyte, label: rule.label, unit: latest.unit, filter: "Labs", date: latest.date,
      observation: `Lab draw on ${dateLabel}`,
    }, input.member.today);
    if (percentile) candidates.push(percentile);
    if (!change && !percentile && interval && within) candidates.push({
      date: latest.date, effect: 0, noise: 1,
      card: {
        id: `lab-range-${analyte}-${cardDateKey(latest.date)}`, kind: "lab_range", filter: "Labs",
        title: { number: formatLabValue(latest.value, latest.unit), measure: rule.label },
        subtitle: intervalSubtitle(interval, latest.unit),
        source_note: `${interval.source}. Draw on ${dateLabel}.`,
        chart: { type: "gauge", value: latest.value, unit: latest.unit, range: interval, date: dateLabel },
      },
    });
  }
  return candidates;
}
