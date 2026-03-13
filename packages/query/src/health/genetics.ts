import {
  geneticsRecordFromEntity,
  geneticsRegistryDefinition,
  createProjectedRegistryQueries,
  type RegistryListOptions,
} from "./registries.js";

const geneticsQueries = createProjectedRegistryQueries(
  geneticsRegistryDefinition,
  "genetics",
  geneticsRecordFromEntity,
);

export async function listGeneticVariants(
  vaultRoot: string,
  options: RegistryListOptions = {},
): ReturnType<typeof geneticsQueries.list> {
  return geneticsQueries.list(vaultRoot, options);
}

export async function readGeneticVariant(
  vaultRoot: string,
  variantId: string,
): ReturnType<typeof geneticsQueries.read> {
  return geneticsQueries.read(vaultRoot, variantId);
}

export async function showGeneticVariant(
  vaultRoot: string,
  lookup: string,
): ReturnType<typeof geneticsQueries.show> {
  return geneticsQueries.show(vaultRoot, lookup);
}
