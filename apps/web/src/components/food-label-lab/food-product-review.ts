import type { PublicProductDetail } from "@murphai/contracts";

import { getFoodMetricValue } from "./food-label-model";

export type FoodIngredientNoteLevel = "context" | "caution" | "higher_concern";

export type FoodIngredientNoteKind =
  | "added_sweetener"
  | "coded_additive"
  | "color_additive"
  | "high_intensity_sweetener"
  | "partially_hydrogenated_oil"
  | "preservative"
  | "texture_additive";

export type FoodIngredientNote = {
  detail: string;
  kind: FoodIngredientNoteKind;
  label: string;
  level: FoodIngredientNoteLevel;
  sourceUrl: string;
};

export type FoodIngredientItem = {
  children: FoodIngredientItem[];
  id: string;
  name: string;
  note: FoodIngredientNote | null;
};

export type FoodMurphNoteTone = "caution" | "mixed" | "positive" | "unknown";
export type FoodMurphGrade = "A" | "B" | "C" | "D" | "E";

export type FoodMurphNoteReason = {
  id: string;
  text: string;
  tone: "caution" | "positive" | "neutral";
};

export type FoodMurphNote = {
  grade: FoodMurphGrade | null;
  reasons: FoodMurphNoteReason[];
  tone: FoodMurphNoteTone;
};

const FDA_SWEETENER_URL =
  "https://www.fda.gov/food/food-additives-petitions/aspartame-and-other-sweeteners-food";
const FDA_INGREDIENT_TYPES_URL =
  "https://www.fda.gov/food/food-additives-and-gras-ingredients-information-consumers/types-food-ingredients";
const FDA_PARTIALLY_HYDROGENATED_OIL_URL =
  "https://www.fda.gov/food/hfp-constituent-updates/fda-completes-final-administrative-actions-partially-hydrogenated-oils-foods";
const EFSA_FOOD_ADDITIVES_URL =
  "https://www.efsa.europa.eu/en/topics/topic/food-additives";

const INGREDIENT_NOTES: Array<FoodIngredientNote & { pattern: RegExp }> = [
  {
    pattern: /\bpartially hydrogenated\b/u,
    kind: "partially_hydrogenated_oil",
    label: "Partially hydrogenated oil",
    level: "higher_concern",
    detail:
      "This is a main source of industrial trans fat. The FDA removed its generally recognized as safe status for food use.",
    sourceUrl: FDA_PARTIALLY_HYDROGENATED_OIL_URL,
  },
  {
    pattern:
      /\b(?:aspartame|sucralose|acesulfame(?: potassium| k)?|ace-k|saccharin|neotame|advantame)\b/u,
    kind: "high_intensity_sweetener",
    label: "Sugar substitute",
    level: "caution",
    detail:
      "This sweetener is much sweeter than table sugar, so the product needs only a small amount. The FDA permits approved sweeteners under set conditions of use.",
    sourceUrl: FDA_SWEETENER_URL,
  },
  {
    pattern:
      /\b(?:agave(?: nectar| syrup)?|brown rice syrup|cane sugar|coconut sugar|corn syrup|dextrose|evaporated cane juice|fructose|glucose|high fructose corn syrup|honey|invert sugar|malt syrup|maltose|maple syrup|molasses|rice syrup|sugar)\b/u,
    kind: "added_sweetener",
    label: "Added sweetener",
    level: "caution",
    detail:
      "This ingredient adds sweetness. The ingredient list does not show its amount, so compare the nutrition values too.",
    sourceUrl: FDA_INGREDIENT_TYPES_URL,
  },
  {
    pattern:
      /\b(?:sodium benzoate|potassium sorbate|calcium propionate|sodium nitrite|bha|bht|edta)\b/u,
    kind: "preservative",
    label: "Preservative",
    level: "context",
    detail:
      "Preservatives help slow spoilage or changes in flavor, color, or texture. This label does not report the amount used.",
    sourceUrl: FDA_INGREDIENT_TYPES_URL,
  },
  {
    pattern:
      /\b(?:red|yellow|blue)\s*(?:no\.?\s*)?\d+\b|\bartificial colors?\b/u,
    kind: "color_additive",
    label: "Color additive",
    level: "context",
    detail:
      "This ingredient changes or restores color. Its presence alone does not show how much the product contains.",
    sourceUrl: FDA_INGREDIENT_TYPES_URL,
  },
  {
    pattern:
      /\b(?:carrageenan|modified (?:corn |food )?starch|xanthan gum|guar gum|cellulose gel|polydextrose)\b/u,
    kind: "texture_additive",
    label: "Texture additive",
    level: "context",
    detail:
      "This ingredient helps create or keep the product's texture. Its presence is useful context, not a safety verdict.",
    sourceUrl: FDA_INGREDIENT_TYPES_URL,
  },
  {
    pattern: /\be[ -]?\d{3,4}[a-z]?\b/u,
    kind: "coded_additive",
    label: "Food additive code",
    level: "context",
    detail:
      "An E number identifies a food additive permitted in the European Union. The code alone does not mean that the ingredient is harmful.",
    sourceUrl: EFSA_FOOD_ADDITIVES_URL,
  },
];

const PLANT_SWEETENER_PATTERN =
  /\b(?:monk fruit(?: juice concentrate| extract)?|stevia(?: leaf extract)?|steviol glycosides?)\b/u;

export function getFoodIngredientItems(
  product: PublicProductDetail,
): FoodIngredientItem[] {
  const statement =
    product.ingredients.statement ??
    product.ingredients.otherStatement ??
    [
      ...product.ingredients.active.map((ingredient) => ingredient.name),
      ...product.ingredients.other.map((ingredient) => ingredient.name),
    ].join(", ");
  if (!statement.trim()) {
    return [];
  }
  return parseIngredientList(statement);
}

export function flattenFoodIngredientItems(
  ingredients: FoodIngredientItem[],
): FoodIngredientItem[] {
  return ingredients.flatMap((ingredient) => [
    ingredient,
    ...flattenFoodIngredientItems(ingredient.children),
  ]);
}

export function getFoodMurphNote(product: PublicProductDetail): FoodMurphNote {
  const facts = collectFoodReviewFacts(product);
  const reasons = collectFoodReviewReasons(facts);
  return buildFoodMurphNote(facts, reasons);
}

type FoodReviewFacts = {
  addedSugar: number | null;
  addedSweeteners: FoodIngredientItem[];
  aboveLimitCount: number;
  belowLimitCount: number;
  contextAdditives: FoodIngredientItem[];
  hasLabelData: boolean;
  higherConcern: FoodIngredientItem[];
  highNutrients: string[];
  protein: ReturnType<typeof getFoodMetricValue>;
  sugarSubstitutes: string[];
};

function collectFoodReviewFacts(product: PublicProductDetail): FoodReviewFacts {
  const ingredients = flattenFoodIngredientItems(
    getFoodIngredientItems(product),
  );
  const notedIngredients = ingredients.filter(
    (ingredient) => ingredient.note !== null,
  );
  const higherConcern = notedIngredients.filter(
    (ingredient) => ingredient.note?.level === "higher_concern",
  );
  const sugarSubstitutes = uniqueNames([
    ...notedIngredients
      .filter(
        (ingredient) => ingredient.note?.kind === "high_intensity_sweetener",
      )
      .map((ingredient) => ingredient.name),
    ...ingredients
      .filter((ingredient) =>
        PLANT_SWEETENER_PATTERN.test(
          ingredient.name.toLocaleLowerCase("en-US"),
        ),
      )
      .map((ingredient) => ingredient.name),
  ]);
  const addedSweeteners = notedIngredients.filter(
    (ingredient) => ingredient.note?.kind === "added_sweetener",
  );
  const contextAdditives = notedIngredients.filter(
    (ingredient) =>
      ingredient.note?.kind === "color_additive" ||
      ingredient.note?.kind === "coded_additive" ||
      ingredient.note?.kind === "preservative" ||
      ingredient.note?.kind === "texture_additive",
  );

  const protein = getFoodMetricValue(product, "protein", "per_100_g");
  const sugars = getFoodMetricValue(product, "sugars", "per_100_g");
  const fat = getFoodMetricValue(product, "fat", "per_100_g");
  const saturatedFat = getFoodMetricValue(
    product,
    "saturated_fat",
    "per_100_g",
  );
  const sodium = getFoodMetricValue(product, "sodium", "per_100_g");
  const addedSugar = findNutritionValue(product, [
    "added sugars",
    "sugars, added",
    "sugar, added",
  ]);
  const highNutrients = [
    fat && fat.value > 17.5 ? `fat (${formatAmount(fat.value)} g)` : null,
    saturatedFat && saturatedFat.value > 5
      ? `saturated fat (${formatAmount(saturatedFat.value)} g)`
      : null,
    sugars && sugars.value > 22.5
      ? `sugar (${formatAmount(sugars.value)} g)`
      : null,
    sodium && sodium.value > 600
      ? `sodium (${formatAmount(sodium.value)} mg)`
      : null,
  ].filter((value): value is string => value !== null);

  const observations = product.productTests.observations;
  const aboveLimitCount = observations.filter(
    (observation) => observation.screening?.comparison === "exceeds",
  ).length;
  const belowLimitCount = observations.filter(
    (observation) => observation.screening?.comparison === "does_not_exceed",
  ).length;
  const hasLabelData =
    ingredients.length > 0 ||
    [protein, sugars, fat, saturatedFat, sodium].some(
      (value) => value !== null,
    );

  return {
    addedSugar,
    addedSweeteners,
    aboveLimitCount,
    belowLimitCount,
    contextAdditives,
    hasLabelData,
    higherConcern,
    highNutrients,
    protein,
    sugarSubstitutes,
  };
}

function collectFoodReviewReasons(
  facts: FoodReviewFacts,
): FoodMurphNoteReason[] {
  const reasons: FoodMurphNoteReason[] = [];
  if (facts.aboveLimitCount > 0) {
    reasons.push({
      id: "lab-above-limit",
      tone: "caution",
      text: `${facts.aboveLimitCount} linked lab ${pluralize(
        facts.aboveLimitCount,
        "result is",
        "results are",
      )} above a matching health limit.`,
    });
  }
  if (facts.higherConcern.length > 0) {
    reasons.push({
      id: "higher-concern-ingredient",
      tone: "caution",
      text: `Contains ${joinNames(
        facts.higherConcern.map((ingredient) => ingredient.name),
      )}.`,
    });
  }
  if (facts.highNutrients.length > 0) {
    reasons.push({
      id: "high-nutrients",
      tone: "caution",
      text: `High in ${joinNames(facts.highNutrients)} per 100g.`,
    });
  }
  if (facts.addedSweeteners.length > 0 && facts.addedSugar !== 0) {
    reasons.push({
      id: "added-sweetener",
      tone: "caution",
      text: `Uses added sweetener: ${joinNames(
        facts.addedSweeteners.map((ingredient) => ingredient.name),
      )}.`,
    });
  }
  if (facts.protein && facts.protein.value >= 8) {
    reasons.push({
      id: "protein",
      tone: "positive",
      text: `Protein stands out at ${formatAmount(
        facts.protein.value,
      )} g per 100g.`,
    });
  }
  if (facts.addedSugar === 0) {
    reasons.push({
      id: "no-added-sugar",
      tone: "positive",
      text: "The label reports no added sugar.",
    });
  }
  if (facts.sugarSubstitutes.length > 0) {
    reasons.push({
      id: "sugar-substitutes",
      tone: "caution",
      text: `Uses sugar substitutes: ${joinNames(facts.sugarSubstitutes)}.`,
    });
  }
  if (
    facts.contextAdditives.length > 0 &&
    reasons.filter((reason) => reason.tone === "caution").length === 0
  ) {
    reasons.push({
      id: "other-additives",
      tone: "neutral",
      text: `${facts.contextAdditives.length} ${pluralize(
        facts.contextAdditives.length,
        "additive is",
        "additives are",
      )} explained in the ingredient list.`,
    });
  }
  if (facts.belowLimitCount > 0 && facts.aboveLimitCount === 0) {
    reasons.push({
      id: "lab-below-limit",
      tone: "positive",
      text: `${facts.belowLimitCount} linked lab ${pluralize(
        facts.belowLimitCount,
        "result is",
        "results are",
      )} below a matching health limit.`,
    });
  }
  return reasons;
}

function buildFoodMurphNote(
  facts: FoodReviewFacts,
  reasons: FoodMurphNoteReason[],
): FoodMurphNote {
  if (
    !facts.hasLabelData &&
    facts.aboveLimitCount + facts.belowLimitCount === 0
  ) {
    return {
      grade: null,
      reasons: [
        {
          id: "sparse-record",
          tone: "neutral",
          text: "Murph needs a nutrition or ingredient label to review this product.",
        },
      ],
      tone: "unknown",
    };
  }

  const hasTradeoff =
    facts.addedSweeteners.length > 0 || facts.sugarSubstitutes.length > 0;
  const selectedReasons = selectReasons(reasons);

  if (facts.aboveLimitCount > 0 || facts.higherConcern.length > 0) {
    return {
      grade: "E",
      reasons: selectedReasons,
      tone: "caution",
    };
  }
  if (facts.highNutrients.length > 0) {
    return {
      grade: "D",
      reasons: selectedReasons,
      tone: "caution",
    };
  }
  if (hasTradeoff) {
    return {
      grade: "C",
      reasons: selectedReasons,
      tone: "mixed",
    };
  }
  return {
    grade:
      (facts.protein && facts.protein.value >= 8) || facts.belowLimitCount > 0
        ? "A"
        : "B",
    reasons:
      selectedReasons.length > 0
        ? selectedReasons
        : [
            {
              id: "no-label-concerns",
              tone: "positive",
              text: "Murph did not find a major concern in the available label data.",
            },
          ],
    tone: "positive",
  };
}

function parseIngredientList(statement: string): FoodIngredientItem[] {
  const normalizedStatement = statement.replace(
    /^\s*ingredients?\s*:\s*/iu,
    "",
  );
  return splitTopLevelIngredients(normalizedStatement)
    .map((rawName, index) => {
      const cleaned = rawName
        .replace(
          /^contains\s+(?:\d+%|less than \d+%)\s+(?:or less )?of:?\s*/iu,
          "",
        )
        .trim();
      if (!cleaned) {
        return null;
      }
      const groupMatch = /^(.+?)\s*\((.+)\)$/su.exec(cleaned);
      const childNames = groupMatch
        ? splitTopLevelIngredients(groupMatch[2] ?? "")
        : [];
      const hasIngredientGroup = childNames.length > 1;
      const name = hasIngredientGroup
        ? groupMatch?.[1]?.trim() ?? cleaned
        : cleaned;
      return {
        children: hasIngredientGroup
          ? parseIngredientList(groupMatch?.[2] ?? "")
          : [],
        id: `${index}:${name.toLocaleLowerCase("en-US")}`,
        name: formatIngredientName(name),
        note: getIngredientNote(name),
      } satisfies FoodIngredientItem;
    })
    .filter(
      (ingredient): ingredient is FoodIngredientItem => ingredient !== null,
    );
}

function splitTopLevelIngredients(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth = Math.max(0, depth - 1);
    } else if (character === "," && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function formatIngredientName(value: string): string {
  const trimmed = value.replace(/\s+/gu, " ").trim();
  const letters = trimmed.replace(/[^A-Za-z]/gu, "");
  if (!letters || /[a-z]/u.test(letters)) {
    return trimmed;
  }
  return trimmed
    .toLocaleLowerCase("en-US")
    .replace(
      /(^|[\s/-])([a-z])/gu,
      (_, prefix: string, letter: string) =>
        `${prefix}${letter.toLocaleUpperCase("en-US")}`,
    );
}

function getIngredientNote(name: string): FoodIngredientNote | null {
  const normalized = name.toLocaleLowerCase("en-US");
  const match = INGREDIENT_NOTES.find((candidate) =>
    candidate.pattern.test(normalized),
  );
  return match
    ? {
        detail: match.detail,
        kind: match.kind,
        label: match.label,
        level: match.level,
        sourceUrl: match.sourceUrl,
      }
    : null;
}

function findNutritionValue(
  product: PublicProductDetail,
  aliases: string[],
): number | null {
  const row = product.nutrition.rows.find((candidate) =>
    aliases.includes(candidate.name.trim().toLocaleLowerCase("en-US")),
  );
  if (
    row?.amount?.value == null ||
    row.amount.unit == null ||
    row.amount.unit.toLocaleLowerCase("en-US") !== "g" ||
    row.basis !== "per_100_g"
  ) {
    return null;
  }
  return row.amount.value;
}

function selectReasons(reasons: FoodMurphNoteReason[]): FoodMurphNoteReason[] {
  const caution = reasons.filter((reason) => reason.tone === "caution");
  const positive = reasons.filter((reason) => reason.tone === "positive");
  const neutral = reasons.filter((reason) => reason.tone === "neutral");
  if (caution.length > 0 && positive.length > 0) {
    const cautionLimit = caution.length > 1 ? 2 : 1;
    return [
      ...caution.slice(0, cautionLimit),
      ...positive.slice(0, 3 - cautionLimit),
    ];
  }
  return [...caution, ...positive, ...neutral].slice(0, 3);
}

function formatAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function uniqueNames(names: string[]): string[] {
  return [
    ...new Map(
      names.map((name) => [name.toLocaleLowerCase("en-US"), name]),
    ).values(),
  ];
}

function joinNames(values: string[]): string {
  const uniqueValues = uniqueNames(values);
  if (uniqueValues.length <= 1) {
    return uniqueValues[0] ?? "";
  }
  if (uniqueValues.length === 2) {
    return `${uniqueValues[0]} and ${uniqueValues[1]}`;
  }
  return `${uniqueValues.slice(0, -1).join(", ")}, and ${
    uniqueValues[uniqueValues.length - 1]
  }`;
}
