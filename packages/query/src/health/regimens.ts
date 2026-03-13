import {
  createProjectedRegistryQueries,
  regimenRecordFromEntity,
  regimenRegistryDefinition,
  type RegistryListOptions,
} from "./registries.js";

const regimenQueries = createProjectedRegistryQueries(
  regimenRegistryDefinition,
  "regimen",
  regimenRecordFromEntity,
);

export async function listRegimens(
  vaultRoot: string,
  options: RegistryListOptions = {},
): ReturnType<typeof regimenQueries.list> {
  return regimenQueries.list(vaultRoot, options);
}

export async function readRegimen(
  vaultRoot: string,
  regimenId: string,
): ReturnType<typeof regimenQueries.read> {
  return regimenQueries.read(vaultRoot, regimenId);
}

export async function showRegimen(
  vaultRoot: string,
  lookup: string,
): ReturnType<typeof regimenQueries.show> {
  return regimenQueries.show(vaultRoot, lookup);
}
