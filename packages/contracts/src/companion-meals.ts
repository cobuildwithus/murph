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
