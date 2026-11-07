import { extractIsoDatePrefix } from "@murphai/contracts";
import type { CanonicalEntity } from "./canonical-entities.ts";
import { listEntities, type VaultReadModel } from "./read-model.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function mealDate(record: CanonicalEntity): string | null {
  if (typeof record.date === "string" && record.date.length > 0) {
    return record.date;
  }

  if (typeof record.occurredAt === "string" && record.occurredAt.length > 0) {
    return extractIsoDatePrefix(record.occurredAt);
  }

  return null;
}

function mealRevisionKey(record: CanonicalEntity): string | null {
  // Only device imports produce revisions of the same upstream meal; manual
  // meals are append-only and never collapse, even when they carry an
  // externalRef.
  if (!isRecord(record.attributes) || readString(record.attributes.source) !== "device") {
    return null;
  }

  const externalRef = record.attributes.externalRef;
  if (isRecord(externalRef)) {
    const system = readString(externalRef.system);
    const resourceType = readString(externalRef.resourceType);
    const resourceId = readString(externalRef.resourceId);
    const facet = readString(externalRef.facet);
    if (system && resourceType && resourceId) {
      return JSON.stringify(["externalRef", system, resourceType, resourceId, facet]);
    }
  }

  const mealId = readString(record.attributes.mealId);
  return mealId ? JSON.stringify(["deviceMeal", mealId]) : null;
}

function revisionTimestampMillis(value: unknown): number {
  const timestamp = readString(value);
  if (!timestamp) {
    return Number.NEGATIVE_INFINITY;
  }

  const millis = Date.parse(timestamp);
  return Number.isFinite(millis) ? millis : Number.NEGATIVE_INFINITY;
}

function isLaterMealRevision(candidate: CanonicalEntity, current: CanonicalEntity): boolean {
  const candidateRecordedAt = revisionTimestampMillis(candidate.attributes.recordedAt);
  const currentRecordedAt = revisionTimestampMillis(current.attributes.recordedAt);
  if (candidateRecordedAt !== currentRecordedAt) {
    return candidateRecordedAt > currentRecordedAt;
  }

  const candidateOccurredAt = revisionTimestampMillis(candidate.occurredAt);
  const currentOccurredAt = revisionTimestampMillis(current.occurredAt);
  if (candidateOccurredAt !== currentOccurredAt) {
    return candidateOccurredAt > currentOccurredAt;
  }

  return candidate.entityId.localeCompare(current.entityId) > 0;
}

// Imported meal corrections land as distinct ledger records (each revision
// hashes to its own event id), so totals must collapse them here rather than
// relying on the read model's same-id revision collapse.
function selectLatestMealRevisions(meals: readonly CanonicalEntity[]): CanonicalEntity[] {
  const unkeyedMeals: CanonicalEntity[] = [];
  const latestByKey = new Map<string, CanonicalEntity>();

  for (const meal of meals) {
    const key = mealRevisionKey(meal);
    if (!key) {
      unkeyedMeals.push(meal);
      continue;
    }

    const current = latestByKey.get(key);
    if (!current || isLaterMealRevision(meal, current)) {
      latestByKey.set(key, meal);
    }
  }

  return [...unkeyedMeals, ...latestByKey.values()];
}

export function selectMealNutritionRecords(
  readModel: VaultReadModel,
  options: { from?: string; to?: string },
): CanonicalEntity[] {
  const latestMeals = selectLatestMealRevisions(listEntities(readModel, {
    families: ["event"],
    kinds: ["meal"],
  }));

  return latestMeals.filter((meal) => {
    const date = mealDate(meal);
    if (options.from && (!date || date < options.from)) {
      return false;
    }
    if (options.to && date && date > options.to) {
      return false;
    }
    return true;
  });
}

