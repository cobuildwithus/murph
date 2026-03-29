import {
  createRegistryQueries,
  recipeRegistryDefinition,
  type RecipeQueryEntity,
  type RecipeQueryRecord,
  type RegistryListOptions,
} from "./registries.ts";

const recipeQueries = createRegistryQueries<RecipeQueryEntity>(recipeRegistryDefinition);

export async function listRecipes(
  vaultRoot: string,
  options: RegistryListOptions = {},
): Promise<RecipeQueryRecord[]> {
  return recipeQueries.list(vaultRoot, options);
}

export async function readRecipe(
  vaultRoot: string,
  recipeId: string,
): Promise<RecipeQueryRecord | null> {
  return recipeQueries.read(vaultRoot, recipeId);
}

export async function showRecipe(
  vaultRoot: string,
  lookup: string,
): Promise<RecipeQueryRecord | null> {
  return recipeQueries.show(vaultRoot, lookup);
}

export type {
  RecipeQueryEntity,
  RecipeQueryRecord,
};
