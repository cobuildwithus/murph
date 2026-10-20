import {
  normalizeMetricKey,
  normalizeUnit,
  resolveLabResultMetricDefinition,
  type MetricPoint,
} from "@murphai/health-metrics";

import type { CanonicalEntity } from "../canonical-entities.ts";
import type {
  BrowserVaultLabResultFilters,
  BrowserVaultLabResultReferenceRange,
  BrowserVaultLabResultRow,
  BrowserVaultLabSpecimenKind,
} from "./shared.ts";

export const BROWSER_VAULT_LAB_RESULT_ROW_SCHEMA = "murph.browser-vault.lab-result-row.v1" as const;

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
