import {
  createProjectedRegistryQueries,
  goalRecordFromEntity,
  goalRegistryDefinition,
} from "./registries.ts";

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
