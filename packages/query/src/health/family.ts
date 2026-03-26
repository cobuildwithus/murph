import {
  familyRecordFromEntity,
  familyRegistryDefinition,
  createProjectedRegistryQueries,
} from "./registries.js";

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
