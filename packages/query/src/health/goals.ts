import {
  createProjectedRegistryQueries,
  goalRecordFromEntity,
  goalRegistryDefinition,
} from "./registries.js";

const goalQueries = createProjectedRegistryQueries(
  goalRegistryDefinition,
  "goal",
  goalRecordFromEntity,
);
export const {
  list: listGoals,
  read: readGoal,
  show: showGoal,
} = goalQueries;
