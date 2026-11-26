import { isStrictIsoDate } from "@murphai/contracts/time";
import { normalizeLabResultMetricValue, normalizeUnit, resolveLabResultMetricDefinition, unitsEquivalent } from "@murphai/health-metrics";
import type { BrowserVaultLabResultRow } from "@murphai/query/browser";
import type { Analyte, LabDraw } from "./engine";

const analytes = new Map<string, Analyte>([
  ["hdl-c", "hdl"], ["ldl-c", "ldl"], ["ldl-calculated", "ldl"], ["ldl-chol-calc-nih", "ldl"],
  ["triglycerides", "triglycerides"], ["total-cholesterol", "total_chol"],
  ["hs-crp", "hs_crp"], ["insulin", "insulin"], ["hba1c", "a1c"], ["glucose", "glucose"],
]);

const units: Record<Analyte, string> = {
  hdl: "mg/dL", ldl: "mg/dL", triglycerides: "mg/dL", total_chol: "mg/dL",
  hs_crp: "mg/L", insulin: "µIU/mL", a1c: "%", glucose: "mg/dL",
};

const quantity = String.raw`([+-]?(?:\d+(?:\.\d+)?|\.\d+))(?:\s*([A-Za-zµμ%][\wµμ%/]*))?`;
const textInterval = new RegExp(`^${quantity}\\s*-\\s*${quantity}$`);
const textLimit = new RegExp(`^([<>]=?)\\s*${quantity}$`);

function parseTextRange(text: string, unit: string | null) {
  const interval = textInterval.exec(text);
  if (interval) {
    const [, start, startUnit, end, endUnit] = interval;
    if ([startUnit, endUnit].some(suffix => suffix && !unitsEquivalent(suffix, unit))) return;
    const low = Number(start), high = Number(end);
    if (Number.isFinite(low) && Number.isFinite(high)) return { low, high };
    return;
  }
  const limit = textLimit.exec(text);
  if (!limit) return;
  const [, operator, number, suffix] = limit;
  const value = Number(number);
  if (!Number.isFinite(value) || (suffix && !unitsEquivalent(suffix, unit))) return;
  const exclusive = operator === "<" || operator === ">";
  return operator.startsWith("<") ? { high: value, exclusive } : { low: value, exclusive };
}

function reportedRange(row: BrowserVaultLabResultRow): LabDraw["referenceRange"] | null {
  const range = row.referenceRange;
  if (!range) return undefined;
  const bounds = range.low === undefined && range.high === undefined
    ? parseTextRange(range.text?.trim() ?? "", row.unit)
    : range;
  if (!bounds) return undefined;
  // The projection retains the reporting lab's bounds in its original unit.
  function bound(value: number | undefined) {
    if (value === undefined || normalizeUnit(row.unit) === row.normalizedUnit) return value;
    const result = normalizeLabResultMetricValue({ metricKey: row.metricKey, value, unit: row.unit });
    return result.canonicalUnit === row.normalizedUnit ? result.canonicalValue : null;
  }
  const low = bound(bounds.low), high = bound(bounds.high);
  if (low === null || high === null || (low !== undefined && high !== undefined && low > high)) return null;
  if ("exclusive" in bounds && bounds.exclusive && row.normalizedValue === (low ?? high)) return null;
  return { low, high };
}

function normalExactResult(row: BrowserVaultLabResultRow) {
  if (row.comparator !== null || !row.unit) return false;
  if (row.flag !== null) return row.flag === "normal";
  return row.parentResultStatus === "normal" || row.parentResultStatus === "unknown";
}

function eligibleDraw(analyte: Analyte, row: BrowserVaultLabResultRow): LabDraw | null {
  if (!normalExactResult(row)) return null;
  const value = row.normalizedValue;
  const unit = units[analyte];
  if (row.normalizedUnit !== normalizeUnit(unit) || value === null || !Number.isFinite(value) || value < 0) return null;
  const referenceRange = reportedRange(row);
  if (referenceRange === null || value < (referenceRange?.low ?? -Infinity) || value > (referenceRange?.high ?? Infinity)) return null;
  // Supplying a specimen enables the engine's published fallback. An unreadable
  // lab range still permits change and percentile cards, but rules out that fallback.
  const specimen = row.referenceRange && !referenceRange ? undefined : row.specimenKind ?? undefined;
  return { analyte, date: row.date, value, unit, referenceRange, specimen,
    flag: row.flag === "normal" ? "normal" : undefined,
    fasting: row.fastingStatus === "unknown" ? undefined : row.fastingStatus === "fasting" };
}

interface ResolvedDraw { draw: LabDraw; row: BrowserVaultLabResultRow }

function comparableHistory(rows: BrowserVaultLabResultRow[], analyte: Analyte): LabDraw[] {
  const byDate = new Map<string, ResolvedDraw | null>();
  const datesById = new Map<string, string>();
  for (const row of rows) {
    const draw = eligibleDraw(analyte, row);
    const previous = byDate.get(row.date);
    const drawId = row.drawId;
    const otherDate = drawId ? datesById.get(drawId) : undefined;
    if (otherDate && otherDate !== row.date) byDate.set(otherDate, null);
    if (drawId) datesById.set(drawId, row.date);
    // A conflicting duplicate or multiple independent draws on a date cannot
    // supply one authoritative daily value to the engine.
    if (draw && drawId && (!otherDate || otherDate === row.date) && (previous === undefined
      || (previous && previous.row.drawId === drawId && previous.row.metricKey === row.metricKey
        && previous.row.specimenKind === row.specimenKind
        && JSON.stringify(previous.draw) === JSON.stringify(draw)))) {
      byDate.set(row.date, { draw, row });
    } else {
      byDate.set(row.date, null);
    }
  }
  const dates = [...byDate.keys()].sort();
  const latest = byDate.get(dates[dates.length - 1]);
  if (!latest) return [];
  const needsFast = analyte === "triglycerides" || analyte === "glucose" || analyte === "insulin";
  return dates.flatMap(date => {
    const result = byDate.get(date);
    if (result === latest) return [latest.draw];
    if (!result || result.row.metricKey !== latest.row.metricKey || result.row.specimenKind !== latest.row.specimenKind
      || (needsFast && !(latest.draw.fasting && result.draw.fasting))) return [];
    return [result.draw];
  });
}

/** Only the latest observed date can represent an analyte, including when that date is ineligible. */
export function readHealthWinLabs(rows: readonly BrowserVaultLabResultRow[], today: string): LabDraw[] {
  const groups = new Map<Analyte, BrowserVaultLabResultRow[]>();
  for (const row of rows) {
    if (!isStrictIsoDate(row.date) || row.date > today) continue;
    const definition = resolveLabResultMetricDefinition(row.metricKey);
    const analyte = definition && analytes.get(definition.key);
    if (!analyte) continue;
    const group = groups.get(analyte);
    if (group) group.push(row);
    else groups.set(analyte, [row]);
  }
  return [...groups].flatMap(([analyte, group]) => comparableHistory(group, analyte));
}
