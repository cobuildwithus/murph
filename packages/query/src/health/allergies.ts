import {
  allergyRegistryDefinition,
  createRegistryQueries,
} from "./registries.js";

import type { AllergyQueryRecord, RegistryListOptions } from "./registries.js";

const allergyQueries: {
  list(vaultRoot: string, options?: RegistryListOptions): Promise<AllergyQueryRecord[]>;
  read(vaultRoot: string, allergyId: string): Promise<AllergyQueryRecord | null>;
  show(vaultRoot: string, lookup: string): Promise<AllergyQueryRecord | null>;
} = createRegistryQueries(allergyRegistryDefinition);

export const listAllergies = allergyQueries.list;
export const readAllergy = allergyQueries.read;
export const showAllergy = allergyQueries.show;
