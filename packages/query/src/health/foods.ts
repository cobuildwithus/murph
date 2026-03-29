import {
  createRegistryQueries,
  foodRegistryDefinition,
  type FoodQueryEntity,
  type FoodQueryRecord,
  type RegistryListOptions,
} from "./registries.ts";

const foodQueries = createRegistryQueries<FoodQueryEntity>(foodRegistryDefinition);

export async function listFoods(
  vaultRoot: string,
  options: RegistryListOptions = {},
): Promise<FoodQueryRecord[]> {
  return foodQueries.list(vaultRoot, options);
}

export async function readFood(
  vaultRoot: string,
  foodId: string,
): Promise<FoodQueryRecord | null> {
  return foodQueries.read(vaultRoot, foodId);
}

export async function showFood(
  vaultRoot: string,
  lookup: string,
): Promise<FoodQueryRecord | null> {
  return foodQueries.show(vaultRoot, lookup);
}

export type {
  FoodQueryEntity,
  FoodQueryRecord,
};
