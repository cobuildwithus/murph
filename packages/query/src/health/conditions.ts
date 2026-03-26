import {
  conditionRecordFromEntity,
  conditionRegistryDefinition,
  createProjectedRegistryQueries,
} from "./registries.js";

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
