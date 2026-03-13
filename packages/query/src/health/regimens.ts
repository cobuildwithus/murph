import {
  createRegistryQueries,
  regimenRegistryDefinition,
} from "./registries.js";

import type { RegimenQueryRecord, RegistryListOptions } from "./registries.js";

const regimenQueries: {
  list(vaultRoot: string, options?: RegistryListOptions): Promise<RegimenQueryRecord[]>;
  read(vaultRoot: string, regimenId: string): Promise<RegimenQueryRecord | null>;
  show(vaultRoot: string, lookup: string): Promise<RegimenQueryRecord | null>;
} = createRegistryQueries(regimenRegistryDefinition);

export const listRegimens = regimenQueries.list;
export const readRegimen = regimenQueries.read;
export const showRegimen = regimenQueries.show;
