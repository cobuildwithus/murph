import * as z from "./zod-runtime.ts";
import { normalizeIanaTimeZone } from "./time.ts";

export const companionMealIdSchema = z.string().regex(/^(?:meal|evt)_[A-Za-z0-9]+$/u).max(160);
export const companionMealUploadIdSchema = z.string().min(1).max(128);
export const mealPhotoThumbnailSchema = z.object({
  relativePath: z.string().regex(/^raw\/meals\/[A-Za-z0-9_./-]+$/u).max(1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  byteSize: z.number().int().positive().max(1024 * 1024),
  width: z.number().int().min(1).max(640),
  height: z.number().int().min(1).max(640),
}).strict();
export type MealPhotoThumbnail = z.infer<typeof mealPhotoThumbnailSchema>;
const amount = z.number().finite().nonnegative().nullable();
export const companionMealSchema = z.object({
  id: companionMealIdSchema,
  eatenAt: z.isoDateTime({ offset: true }),
  name: z.string().min(1).max(120).nullable(),
  calories: amount,
  proteinGrams: amount,
  carbsGrams: amount,
  fatGrams: amount,
  fiberGrams: amount.optional(),
  uploadId: companionMealUploadIdSchema.nullable(),
  thumbnail: mealPhotoThumbnailSchema.optional(),
}).strict();

export const companionMealDaySchema = z.object({
  date: z.iso.date(),
  calories: amount,
  proteinGrams: amount,
  carbsGrams: amount,
  fatGrams: amount,
  mealCount: z.number().int().nonnegative(),
  calorieMealCount: z.number().int().nonnegative(),
  meals: z.array(companionMealSchema),
}).strict();

export const companionMealsProjectionSchema = z.object({
  schemaVersion: z.literal(1),
  timeZone: z.string().refine(value => normalizeIanaTimeZone(value) !== null),
  days: z.array(companionMealDaySchema),
}).strict();

export type CompanionMeal = z.infer<typeof companionMealSchema>;
export type CompanionMealDay = z.infer<typeof companionMealDaySchema>;
export type CompanionMealsProjection = z.infer<typeof companionMealsProjectionSchema>;

/** Shared authoring policy. Legacy records remain readable without rewriting. */
export const MEAL_NAME_GUIDANCE =
  "Use a sentence-case dish name, 2–5 words and at most 40 characters. No meal-type prefix, place/brand (unless part of the dish), uncertainty, or photo-review wording. Put portions, places, descriptions, and uncertainty in note.";

const LEFTOVER_PREFIX = /^(?:(?:breakfast|lunch|dinner|snack)\s*:|estimated\b|photo\s+(?:shows|of)\b|retained image\b|approximately\b|(?:about|roughly|likely|probably|possibly|maybe|uncertain|confidence)\b)/iu;
// Explicit venue syntax and title-cased multiword venue prefixes. Culinary
// proper adjectives alone (Greek salad, Chicken Kiev) are not venue evidence.
const PLACE_PREFIX = /^(?:.+?['’]s\s+|(?:[\p{Lu}][\p{L}'’.-]*\s+){2,}(?=[\p{Ll}])|.+?\s+(?:cafe|café|restaurant|kitchen|grill|deli|bakery)\s+)/u;

export type MealNameViolation = "empty" | "length" | "words" | "list" | "lowercase" | "prefix" | "place";

export function mealNameViolation(value: string): MealNameViolation | null {
  const name = value.trim();
  if (!name) return "empty";
  if (name.length > 40) return "length";
  const words = name.split(/\s+/u);
  if (words.length < 2 || words.length > 5) return "words";
  if (/[,;\n\r]/u.test(name) || name.split(/\s+(?:and|&)\s+/iu).length >= 3) return "list";
  if (/^\p{Ll}/u.test(name)) return "lowercase";
  if (LEFTOVER_PREFIX.test(name)) return "prefix";
  if (PLACE_PREFIX.test(name) && !/^(?:New York strip(?: steak)?|Boston cream pie|Kung Pao chicken|General Tso[’']s chicken)$/u.test(name)) return "place";
  return null;
}
