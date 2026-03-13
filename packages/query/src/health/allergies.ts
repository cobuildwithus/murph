import {
  allergyRecordFromEntity,
  allergyRegistryDefinition,
  createProjectedRegistryQueries,
  type RegistryListOptions,
} from "./registries.js";

const allergyQueries = createProjectedRegistryQueries(
  allergyRegistryDefinition,
  "allergy",
  allergyRecordFromEntity,
);

export async function listAllergies(
  vaultRoot: string,
  options: RegistryListOptions = {},
): ReturnType<typeof allergyQueries.list> {
  return allergyQueries.list(vaultRoot, options);
}

export async function readAllergy(
  vaultRoot: string,
  allergyId: string,
): ReturnType<typeof allergyQueries.read> {
  return allergyQueries.read(vaultRoot, allergyId);
}

export async function showAllergy(
  vaultRoot: string,
  lookup: string,
): ReturnType<typeof allergyQueries.show> {
  return allergyQueries.show(vaultRoot, lookup);
}
