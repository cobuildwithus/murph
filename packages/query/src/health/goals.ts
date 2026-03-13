import {
  createRegistryQueries,
  goalRegistryDefinition,
} from "./registries.js";

import type { GoalQueryRecord, RegistryListOptions } from "./registries.js";

const goalQueries: {
  list(vaultRoot: string, options?: RegistryListOptions): Promise<GoalQueryRecord[]>;
  read(vaultRoot: string, goalId: string): Promise<GoalQueryRecord | null>;
  show(vaultRoot: string, lookup: string): Promise<GoalQueryRecord | null>;
} = createRegistryQueries(goalRegistryDefinition);

export const listGoals = goalQueries.list;
export const readGoal = goalQueries.read;
export const showGoal = goalQueries.show;
