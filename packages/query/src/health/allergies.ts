import {
  allergyRecordFromEntity,
  allergyRegistryDefinition,
  createProjectedRegistryQueries,
} from "./registries.ts";

const allergyQueries = createProjectedRegistryQueries(
  allergyRegistryDefinition,
  "allergy",
  allergyRecordFromEntity,
);
export const {
  list: listAllergies,
  read: readAllergy,
  show: showAllergy,
} = allergyQueries;
