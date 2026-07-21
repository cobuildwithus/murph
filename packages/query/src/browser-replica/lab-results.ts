import {
  groupLabItemsByHealthArea,
  normalizeMetricKey,
  normalizeUnit,
  resolveIndexedLabHealthArea,
  resolveLabHealthArea,
  resolveMetricDefinition,
  type LabHealthArea,
  type MetricPoint,
} from "@murphai/health-metrics";

import type { CanonicalEntity } from "../canonical-entities.ts";
import type {
  BrowserVaultLabResultFilters,
  BrowserVaultLabResultReferenceRange,
  BrowserVaultLabResultRow,
  BrowserVaultQueryClient,
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
  latest: BrowserVaultLabResultRow;
  metricKey: string;
  resultCount: number;
}

export interface BrowserVaultLabBiomarkerDetail {
  biomarkerKey: string | null;
  chartSeries: BrowserVaultLabBiomarkerSeriesPoint[];
  comparableUnit: string | null;
  displayName: string;
  hasIncompatibleHistory: boolean;
  healthArea: LabHealthArea;
  latest: BrowserVaultLabResultRow;
  latestComparable: BrowserVaultLabResultRow | null;
  metricKey: string;
  previousComparable: BrowserVaultLabResultRow | null;
  rows: BrowserVaultLabResultRow[];
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
    const definition = resolveMetricDefinition(point.metricKey);
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
      textValue,
      unit: readOptionalString(point.unit),
      value,
    };
    rowsById.set(row.id, row);
  }

  return sortBrowserVaultLabResultRows([...rowsById.values()]);
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
  client: BrowserVaultQueryClient,
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
  client: BrowserVaultQueryClient,
  metricKey: string,
): BrowserVaultLabBiomarkerDetail | null {
  const rows = client.labResults.list({ metricKey });
  return buildLabBiomarkerDetail(normalizeMetricFilterKey(metricKey), rows);
}

function buildLabBiomarkerDetail(
  metricKey: string,
  inputRows: readonly BrowserVaultLabResultRow[],
): BrowserVaultLabBiomarkerDetail | null {
  const rows = sortBrowserVaultLabResultRows(inputRows);
  const latest = rows.at(-1);
  if (!latest) return null;

  const comparableCandidates = rows.filter(isComparableNumericRow);
  const comparableUnit = comparableCandidates.at(-1)?.normalizedUnit ?? null;
  const comparableRows = comparableUnit === null
    ? []
    : rows.filter((row): row is BrowserVaultLabResultRow & {
        normalizedUnit: string;
        normalizedValue: number;
      } => isComparableNumericRow(row) && row.normalizedUnit === comparableUnit);
  const latestComparable = comparableRows.at(-1) ?? null;
  const previousComparable = comparableRows.at(-2) ?? null;
  const chartSeries = comparableRows.map((row) => ({
    date: row.date,
    observedAt: row.observedAt,
    rowId: row.id,
    unit: row.normalizedUnit,
    value: row.normalizedValue,
  }));
  const numericNonComparatorRows = rows.filter((row) => row.value !== null && row.comparator === null);
  const definition = resolveMetricDefinition(metricKey);

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
    healthArea: resolveLabHealthArea(metricKey),
    latest,
    latestComparable,
    metricKey: latest.metricKey,
    previousComparable,
    rows,
  };
}

function isComparableNumericRow(
  row: BrowserVaultLabResultRow,
): row is BrowserVaultLabResultRow & { normalizedUnit: string; normalizedValue: number } {
  return row.value !== null
    && row.comparator === null
    && typeof row.normalizedValue === "number"
    && Number.isFinite(row.normalizedValue)
    && typeof row.normalizedUnit === "string"
    && row.normalizedUnit.length > 0;
}

function normalizeMetricFilterKey(metricKey: string): string {
  return resolveMetricDefinition(metricKey)?.key
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
