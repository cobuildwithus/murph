import {
  createRegistryQueries,
  familyRegistryDefinition,
} from "./registries.js";

import type { FamilyQueryRecord, RegistryListOptions } from "./registries.js";

const familyQueries: {
  list(vaultRoot: string, options?: RegistryListOptions): Promise<FamilyQueryRecord[]>;
  read(vaultRoot: string, familyMemberId: string): Promise<FamilyQueryRecord | null>;
  show(vaultRoot: string, lookup: string): Promise<FamilyQueryRecord | null>;
} = createRegistryQueries(familyRegistryDefinition);

export const listFamilyMembers = familyQueries.list;
export const readFamilyMember = familyQueries.read;
export const showFamilyMember = familyQueries.show;
