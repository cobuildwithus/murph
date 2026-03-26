import {
  createRegistryQueries,
  type RegistryListOptions,
  type RegistryMarkdownRecord,
} from "./registries.js";
import { firstObject, firstString, firstStringArray } from "./shared.js";

interface FoodAutoLogDailyQueryRule {
  time: string;
}

export interface FoodQueryRecord extends RegistryMarkdownRecord {
  summary: string | null;
  kind: string | null;
  brand: string | null;
  vendor: string | null;
  location: string | null;
  serving: string | null;
  aliases: string[];
  ingredients: string[];
  tags: string[];
  note: string | null;
  autoLogDaily: FoodAutoLogDailyQueryRule | null;
}

function readFoodAutoLogDailyRule(
  attributes: Record<string, unknown>,
): FoodAutoLogDailyQueryRule | null {
  const value = firstObject(attributes, ["autoLogDaily"]);
  const time = value ? firstString(value, ["time"]) : null;

  return time ? { time } : null;
}

const foodQueries = createRegistryQueries<FoodQueryRecord>({
  directory: "bank/foods",
  idKeys: ["foodId"],
  titleKeys: ["title"],
  statusKeys: ["status"],
  transform(base, attributes) {
    return {
      ...base,
      summary: firstString(attributes, ["summary"]),
      kind: firstString(attributes, ["kind"]),
      brand: firstString(attributes, ["brand"]),
      vendor: firstString(attributes, ["vendor"]),
      location: firstString(attributes, ["location"]),
      serving: firstString(attributes, ["serving"]),
      aliases: firstStringArray(attributes, ["aliases"]),
      ingredients: firstStringArray(attributes, ["ingredients"]),
      tags: firstStringArray(attributes, ["tags"]),
      note: firstString(attributes, ["note"]),
      autoLogDaily: readFoodAutoLogDailyRule(attributes),
    };
  },
});

export async function listFoods(
  vaultRoot: string,
  options: RegistryListOptions = {},
): ReturnType<typeof foodQueries.list> {
  return foodQueries.list(vaultRoot, options);
}

export async function readFood(
  vaultRoot: string,
  foodId: string,
): ReturnType<typeof foodQueries.read> {
  return foodQueries.read(vaultRoot, foodId);
}

export async function showFood(
  vaultRoot: string,
  lookup: string,
): ReturnType<typeof foodQueries.show> {
  return foodQueries.show(vaultRoot, lookup);
}
