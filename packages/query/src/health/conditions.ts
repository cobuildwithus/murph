import {
  conditionRecordFromEntity,
  conditionRegistryDefinition,
  createProjectedRegistryQueries,
  type RegistryListOptions,
} from "./registries.js";

const conditionQueries = createProjectedRegistryQueries(
  conditionRegistryDefinition,
  "condition",
  conditionRecordFromEntity,
);

export async function listConditions(
  vaultRoot: string,
  options: RegistryListOptions = {},
): ReturnType<typeof conditionQueries.list> {
  return conditionQueries.list(vaultRoot, options);
}

export async function readCondition(
  vaultRoot: string,
  conditionId: string,
): ReturnType<typeof conditionQueries.read> {
  return conditionQueries.read(vaultRoot, conditionId);
}

export async function showCondition(
  vaultRoot: string,
  lookup: string,
): ReturnType<typeof conditionQueries.show> {
  return conditionQueries.show(vaultRoot, lookup);
}
