import {
  normalizeUnit,
  resolveBiomarkerFallbackStatusRanges,
  resolveLabResultMetricDefinition,
  type BiomarkerFallbackRangeBound,
  type BiomarkerFallbackStatusRange,
  type BiomarkerFallbackStatusDisposition,
} from "@murphai/health-metrics";

import {
  selectBrowserVaultLabBiomarkerDetail as selectBrowserVaultLabBiomarkerDetailBase,
  selectBrowserVaultMeasuredBiomarkers as selectBrowserVaultMeasuredBiomarkersBase,
  type BrowserVaultLabBiomarkerDetail,
  type BrowserVaultMeasuredBiomarker,
  type BrowserVaultNormalizedLabReferenceRange,
  type BrowserVaultPresentedLabResultRow,
} from "./lab-results.ts";
import type { BrowserVaultQueryClient } from "./shared.ts";

type RangePosition = "above" | "below" | "within";

/**
 * Adds display-only status to presented rows without mutating the persisted
 * browser replica. Reporting-lab flags remain first authority, numeric source
 * ranges are second, and reviewed exact-unit published comparators are last.
 */
export function deriveBrowserVaultLabResultStatus(
  row: BrowserVaultPresentedLabResultRow,
): BrowserVaultPresentedLabResultRow {
  if (row.flag?.trim()) {
    return row;
  }

  const value = comparableResultValue(row);
  if (value === null) {
    return row;
  }

  const sourcePosition = classifySourceRange(value, row.normalizedReferenceRange);
  if (sourcePosition !== null) {
    return {
      ...row,
      flag: flagForDisposition(STANDARD_SOURCE_STATUS_MAPPING[sourcePosition]),
    };
  }

  // Any source-authored range wording blocks a generic comparator even when
  // the wording is qualified and cannot be normalized into numeric bounds.
  if (row.referenceRange !== null) {
    return row;
  }

  const fallback = resolveApplicableFallbackRange(row);
  if (!fallback) {
    return row;
  }

  const position = classifyFallbackRange(value, fallback);
  if (position === null) {
    return row;
  }

  const flag = flagForDisposition(fallback.statusMapping[position]);
  return flag === null ? row : { ...row, flag };
}

export function selectBrowserVaultMeasuredBiomarkers(
  client: BrowserVaultQueryClient,
): BrowserVaultMeasuredBiomarker[] {
  return selectBrowserVaultMeasuredBiomarkersBase(client).map((biomarker) => ({
    ...biomarker,
    latest: deriveBrowserVaultLabResultStatus(biomarker.latest),
  }));
}

export function selectBrowserVaultLabBiomarkerDetail(
  client: BrowserVaultQueryClient,
  metricKey: string,
): BrowserVaultLabBiomarkerDetail | null {
  const detail = selectBrowserVaultLabBiomarkerDetailBase(client, metricKey);
  if (!detail) {
    return null;
  }

  const rows = detail.rows.map(deriveBrowserVaultLabResultStatus);
  return {
    ...detail,
    latest: rows.find((row) => row.id === detail.latest.id)
      ?? deriveBrowserVaultLabResultStatus(detail.latest),
    rows,
  };
}

const STANDARD_SOURCE_STATUS_MAPPING: Readonly<Record<
  RangePosition,
  BiomarkerFallbackStatusDisposition
>> = {
  above: "above_range",
  below: "below_range",
  within: "in_range",
};

function comparableResultValue(row: BrowserVaultPresentedLabResultRow): number | null {
  if (
    row.comparator !== null
    || row.normalizedValue === null
    || !Number.isFinite(row.normalizedValue)
    || row.normalizedUnit === null
  ) {
    return null;
  }
  return row.normalizedValue;
}

function classifySourceRange(
  value: number,
  range: BrowserVaultNormalizedLabReferenceRange | null,
): RangePosition | null {
  if (!range || (range.low === undefined && range.high === undefined)) {
    return null;
  }
  if (
    range.low !== undefined
    && isBelowBound(value, { inclusive: range.lowComparator !== ">", value: range.low })
  ) {
    return "below";
  }
  if (
    range.high !== undefined
    && isAboveBound(value, { inclusive: range.highComparator !== "<", value: range.high })
  ) {
    return "above";
  }
  return "within";
}

function resolveApplicableFallbackRange(
  row: BrowserVaultPresentedLabResultRow,
): BiomarkerFallbackStatusRange | null {
  const specimenKind = row.specimenKind;
  const normalizedUnit = row.normalizedUnit;
  if (specimenKind === null || normalizedUnit === null) {
    return null;
  }

  const definition = resolveLabResultMetricDefinition(row.metricKey);
  const candidateKeys = new Set<string>();
  if (row.biomarkerKey) candidateKeys.add(row.biomarkerKey);
  if (definition?.biomarkerKey) candidateKeys.add(definition.biomarkerKey);
  for (const alias of definition?.biomarkerAliases ?? []) {
    candidateKeys.add(alias);
  }

  for (const entityKey of candidateKeys) {
    const fallback = resolveBiomarkerFallbackStatusRanges(entityKey).find(
      (candidate) => unitsMatch(candidate.unit, normalizedUnit)
        && candidate.eligibleSpecimenKinds.includes(specimenKind),
    );
    if (fallback) {
      return fallback;
    }
  }

  return null;
}

function classifyFallbackRange(
  value: number,
  range: BiomarkerFallbackStatusRange,
): RangePosition | null {
  if (!range.lowerBound && !range.upperBound) {
    return null;
  }
  if (range.lowerBound && isBelowBound(value, range.lowerBound)) {
    return "below";
  }
  if (range.upperBound && isAboveBound(value, range.upperBound)) {
    return "above";
  }
  return "within";
}

function isBelowBound(value: number, bound: BiomarkerFallbackRangeBound): boolean {
  return bound.inclusive ? value < bound.value : value <= bound.value;
}

function isAboveBound(value: number, bound: BiomarkerFallbackRangeBound): boolean {
  return bound.inclusive ? value > bound.value : value >= bound.value;
}

function flagForDisposition(
  disposition: BiomarkerFallbackStatusDisposition,
): string | null {
  switch (disposition) {
    case "above_range":
      return "high";
    case "below_range":
      return "low";
    case "in_range":
      return "normal";
    case "reported":
      return null;
  }
}

function unitsMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizeUnit(left)?.trim().toLowerCase();
  const normalizedRight = normalizeUnit(right)?.trim().toLowerCase();
  return normalizedLeft !== null
    && normalizedRight !== null
    && normalizedLeft === normalizedRight;
}
