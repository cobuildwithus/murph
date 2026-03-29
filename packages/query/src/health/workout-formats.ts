import {
  createRegistryQueries,
  workoutFormatRegistryDefinition,
  type RegistryListOptions,
  type WorkoutFormatQueryEntity,
  type WorkoutFormatQueryRecord,
} from "./registries.ts";

const workoutFormatQueries = createRegistryQueries<WorkoutFormatQueryEntity>(
  workoutFormatRegistryDefinition,
);

export async function listWorkoutFormats(
  vaultRoot: string,
  options: RegistryListOptions = {},
): Promise<WorkoutFormatQueryRecord[]> {
  return workoutFormatQueries.list(vaultRoot, options);
}

export async function readWorkoutFormat(
  vaultRoot: string,
  workoutFormatId: string,
): Promise<WorkoutFormatQueryRecord | null> {
  return workoutFormatQueries.read(vaultRoot, workoutFormatId);
}

export async function showWorkoutFormat(
  vaultRoot: string,
  lookup: string,
): Promise<WorkoutFormatQueryRecord | null> {
  return workoutFormatQueries.show(vaultRoot, lookup);
}

export type {
  WorkoutFormatQueryEntity,
  WorkoutFormatQueryRecord,
};
