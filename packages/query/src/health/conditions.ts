import {
  conditionRecordFromEntity,
  conditionRegistryDefinition,
  createProjectedRegistryQueries,
} from "./registries.ts";

const conditionQueries = createProjectedRegistryQueries(
  conditionRegistryDefinition,
  "condition",
  conditionRecordFromEntity,
);
export const {
  list: listConditions,
  read: readCondition,
  show: showCondition,
} = conditionQueries;
