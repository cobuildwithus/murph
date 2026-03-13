import {
  createProjectedRegistryQueries,
  goalRecordFromEntity,
  goalRegistryDefinition,
  type RegistryListOptions,
} from "./registries.js";

const goalQueries = createProjectedRegistryQueries(
  goalRegistryDefinition,
  "goal",
  goalRecordFromEntity,
);

export async function listGoals(
  vaultRoot: string,
  options: RegistryListOptions = {},
): ReturnType<typeof goalQueries.list> {
  return goalQueries.list(vaultRoot, options);
}

export async function readGoal(
  vaultRoot: string,
  goalId: string,
): ReturnType<typeof goalQueries.read> {
  return goalQueries.read(vaultRoot, goalId);
}

export async function showGoal(
  vaultRoot: string,
  lookup: string,
): ReturnType<typeof goalQueries.show> {
  return goalQueries.show(vaultRoot, lookup);
}
