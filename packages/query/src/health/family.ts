import {
  familyRecordFromEntity,
  familyRegistryDefinition,
  createProjectedRegistryQueries,
  type RegistryListOptions,
} from "./registries.js";

const familyQueries = createProjectedRegistryQueries(
  familyRegistryDefinition,
  "family",
  familyRecordFromEntity,
);

export async function listFamilyMembers(
  vaultRoot: string,
  options: RegistryListOptions = {},
): ReturnType<typeof familyQueries.list> {
  return familyQueries.list(vaultRoot, options);
}

export async function readFamilyMember(
  vaultRoot: string,
  familyMemberId: string,
): ReturnType<typeof familyQueries.read> {
  return familyQueries.read(vaultRoot, familyMemberId);
}

export async function showFamilyMember(
  vaultRoot: string,
  lookup: string,
): ReturnType<typeof familyQueries.show> {
  return familyQueries.show(vaultRoot, lookup);
}
