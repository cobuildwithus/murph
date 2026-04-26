import {
  createProjectedRegistryQueries,
  regimenRecordFromEntity,
  regimenRegistryDefinition,
} from "./registries.ts";

const regimenQueries = createProjectedRegistryQueries(
  regimenRegistryDefinition,
  "regimen",
  regimenRecordFromEntity,
);
export const {
  list: listRegimens,
  read: readRegimen,
  show: showRegimen,
} = regimenQueries;
