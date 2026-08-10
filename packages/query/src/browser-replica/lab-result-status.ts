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
type ResultComparator = NonNullable<BrowserVaultPresentedLabResultRow["comparator"]>;

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

  const sourceValue = comparableSourceValue(row);
  const sourcePosition = classifySourceRange(
    sourceValue,
    row.comparator,
    row.normalizedReferenceRange,
  );
  if (sourcePosition !== null) {
    return {
      ...row,
      flag: flagForDisposition(STANDARD_SOURCE_STATUS_MAPPING[sourcePosition]),
      statusSource: "reporting_lab_range",
    };
  }

  // Any source-authored range wording blocks a generic comparator even when
  // the wording is qualified and cannot be normalized into numeric bounds.
  if (row.referenceRange !== null) {
    return row;
  }

  const value = comparableFallbackValue(row);
  if (value === null) {
    return row;
  }

  const fallback = resolveApplicableFallbackRange(row);
  if (!fallback) {
    return row;
  }

  const position = classifyFallbackRange(value, row.comparator, fallback);
  if (position === null) {
    return row;
  }

  const flag = flagForDisposition(fallback.statusMapping[position]);
  return flag === null
    ? row
    : { ...row, flag, statusSource: "published_comparator" };
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

function comparableSourceValue(row: BrowserVaultPresentedLabResultRow): number | null {
  if (row.normalizedValue !== null && Number.isFinite(row.normalizedValue)) {
    return row.normalizedValue;
  }
  return row.value !== null && Number.isFinite(row.value) ? row.value : null;
}

function comparableFallbackValue(row: BrowserVaultPresentedLabResultRow): number | null {
  if (
    row.normalizedValue === null
    || !Number.isFinite(row.normalizedValue)
    || row.normalizedUnit === null
  ) {
    return null;
  }
  return row.normalizedValue;
}

function classifySourceRange(
  value: number | null,
  comparator: BrowserVaultPresentedLabResultRow["comparator"],
  range: BrowserVaultNormalizedLabReferenceRange | null,
): RangePosition | null {
  if (value === null || !range || (range.low === undefined && range.high === undefined)) {
    return null;
  }
  return classifyRangePosition(value, comparator, {
    ...(range.low === undefined
      ? {}
      : {
          lowerBound: {
            inclusive: range.lowComparator !== ">",
            value: range.low,
          },
        }),
    ...(range.high === undefined
      ? {}
      : {
          upperBound: {
            inclusive: range.highComparator !== "<",
            value: range.high,
          },
        }),
  });
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
  comparator: BrowserVaultPresentedLabResultRow["comparator"],
  range: BiomarkerFallbackStatusRange,
): RangePosition | null {
  return classifyRangePosition(value, comparator, range);
}

function classifyRangePosition(
  value: number,
  comparator: BrowserVaultPresentedLabResultRow["comparator"],
  range: {
    lowerBound?: BiomarkerFallbackRangeBound;
    upperBound?: BiomarkerFallbackRangeBound;
  },
): RangePosition | null {
  if (!range.lowerBound && !range.upperBound) {
    return null;
  }
  if (comparator === null) {
    if (range.lowerBound && isBelowBound(value, range.lowerBound)) {
      return "below";
    }
    if (range.upperBound && isAboveBound(value, range.upperBound)) {
      return "above";
    }
    return "within";
  }

  return classifyCensoredRangePosition(value, comparator, range);
}

function classifyCensoredRangePosition(
  value: number,
  comparator: ResultComparator,
  range: {
    lowerBound?: BiomarkerFallbackRangeBound;
    upperBound?: BiomarkerFallbackRangeBound;
  },
): RangePosition | null {
  if (comparator === "<" || comparator === "<=") {
    const includesValue = comparator === "<=";
    if (canOnlyRemainBelow(value, includesValue, range.lowerBound)) {
      return "below";
    }
    if (canOnlyRemainWithinBelow(value, includesValue, range)) {
      return "within";
    }
    return null;
  }

  const includesValue = comparator === ">=";
  if (canOnlyRemainAbove(value, includesValue, range.upperBound)) {
    return "above";
  }
  if (canOnlyRemainWithinAbove(value, includesValue, range)) {
    return "within";
  }
  return null;
}

function canOnlyRemainBelow(
  value: number,
  includesValue: boolean,
  lowerBound?: BiomarkerFallbackRangeBound,
): boolean {
  if (!lowerBound) return false;
  if (value < lowerBound.value) return true;
  if (value > lowerBound.value) return false;
  return !lowerBound.inclusive || !includesValue;
}

function canOnlyRemainAbove(
  value: number,
  includesValue: boolean,
  upperBound?: BiomarkerFallbackRangeBound,
): boolean {
  if (!upperBound) return false;
  if (value > upperBound.value) return true;
  if (value < upperBound.value) return false;
  return !upperBound.inclusive || !includesValue;
}

function canOnlyRemainWithinBelow(
  value: number,
  includesValue: boolean,
  range: {
    lowerBound?: BiomarkerFallbackRangeBound;
    upperBound?: BiomarkerFallbackRangeBound;
  },
): boolean {
  if (range.lowerBound !== undefined) return false;
  const upperBound = range.upperBound;
  if (!upperBound) return true;
  if (value < upperBound.value) return true;
  if (value > upperBound.value) return false;
  return upperBound.inclusive || !includesValue;
}

function canOnlyRemainWithinAbove(
  value: number,
  includesValue: boolean,
  range: {
    lowerBound?: BiomarkerFallbackRangeBound;
    upperBound?: BiomarkerFallbackRangeBound;
  },
): boolean {
  if (range.upperBound !== undefined) return false;
  const lowerBound = range.lowerBound;
  if (!lowerBound) return true;
  if (value > lowerBound.value) return true;
  if (value < lowerBound.value) return false;
  return lowerBound.inclusive || !includesValue;
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
