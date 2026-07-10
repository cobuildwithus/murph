import {
  createRegistryQueries,
  habitatRegistryDefinition,
  type HabitatQueryEntity,
  type HabitatQueryRecord,
  type RegistryListOptions,
} from "./registries.ts";

const habitatQueries = createRegistryQueries<HabitatQueryEntity>(
  habitatRegistryDefinition,
);

export async function listHabitatAspects(
  vaultRoot: string,
  options: RegistryListOptions = {},
): Promise<HabitatQueryRecord[]> {
  return habitatQueries.list(vaultRoot, options);
}

export async function readHabitatAspect(
  vaultRoot: string,
  habitatId: string,
): Promise<HabitatQueryRecord | null> {
  return habitatQueries.read(vaultRoot, habitatId);
}

export async function showHabitatAspect(
  vaultRoot: string,
  lookup: string,
): Promise<HabitatQueryRecord | null> {
  return habitatQueries.show(vaultRoot, lookup);
}

export type {
  HabitatQueryEntity,
  HabitatQueryRecord,
};
