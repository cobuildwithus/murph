import {
  applyLimit,
  compareNullableStrings,
  matchesLookup,
  matchesText,
} from "./shared.ts";
import {
  listProtocols,
  readProtocol,
} from "./protocols.ts";

import type {
  ProtocolQueryRecord,
  RegistryListOptions,
  SupplementIngredientQueryRecord,
} from "./registries.ts";

export interface SupplementQueryRecord extends ProtocolQueryRecord {
  kind: string | null;
}

export interface SupplementListOptions extends RegistryListOptions {}

export interface SupplementCompoundSourceRecord {
  supplementId: string;
  supplementSlug: string;
  supplementTitle: string | null;
  brand: string | null;
  manufacturer: string | null;
  status: string | null;
  label: string | null;
  amount: number | null;
  unit: string | null;
  note: string | null;
}

export interface SupplementCompoundTotalRecord {
  unit: string | null;
  totalAmount: number | null;
  sourceCount: number;
  incomplete: boolean;
}

export interface SupplementCompoundQueryRecord {
  compound: string;
  lookupId: string;
  totals: SupplementCompoundTotalRecord[];
  supplementCount: number;
  supplementIds: string[];
  sources: SupplementCompoundSourceRecord[];
}

export interface SupplementCompoundListOptions {
  status?: string | string[];
  text?: string;
  limit?: number;
}

interface SupplementCompoundAggregationState {
  compound: string;
  lookupId: string;
  supplementIds: Set<string>;
  sources: SupplementCompoundSourceRecord[];
  totals: Map<string, {
    unit: string | null;
    numericTotal: number;
    hasNumericAmount: boolean;
    incomplete: boolean;
    sourceCount: number;
  }>;
}

function isSupplement(record: ProtocolQueryRecord | null): record is SupplementQueryRecord {
  return record?.kind?.toLowerCase() === "supplement";
}

function normalizeCompoundKey(value: string): string {
  return value.trim().toLowerCase();
}

function compoundLookupId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return normalized.length > 0 ? normalized : normalizeCompoundKey(value);
}

function compareSupplements(
  left: SupplementQueryRecord,
  right: SupplementQueryRecord,
): number {
  return (
    compareNullableStrings(left.title, right.title) ||
    compareNullableStrings(left.brand, right.brand) ||
    left.id.localeCompare(right.id)
  );
}

function deriveLegacySupplementIngredients(
  record: SupplementQueryRecord,
): SupplementIngredientQueryRecord[] {
  if (!record.substance) {
    return [];
  }

  return [{
    compound: record.substance,
    label: record.substance,
    amount: record.dose,
    unit: record.unit,
    active: true,
    note: null,
  }];
}

function activeSupplementIngredients(
  record: SupplementQueryRecord,
): SupplementIngredientQueryRecord[] {
  const ingredients = record.ingredients.length > 0
    ? record.ingredients
    : deriveLegacySupplementIngredients(record);

  return ingredients.filter((ingredient) => ingredient.active !== false);
}

function buildCompoundSourceRecord(
  record: SupplementQueryRecord,
  ingredient: SupplementIngredientQueryRecord,
): SupplementCompoundSourceRecord {
  return {
    supplementId: record.id,
    supplementSlug: record.slug,
    supplementTitle: record.title,
    brand: record.brand,
    manufacturer: record.manufacturer,
    status: record.status,
    label: ingredient.label,
    amount: ingredient.amount,
    unit: ingredient.unit,
    note: ingredient.note,
  };
}

function toSupplementCompoundRecord(
  state: SupplementCompoundAggregationState,
): SupplementCompoundQueryRecord {
  const totals = [...state.totals.values()]
    .map((total) => ({
      unit: total.unit,
      totalAmount: total.hasNumericAmount ? total.numericTotal : null,
      sourceCount: total.sourceCount,
      incomplete: total.incomplete,
    }))
    .sort((left, right) => compareNullableStrings(left.unit, right.unit));

  const sources = [...state.sources].sort((left, right) => (
    compareNullableStrings(left.supplementTitle, right.supplementTitle) ||
    compareNullableStrings(left.brand, right.brand) ||
    left.supplementId.localeCompare(right.supplementId)
  ));

  const supplementIds = [...state.supplementIds].sort((left, right) => left.localeCompare(right));

  return {
    compound: state.compound,
    lookupId: state.lookupId,
    totals,
    supplementCount: supplementIds.length,
    supplementIds,
    sources,
  };
}

function aggregateSupplementCompounds(
  records: SupplementQueryRecord[],
): SupplementCompoundQueryRecord[] {
  const compounds = new Map<string, SupplementCompoundAggregationState>();

  for (const record of records) {
    for (const ingredient of activeSupplementIngredients(record)) {
      const key = normalizeCompoundKey(ingredient.compound);
      const existing: SupplementCompoundAggregationState = compounds.get(key) ?? {
        compound: ingredient.compound,
        lookupId: compoundLookupId(ingredient.compound),
        supplementIds: new Set<string>(),
        sources: [],
        totals: new Map(),
      };

      existing.supplementIds.add(record.id);
      existing.sources.push(buildCompoundSourceRecord(record, ingredient));

      const unitKey = ingredient.unit?.toLowerCase() ?? "";
      const total = existing.totals.get(unitKey) ?? {
        unit: ingredient.unit,
        numericTotal: 0,
        hasNumericAmount: false,
        incomplete: false,
        sourceCount: 0,
      };

      total.sourceCount += 1;
      if (typeof ingredient.amount === "number") {
        total.numericTotal += ingredient.amount;
        total.hasNumericAmount = true;
      } else {
        total.incomplete = true;
      }
      if (ingredient.unit && !total.unit) {
        total.unit = ingredient.unit;
      }

      existing.totals.set(unitKey, total);
      compounds.set(key, existing);
    }
  }

  return [...compounds.values()]
    .map((state) => toSupplementCompoundRecord(state))
    .sort((left, right) => (
      compareNullableStrings(left.compound, right.compound) ||
      left.lookupId.localeCompare(right.lookupId)
    ));
}

function matchesSupplementCompoundLookup(
  lookup: string,
  record: SupplementCompoundQueryRecord,
): boolean {
  if (matchesLookup(lookup, record.lookupId, record.compound, record.compound)) {
    return true;
  }

  return record.sources.some((source) => (
    matchesLookup(
      lookup,
      record.lookupId,
      source.label ?? record.compound,
      source.supplementTitle ?? record.compound,
    )
  ));
}

function matchesSupplementCompoundText(
  record: SupplementCompoundQueryRecord,
  text: string | undefined,
): boolean {
  return matchesText([
    record.compound,
    record.lookupId,
    record.totals,
    record.sources,
  ], text);
}

function normalizeCompoundStatus(
  status: string | string[] | undefined,
): string | string[] {
  return status ?? "active";
}

export async function listSupplements(
  vaultRoot: string,
  options: SupplementListOptions = {},
): Promise<SupplementQueryRecord[]> {
  const records = await listProtocols(vaultRoot, {
    ...options,
    limit: undefined,
  });

  return applyLimit(
    records.filter(isSupplement).sort(compareSupplements),
    options.limit,
  );
}

export async function readSupplement(
  vaultRoot: string,
  protocolId: string,
): Promise<SupplementQueryRecord | null> {
  const record = await readProtocol(vaultRoot, protocolId);
  return isSupplement(record) ? record : null;
}

export async function showSupplement(
  vaultRoot: string,
  lookup: string,
): Promise<SupplementQueryRecord | null> {
  const records = await listSupplements(vaultRoot, {
    limit: undefined,
  });

  return records.find((record) => matchesLookup(lookup, record.id, record.slug, record.title)) ?? null;
}

export async function listSupplementCompounds(
  vaultRoot: string,
  options: SupplementCompoundListOptions = {},
): Promise<SupplementCompoundQueryRecord[]> {
  const supplements = await listSupplements(vaultRoot, {
    status: normalizeCompoundStatus(options.status),
    limit: undefined,
  });
  const compounds = aggregateSupplementCompounds(supplements)
    .filter((record) => matchesSupplementCompoundText(record, options.text));

  return applyLimit(compounds, options.limit);
}

export async function showSupplementCompound(
  vaultRoot: string,
  lookup: string,
  options: Omit<SupplementCompoundListOptions, "text" | "limit"> = {},
): Promise<SupplementCompoundQueryRecord | null> {
  const compounds = await listSupplementCompounds(vaultRoot, {
    status: options.status,
    limit: undefined,
  });

  return compounds.find((record) => matchesSupplementCompoundLookup(lookup, record)) ?? null;
}
