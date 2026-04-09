import { z } from "zod";

export const preferencesDocumentRelativePath = "bank/preferences.json";
export const preferencesDocumentSchemaVersion = 1;

export const workoutUnitPreferencesSchema = z
  .object({
    weight: z.enum(["lb", "kg"]).optional(),
    bodyMeasurement: z.enum(["cm", "in"]).optional(),
  })
  .strict();

export const preferencesDocumentSchema = z
  .object({
    schemaVersion: z.literal(preferencesDocumentSchemaVersion),
    updatedAt: z.string().min(1),
    workoutUnitPreferences: workoutUnitPreferencesSchema.default({}),
  })
  .strict();

export type WorkoutUnitPreferences = z.infer<typeof workoutUnitPreferencesSchema>;
export type PreferencesDocument = z.infer<typeof preferencesDocumentSchema>;

export function createEmptyPreferencesDocument(now = new Date()): PreferencesDocument {
  return preferencesDocumentSchema.parse({
    schemaVersion: preferencesDocumentSchemaVersion,
    updatedAt: now.toISOString(),
    workoutUnitPreferences: {},
  });
}
