import { z } from "zod";

export const preferencesDocumentRelativePath = "bank/preferences.json";
export const legacyPreferencesDocumentSchemaVersion = 1;
export const preferencesDocumentSchemaVersion = 2;

export const workoutUnitPreferencesSchema = z
  .object({
    weight: z.enum(["lb", "kg"]).optional(),
    bodyMeasurement: z.enum(["cm", "in"]).optional(),
  })
  .strict();

export const legacyWorkoutUnitPreferencesSchema = z
  .object({
    weight: z.enum(["lb", "kg"]).optional(),
    bodyMeasurement: z.enum(["cm", "in"]).optional(),
    distance: z.string().min(1).optional(),
  })
  .strict();

export const wearablePreferenceProviderValues = ["garmin", "oura", "whoop"] as const;
export const wearablePreferenceProviderSchema = z.enum(wearablePreferenceProviderValues);

export const wearablePreferencesSchema = z
  .object({
    desiredProviders: z.array(wearablePreferenceProviderSchema).default([]),
  })
  .strict();

export const preferencesDocumentSchema = z
  .object({
    schemaVersion: z.literal(preferencesDocumentSchemaVersion),
    updatedAt: z.string().min(1),
    workoutUnitPreferences: workoutUnitPreferencesSchema.default({}),
    wearablePreferences: wearablePreferencesSchema.default({
      desiredProviders: [],
    }),
  })
  .strict();

export const legacyPreferencesDocumentSchema = z
  .object({
    schemaVersion: z.literal(legacyPreferencesDocumentSchemaVersion),
    updatedAt: z.string().min(1),
    workoutUnitPreferences: legacyWorkoutUnitPreferencesSchema.default({}),
  })
  .strict();

export const validPreferencesDocumentSchema = z.union([
  preferencesDocumentSchema,
  legacyPreferencesDocumentSchema,
]);

export type WorkoutUnitPreferences = z.infer<typeof workoutUnitPreferencesSchema>;
export type WearablePreferenceProvider = z.infer<typeof wearablePreferenceProviderSchema>;
export type WearablePreferences = z.infer<typeof wearablePreferencesSchema>;
export type PreferencesDocument = z.infer<typeof preferencesDocumentSchema>;

export function createEmptyPreferencesDocument(now = new Date()): PreferencesDocument {
  return preferencesDocumentSchema.parse({
    schemaVersion: preferencesDocumentSchemaVersion,
    updatedAt: now.toISOString(),
    workoutUnitPreferences: {},
    wearablePreferences: {
      desiredProviders: [],
    },
  });
}
