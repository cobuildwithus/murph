export type Nutrient = "protein" | "fiber";

export interface FoodTally {
  type: "tally";
  nutrient: Nutrient;
  total: number;
  unit: "g";
  item: { id: string; name: string; plural: string; perItem: number };
  count: number;
  partial: number;
}

interface Food {
  id: string;
  name: string;
  plural: string;
  protein_g: number;
  fiber_g: number;
  order: Partial<Record<Nutrient, number>>;
  source_url: string;
}

// Approximate edible portions. The linked FDC records give nutrients per 100 g.
const catalog: readonly Food[] = [
  { // About 620 g of roasted chicken meat at 28.93 g protein per 100 g.
    id: "rotisserie_chicken", name: "rotisserie chicken", plural: "rotisserie chickens",
    protein_g: 180, fiber_g: 0, order: { protein: 1 },
    source_url: "https://fdc.nal.usda.gov/food-details/171054/nutrients",
  },
  { // About 2.75 kg of roasted turkey meat at 29.06 g protein per 100 g.
    id: "thanksgiving_turkey", name: "Thanksgiving turkey", plural: "Thanksgiving turkeys",
    protein_g: 800, fiber_g: 0, order: { protein: 2 },
    source_url: "https://fdc.nal.usda.gov/food-details/171481/nutrients",
  },
  { // One roasted breast, 172 g of meat.
    id: "chicken_breast", name: "chicken breast", plural: "chicken breasts",
    protein_g: 53, fiber_g: 0, order: { protein: 3 },
    source_url: "https://fdc.nal.usda.gov/food-details/171477/nutrients",
  },
  { // One 425 g can.
    id: "black_beans", name: "can of black beans", plural: "cans of black beans",
    protein_g: 20, fiber_g: 17, order: { protein: 4, fiber: 2 },
    source_url: "https://fdc.nal.usda.gov/food-details/1918404/nutrients",
  },
  { // One large egg, 50 g.
    id: "egg", name: "large egg", plural: "large eggs",
    protein_g: 6, fiber_g: 0, order: { protein: 5 },
    source_url: "https://fdc.nal.usda.gov/food-details/171287/nutrients",
  },
  { // About 150 g of avocado flesh.
    id: "avocado", name: "avocado", plural: "avocados",
    protein_g: 3, fiber_g: 10, order: { fiber: 1 },
    source_url: "https://fdc.nal.usda.gov/food-details/171705/nutrients",
  },
  { // One medium apple with skin, 182 g.
    id: "apple", name: "apple", plural: "apples",
    protein_g: 0.5, fiber_g: 4.4, order: { fiber: 3 },
    source_url: "https://fdc.nal.usda.gov/food-details/171688/nutrients",
  },
  { // A 24 oz (680 g) whole-wheat loaf at 6 g fiber per 100 g.
    id: "bread_loaf", name: "whole-wheat loaf", plural: "whole-wheat loaves",
    protein_g: 85, fiber_g: 41, order: { fiber: 4 },
    source_url: "https://fdc.nal.usda.gov/food-details/172688/nutrients",
  },
];

function orderedFoods(nutrient: Nutrient) {
  return catalog.flatMap(food => {
    const order = food.order[nutrient];
    return order === undefined ? [] : [{ order, food, perItem: food[`${nutrient}_g`] }];
  }).sort((a, b) => a.order - b.order);
}

const byNutrient = { protein: orderedFoods("protein"), fiber: orderedFoods("fiber") };

export function foodTally(nutrient: Nutrient, total: number): FoodTally | null {
  for (const { food, perItem } of byNutrient[nutrient]) {
    const ratio = total / perItem;
    const count = Math.round(ratio);
    if (count >= 10 && count <= 50) {
      const fraction = Math.min(1, ratio - (count - 1));
      return {
        type: "tally", nutrient, total, unit: "g",
        item: { id: food.id, name: food.name, plural: food.plural, perItem },
        count, partial: Math.round(fraction * 100) / 100,
      };
    }
  }
  return null;
}
