import {
  groupLabItemsByHealthArea,
  normalizeMetricKey,
  normalizeMetricValue,
  normalizeUnit,
  resolveIndexedLabHealthArea,
  resolveLabResultMetricDefinition,
  unitsEquivalent,
  type LabHealthArea,
  type MetricPoint,
} from "@murphai/health-metrics";

import type { CanonicalEntity } from "../canonical-entities.ts";
import type {
  BrowserVaultLabResultFilters,
  BrowserVaultLabResultReferenceRange,
  BrowserVaultLabResultRow,
  BrowserVaultLabSpecimenKind,
  BrowserVaultLabsCapableQueryClient,
} from "./shared.ts";

export const BROWSER_VAULT_LAB_RESULT_ROW_SCHEMA = "murph.browser-vault.lab-result-row.v1" as const;

export interface BrowserVaultLabBiomarkerSeriesPoint {
  date: string;
  observedAt: string;
  rowId: string;
  unit: string;
  value: number;
}

export interface BrowserVaultMeasuredBiomarker {
  biomarkerKey: string | null;
  displayName: string;
  firstDate: string;
  healthArea: LabHealthArea;
  lastDate: string;
  latest: BrowserVaultPresentedLabResultRow;
  metricKey: string;
  resultCount: number;
}

export interface BrowserVaultNormalizedLabReferenceRange
  extends BrowserVaultLabResultReferenceRange {
  highComparator?: "<" | "<=";
  lowComparator?: ">" | ">=";
}

export interface BrowserVaultPresentedLabResultRow
  extends BrowserVaultLabResultRow {
  normalizedReferenceRange: BrowserVaultNormalizedLabReferenceRange | null;
  statusSource:
    | "published_comparator"
    | "reported"
    | "reporting_lab_flag"
    | "reporting_lab_range";
}

export interface BrowserVaultLabBiomarkerDetail {
  biomarkerKey: string | null;
  chartSeries: BrowserVaultLabBiomarkerSeriesPoint[];
  comparableUnit: string | null;
  displayName: string;
  hasIncompatibleHistory: boolean;
  latest: BrowserVaultPresentedLabResultRow;
  metricKey: string;
  rows: BrowserVaultPresentedLabResultRow[];
}

export function toBrowserVaultLabResultRows(input: {
  entities: readonly CanonicalEntity[];
  points: readonly MetricPoint[];
}): BrowserVaultLabResultRow[] {
  const testsById = new Map(
    input.entities
      .filter((entity) => entity.family === "event" && entity.kind === "test")
      .map((entity) => [entity.entityId, entity]),
  );
  const rowsById = new Map<string, BrowserVaultLabResultRow>();

  for (const point of input.points) {
    if (point.source.kind !== "test-result") continue;
    const resultIndex = point.source.resultIndex;
    if (resultIndex === null || !Number.isInteger(resultIndex) || resultIndex < 0) continue;

    const value = readFiniteNumber(point.value);
    const textValue = readOptionalString(point.textValue);
    if (value === null && textValue === null) continue;

    const test = testsById.get(point.source.recordId) ?? null;
    if (!test) continue;
    const result = readRecord(readArray(test.attributes.results)[resultIndex]);
    const definition = resolveLabResultMetricDefinition(point.metricKey);
    const canonicalValue = readFiniteNumber(point.canonicalValue);
    const canUseRawComparableValue = definition === null || definition.canonicalUnit === null;
    const comparableValue = value === null
      ? null
      : canonicalValue ?? (canUseRawComparableValue ? value : null);
    const comparableUnit = comparableValue === null
      ? null
      : readOptionalString(point.canonicalUnit)
        ?? (canUseRawComparableValue ? normalizeUnit(point.unit) : null);
    const normalizedValue = comparableUnit === null ? null : comparableValue;
    const normalizedUnit = normalizedValue === null ? null : comparableUnit;
    const row: BrowserVaultLabResultRow = {
      analyte: readOptionalString(result?.analyte) ?? point.metricKey,
      biomarkerKey: readOptionalString(point.biomarkerKey),
      comparator: point.comparator,
      date: point.effectiveDate,
      flag: readOptionalString(point.context.flag),
      id: `lab-result-row:${point.id}`,
      labName: readOptionalString(point.provenance.labName)
        ?? readOptionalString(test.attributes.labName),
      metricKey: point.metricKey,
      normalizedUnit,
      normalizedValue,
      observedAt: point.observedAt,
      referenceRange: readReferenceRange(point.context.referenceRange),
      rowSchema: BROWSER_VAULT_LAB_RESULT_ROW_SCHEMA,
      sourceLabel: readOptionalString(point.provenance.sourceLabel),
      specimenKind: readLabSpecimenKind(test.attributes.specimenType),
      textValue,
      unit: readOptionalString(point.unit),
      value,
    };
    rowsById.set(row.id, row);
  }

  return sortBrowserVaultLabResultRows([...rowsById.values()]);
}

function readLabSpecimenKind(value: unknown): BrowserVaultLabSpecimenKind | null {
  return value === "serum" || value === "plasma" || value === "whole_blood"
    ? value
    : null;
}

export function labResultRowMatchesFilters(
  row: BrowserVaultLabResultRow,
  filters: BrowserVaultLabResultFilters,
): boolean {
  if (filters.metricKey && row.metricKey !== normalizeMetricFilterKey(filters.metricKey)) return false;
  if (filters.biomarkerKey && row.biomarkerKey !== filters.biomarkerKey) return false;
  if (filters.from && row.date < filters.from) return false;
  if (filters.to && row.date > filters.to) return false;
  return true;
}

export function sortBrowserVaultLabResultRows(
  rows: readonly BrowserVaultLabResultRow[],
): BrowserVaultLabResultRow[] {
  return rows.slice().sort((left, right) => {
    if (left.date !== right.date) return left.date.localeCompare(right.date);
    if (left.observedAt !== right.observedAt) return left.observedAt.localeCompare(right.observedAt);
    return left.id.localeCompare(right.id);
  });
}

export function selectBrowserVaultMeasuredBiomarkers(
  client: BrowserVaultLabsCapableQueryClient,
): BrowserVaultMeasuredBiomarker[] {
  const rowsByMetricKey = new Map<string, BrowserVaultLabResultRow[]>();
  for (const row of client.labResults.list()) {
    const rows = rowsByMetricKey.get(row.metricKey);
    if (rows) {
      rows.push(row);
    } else {
      rowsByMetricKey.set(row.metricKey, [row]);
    }
  }

  const biomarkers = [...rowsByMetricKey.entries()].flatMap(([metricKey, rows]) => {
    const healthArea = resolveIndexedLabHealthArea(metricKey);
    if (!healthArea) return [];
    const detail = buildLabBiomarkerDetail(metricKey, rows);
    if (!detail) return [];
    return [{
      biomarkerKey: detail.biomarkerKey,
      displayName: detail.displayName,
      firstDate: detail.rows[0]?.date ?? detail.latest.date,
      healthArea,
      lastDate: detail.latest.date,
      latest: detail.latest,
      metricKey: detail.metricKey,
      resultCount: detail.rows.length,
    } satisfies BrowserVaultMeasuredBiomarker];
  });

  const alphabetized = biomarkers.sort((left, right) =>
    left.displayName.localeCompare(right.displayName) || left.metricKey.localeCompare(right.metricKey)
  );
  return groupLabItemsByHealthArea(alphabetized, (biomarker) => biomarker.metricKey)
    .flatMap((group) => group.items);
}

export function selectBrowserVaultLabBiomarkerDetail(
  client: BrowserVaultLabsCapableQueryClient,
  metricKey: string,
): BrowserVaultLabBiomarkerDetail | null {
  const rows = client.labResults.list({ metricKey });
  return buildLabBiomarkerDetail(normalizeMetricFilterKey(metricKey), rows);
}

function buildLabBiomarkerDetail(
  metricKey: string,
  inputRows: readonly BrowserVaultLabResultRow[],
): BrowserVaultLabBiomarkerDetail | null {
  const rows = sortBrowserVaultLabResultRows(inputRows).map(toPresentedLabResultRow);
  const latest = rows.at(-1);
  if (!latest) return null;

  const comparableCandidates = rows.filter(isComparableNumericRow);
  const comparableUnit = comparableCandidates.at(-1)?.normalizedUnit ?? null;
  const comparableRows = comparableUnit === null
    ? []
    : rows.filter((row): row is BrowserVaultPresentedLabResultRow & {
        normalizedUnit: string;
        normalizedValue: number;
      } => isComparableNumericRow(row) && row.normalizedUnit === comparableUnit);
  const chartSeries = comparableRows.map((row) => ({
    date: row.date,
    observedAt: row.observedAt,
    rowId: row.id,
    unit: row.normalizedUnit,
    value: row.normalizedValue,
  }));
  const numericNonComparatorRows = rows.filter((row) => row.value !== null && row.comparator === null);
  const definition = resolveLabResultMetricDefinition(metricKey);

  return {
    biomarkerKey: latest.biomarkerKey
      ?? rows.slice().reverse().find((row) => row.biomarkerKey !== null)?.biomarkerKey
      ?? null,
    chartSeries,
    comparableUnit,
    displayName: definition?.displayName ?? latest.analyte,
    hasIncompatibleHistory: numericNonComparatorRows.some((row) =>
      !isComparableNumericRow(row) || row.normalizedUnit !== comparableUnit
    ),
    latest,
    metricKey: latest.metricKey,
    rows,
  };
}

function isComparableNumericRow(
  row: BrowserVaultPresentedLabResultRow,
): row is BrowserVaultPresentedLabResultRow & { normalizedUnit: string; normalizedValue: number } {
  return row.value !== null
    && row.comparator === null
    && typeof row.normalizedValue === "number"
    && Number.isFinite(row.normalizedValue)
    && typeof row.normalizedUnit === "string"
    && row.normalizedUnit.length > 0;
}

function toPresentedLabResultRow(
  row: BrowserVaultLabResultRow,
): BrowserVaultPresentedLabResultRow {
  if (row.unit === null) {
    return {
      ...row,
      normalizedReferenceRange: normalizeLabReferenceRange({
        ...row,
        normalizedUnit: null,
        normalizedValue: null,
      }),
      normalizedUnit: null,
      normalizedValue: null,
      statusSource: row.flag?.trim() ? "reporting_lab_flag" : "reported",
    };
  }
  return {
    ...row,
    normalizedReferenceRange: normalizeLabReferenceRange(row),
    statusSource: row.flag?.trim() ? "reporting_lab_flag" : "reported",
  };
}

function normalizeLabReferenceRange(
  row: BrowserVaultLabResultRow,
): BrowserVaultNormalizedLabReferenceRange | null {
  if (row.referenceRange === null) {
    return null;
  }

  const parsed = parseNumericLabReferenceRange(row.referenceRange, row.unit);
  if (!parsed) {
    return null;
  }

  if (row.normalizedValue === null || row.normalizedUnit === null) {
    const rawUnitsMatch = (parsed.unit === null && row.unit === null)
      || unitsEquivalent(parsed.unit, row.unit);
    if (row.value === null || !rawUnitsMatch) {
      return null;
    }
    return {
      ...(parsed.high !== undefined ? { high: parsed.high } : {}),
      ...(parsed.highComparator ? { highComparator: parsed.highComparator } : {}),
      ...(parsed.low !== undefined ? { low: parsed.low } : {}),
      ...(parsed.lowComparator ? { lowComparator: parsed.lowComparator } : {}),
    };
  }

  const low = parsed.low === undefined
    ? undefined
    : normalizeLabReferenceBoundary({
        metricKey: row.metricKey,
        sourceUnit: parsed.unit,
        targetUnit: row.normalizedUnit,
        value: parsed.low,
      });
  const high = parsed.high === undefined
    ? undefined
    : normalizeLabReferenceBoundary({
        metricKey: row.metricKey,
        sourceUnit: parsed.unit,
        targetUnit: row.normalizedUnit,
        value: parsed.high,
      });

  if (
    (parsed.low !== undefined && low === null)
    || (parsed.high !== undefined && high === null)
    || (low !== undefined && low !== null && high !== undefined && high !== null && low > high)
  ) {
    return null;
  }

  return {
    ...(high !== undefined && high !== null ? { high } : {}),
    ...(parsed.highComparator ? { highComparator: parsed.highComparator } : {}),
    ...(low !== undefined && low !== null ? { low } : {}),
    ...(parsed.lowComparator ? { lowComparator: parsed.lowComparator } : {}),
  };
}

interface ParsedNumericLabReferenceRange {
  high?: number;
  highComparator?: "<" | "<=";
  low?: number;
  lowComparator?: ">" | ">=";
  unit: string | null;
}

const LAB_RANGE_NUMBER = String.raw`[+-]?(?:(?:(?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`;
const BOUNDED_LAB_RANGE_PATTERN = new RegExp(
  String.raw`^\s*(${LAB_RANGE_NUMBER})\s*(?:-|–|—|to)\s*(${LAB_RANGE_NUMBER})\s*(.*?)\s*$`,
  "iu",
);
const SYMBOLIC_LAB_RANGE_PATTERN = new RegExp(
  String.raw`^\s*(<=|>=|<|>|≤|≥)\s*(${LAB_RANGE_NUMBER})\s*(.*?)\s*$`,
  "u",
);
const PHRASED_LAB_RANGE_PATTERN = new RegExp(
  String.raw`^\s*(less than or equal to|greater than or equal to|less than|greater than|up to|at most|at least)\s+(${LAB_RANGE_NUMBER})\s*(.*?)\s*$`,
  "iu",
);

function parseNumericLabReferenceRange(
  range: BrowserVaultLabResultReferenceRange,
  reportedUnit: string | null,
): ParsedNumericLabReferenceRange | null {
  const textRange = range.text ? parseNumericLabReferenceText(range.text, reportedUnit) : null;
  if (range.low === undefined && range.high === undefined) {
    return textRange;
  }
  if (range.text && !structuredLabRangeMatchesText(range, textRange, reportedUnit)) {
    return null;
  }
  const highComparator = textRange !== null && textRange.high === range.high
    ? textRange.highComparator
    : undefined;
  const lowComparator = textRange !== null && textRange.low === range.low
    ? textRange.lowComparator
    : undefined;

  return {
    ...(range.high !== undefined ? { high: range.high } : {}),
    ...(highComparator ? { highComparator } : {}),
    ...(range.low !== undefined ? { low: range.low } : {}),
    ...(lowComparator ? { lowComparator } : {}),
    unit: reportedUnit,
  };
}

function structuredLabRangeMatchesText(
  range: BrowserVaultLabResultReferenceRange,
  textRange: ParsedNumericLabReferenceRange | null,
  reportedUnit: string | null,
): textRange is ParsedNumericLabReferenceRange {
  if (!textRange) {
    return false;
  }
  const unitsMatch = textRange.unit === null && reportedUnit === null
    ? true
    : unitsEquivalent(textRange.unit, reportedUnit);
  return unitsMatch
    && (textRange.low !== undefined) === (range.low !== undefined)
    && (textRange.high !== undefined) === (range.high !== undefined)
    && textRange.low === range.low
    && textRange.high === range.high;
}

function parseNumericLabReferenceText(
  text: string,
  reportedUnit: string | null,
): ParsedNumericLabReferenceRange | null {
  const bounded = BOUNDED_LAB_RANGE_PATTERN.exec(text);
  if (bounded?.[1] && bounded[2] !== undefined) {
    const low = parseLabRangeNumber(bounded[1]);
    const high = parseLabRangeNumber(bounded[2]);
    if (low === null || high === null || low > high) {
      return null;
    }
    return {
      high,
      low,
      unit: readOptionalString(bounded[3]) ?? reportedUnit,
    };
  }

  const symbolic = SYMBOLIC_LAB_RANGE_PATTERN.exec(text);
  if (symbolic?.[1] && symbolic[2] !== undefined) {
    return oneSidedLabReferenceRange(
      symbolic[1],
      symbolic[2],
      readOptionalString(symbolic[3]) ?? reportedUnit,
    );
  }

  const phrased = PHRASED_LAB_RANGE_PATTERN.exec(text);
  if (phrased?.[1] && phrased[2] !== undefined) {
    return oneSidedLabReferenceRange(
      phrased[1].toLowerCase(),
      phrased[2],
      readOptionalString(phrased[3]) ?? reportedUnit,
    );
  }

  return null;
}

function oneSidedLabReferenceRange(
  comparator: string,
  rawValue: string,
  unit: string | null,
): ParsedNumericLabReferenceRange | null {
  const value = parseLabRangeNumber(rawValue);
  if (value === null) {
    return null;
  }

  switch (comparator) {
    case "<":
    case "less than":
      return { high: value, highComparator: "<", unit };
    case "<=":
    case "≤":
    case "less than or equal to":
    case "up to":
    case "at most":
      return { high: value, highComparator: "<=", unit };
    case ">":
    case "greater than":
      return { low: value, lowComparator: ">", unit };
    case ">=":
    case "≥":
    case "greater than or equal to":
    case "at least":
      return { low: value, lowComparator: ">=", unit };
    default:
      return null;
  }
}

function parseLabRangeNumber(value: string): number | null {
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLabReferenceBoundary(input: {
  metricKey: string;
  sourceUnit: string | null;
  targetUnit: string;
  value: number;
}): number | null {
  const normalized = normalizeMetricValue({
    metricKey: input.metricKey,
    unit: input.sourceUnit,
    value: input.value,
  });
  if (
    normalized.canonicalValue !== null
    && unitsEquivalent(normalized.canonicalUnit, input.targetUnit)
  ) {
    return normalized.canonicalValue;
  }

  return unitsEquivalent(input.sourceUnit, input.targetUnit) ? input.value : null;
}

function normalizeMetricFilterKey(metricKey: string): string {
  return resolveLabResultMetricDefinition(metricKey)?.key
    ?? normalizeMetricKey(metricKey);
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readReferenceRange(value: unknown): BrowserVaultLabResultReferenceRange | null {
  const record = readRecord(value);
  if (!record) return null;
  const low = readFiniteNumber(record.low);
  const high = readFiniteNumber(record.high);
  const text = readOptionalString(record.text);
  if (low === null && high === null && text === null) return null;
  return {
    ...(low !== null ? { low } : {}),
    ...(high !== null ? { high } : {}),
    ...(text !== null ? { text } : {}),
  };
}
