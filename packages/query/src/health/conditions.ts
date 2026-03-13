import {
  conditionRegistryDefinition,
  createRegistryQueries,
} from "./registries.js";

import type { ConditionQueryRecord, RegistryListOptions } from "./registries.js";

const conditionQueries: {
  list(vaultRoot: string, options?: RegistryListOptions): Promise<ConditionQueryRecord[]>;
  read(vaultRoot: string, conditionId: string): Promise<ConditionQueryRecord | null>;
  show(vaultRoot: string, lookup: string): Promise<ConditionQueryRecord | null>;
} = createRegistryQueries(conditionRegistryDefinition);

export const listConditions = conditionQueries.list;
export const readCondition = conditionQueries.read;
export const showCondition = conditionQueries.show;
