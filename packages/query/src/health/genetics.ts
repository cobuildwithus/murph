import {
  geneticsRecordFromEntity,
  geneticsRegistryDefinition,
  createProjectedRegistryQueries,
} from "./registries.ts";

const geneticsQueries = createProjectedRegistryQueries(
  geneticsRegistryDefinition,
  "genetics",
  geneticsRecordFromEntity,
);
export const {
  list: listGeneticVariants,
  read: readGeneticVariant,
  show: showGeneticVariant,
} = geneticsQueries;
