import {
  createRegistryQueries,
  geneticsRegistryDefinition,
} from "./registries.js";

import type { GeneticsQueryRecord, RegistryListOptions } from "./registries.js";

const geneticsQueries: {
  list(vaultRoot: string, options?: RegistryListOptions): Promise<GeneticsQueryRecord[]>;
  read(vaultRoot: string, variantId: string): Promise<GeneticsQueryRecord | null>;
  show(vaultRoot: string, lookup: string): Promise<GeneticsQueryRecord | null>;
} = createRegistryQueries(geneticsRegistryDefinition);

export const listGeneticVariants = geneticsQueries.list;
export const readGeneticVariant = geneticsQueries.read;
export const showGeneticVariant = geneticsQueries.show;
