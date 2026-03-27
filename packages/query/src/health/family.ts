import {
  familyRecordFromEntity,
  familyRegistryDefinition,
  createProjectedRegistryQueries,
} from "./registries.ts";

const familyQueries = createProjectedRegistryQueries(
  familyRegistryDefinition,
  "family",
  familyRecordFromEntity,
);
export const {
  list: listFamilyMembers,
  read: readFamilyMember,
  show: showFamilyMember,
} = familyQueries;
