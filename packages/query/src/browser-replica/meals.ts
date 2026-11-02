import {
  companionMealsProjectionSchema,
  mealPhotoThumbnailSchema,
  companionMealUploadIdSchema,
  type CompanionMeal,
  type CompanionMealDay,
  type CompanionMealsProjection,
} from "@murphai/contracts";
import { normalizeIanaTimeZone, toLocalDayKey } from "@murphai/contracts";
import { selectMealNutritionRecords } from "../meal-selection.ts";
import type { VaultReadModel } from "../read-model.ts";

const nutrients = ["calories", "proteinGrams", "carbsGrams", "fatGrams"] as const;

/** Derived only from the same canonical snapshot as the rest of the replica. */
export function buildCompanionMealsProjection(vault: VaultReadModel): CompanionMealsProjection | undefined {
  const timeZone = typeof vault.metadata?.timezone === "string"
    ? normalizeIanaTimeZone(vault.metadata.timezone) : null;
  // No machine/game timezone fallback, including older or incomplete snapshots.
  if (!timeZone) return undefined;
  const days = new Map<string, CompanionMealDay>();
  for (const record of selectMealNutritionRecords(vault, {})) {
    const eatenAt = record.occurredAt;
    if (!eatenAt) throw new TypeError("Canonical meal occurrence is missing.");
    const attributes = record.attributes;
    const nutrition = asRecord(attributes.nutrition);
    const totals = asRecord(nutrition?.totals);
    const thumbnail = mealPhotoThumbnailSchema.safeParse(attributes.photoThumbnail).data;
    const meal: CompanionMeal = {
      ...(thumbnail ? { thumbnail } : {}),
      id: record.primaryLookupId,
      eatenAt,
      name: mealName(attributes),
      calories: numberOrNull(totals?.calories),
      proteinGrams: numberOrNull(totals?.proteinGrams),
      carbsGrams: numberOrNull(totals?.carbsGrams),
      fatGrams: numberOrNull(totals?.fatGrams),
      uploadId: companionMealUploadIdSchema.safeParse(attributes.uploadId).data ?? null,
    };
    const date = toLocalDayKey(eatenAt, timeZone);
    const day = days.get(date) ?? {
      date, calories: null, proteinGrams: null, carbsGrams: null, fatGrams: null,
      mealCount: 0, calorieMealCount: 0, meals: [],
    };
    day.meals.push(meal);
    day.mealCount += 1;
    if (meal.calories !== null) day.calorieMealCount += 1;
    for (const nutrient of nutrients) {
      if (meal[nutrient] !== null) day[nutrient] = (day[nutrient] ?? 0) + meal[nutrient];
    }
    days.set(date, day);
  }
  const ordered = [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
  for (const day of ordered) {
    day.meals.sort((a, b) => Date.parse(b.eatenAt) - Date.parse(a.eatenAt) || a.id.localeCompare(b.id));
  }
  return companionMealsProjectionSchema.parse({ schemaVersion: 1, timeZone, days: ordered });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function mealName(attributes: Record<string, unknown>): string | null {
  for (const value of [attributes.title, attributes.mealName, attributes.dishName, attributes.note]) {
    if (typeof value !== "string") continue;
    const text = value.trim().replace(/\s+/gu, " ")
      .replace(/^(?:(?:breakfast|lunch|dinner|snack)\s*:\s*|estimated\b\s*:?\s*|photo shows\b\s*:?\s*|retained image(?: reviewed)?\s*:\s*)+/iu, "")
      .split(/;| - /u, 1)[0]!.trim();
    if (!text || text.toLowerCase() === "meal") continue;
    return text.length > 120 ? `${text.slice(0, 119)}…` : text;
  }
  return null;
}
