import { isStrictIsoDate } from "@murphai/contracts/time";
import { normalizeLabResultMetricValue, normalizeUnit, resolveLabResultMetricDefinition } from "@murphai/health-metrics";
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

function reportedRange(row: BrowserVaultLabResultRow): LabDraw["referenceRange"] | null {
  const range = row.referenceRange;
  if (!range) return undefined;
  if (range.low === undefined && range.high === undefined) return null;
  // The projection retains the reporting lab's bounds in its original unit.
  function bound(value: number | undefined) {
    if (value === undefined || normalizeUnit(row.unit) === row.normalizedUnit) return value;
    const result = normalizeLabResultMetricValue({ metricKey: row.metricKey, value, unit: row.unit });
    return result.canonicalUnit === row.normalizedUnit ? result.canonicalValue : null;
  }
  const low = bound(range.low), high = bound(range.high);
  if (low === null || high === null || (low !== undefined && high !== undefined && low > high)) return null;
  return { low, high };
}

function normalExactResult(row: BrowserVaultLabResultRow) {
  return row.parentResultStatus === "normal" && (row.flag === null || row.flag === "normal")
    && row.comparator === null && Boolean(row.unit);
}

function eligibleDraw(analyte: Analyte, row: BrowserVaultLabResultRow): LabDraw | null {
  if (!normalExactResult(row)) return null;
  const value = row.normalizedValue;
  const unit = units[analyte];
  if (row.normalizedUnit !== normalizeUnit(unit) || value === null || !Number.isFinite(value) || value < 0) return null;
  const referenceRange = reportedRange(row);
  if (referenceRange === null || value < (referenceRange?.low ?? -Infinity) || value > (referenceRange?.high ?? Infinity)) return null;
  return { analyte, date: row.date, value, unit, referenceRange, specimen: row.specimenKind ?? undefined,
    flag: row.flag === "normal" ? "normal" : undefined,
    fasting: row.fastingStatus === "unknown" ? undefined : row.fastingStatus === "fasting" };
}

interface ResolvedDraw { draw: LabDraw; method: string; drawId: string }

function comparableHistory(rows: BrowserVaultLabResultRow[], analyte: Analyte): LabDraw[] {
  const byDate = new Map<string, ResolvedDraw | null>();
  const datesById = new Map<string, string>();
  for (const row of rows) {
    const draw = eligibleDraw(analyte, row);
    const previous = byDate.get(row.date);
    const method = row.metricKey;
    const drawId = row.drawId;
    const otherDate = drawId ? datesById.get(drawId) : undefined;
    if (otherDate && otherDate !== row.date) byDate.set(otherDate, null);
    if (drawId) datesById.set(drawId, row.date);
    // A conflicting duplicate or multiple independent draws on a date cannot
    // supply one authoritative daily value to the engine.
    if (draw && drawId && (!otherDate || otherDate === row.date) && (previous === undefined
      || (previous && previous.drawId === drawId && previous.method === method
        && JSON.stringify(previous.draw) === JSON.stringify(draw)))) {
      byDate.set(row.date, { draw, drawId, method });
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
    if (!result || result.method !== latest.method || result.draw.specimen !== latest.draw.specimen
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
