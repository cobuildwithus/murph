import { readFile } from "node:fs/promises";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFoodsQueries } from "../src/lib/foods";
import {
  createPublicSupplementsQueries,
  createSupplementsQueries,
  type SupplementSearchItem,
} from "../src/lib/supplements";

const TEST_DATABASE_ENV = "MURPH_SUPPLEMENT_SEARCH_TEST_DB_URL";
const testDatabaseUrl = process.env[TEST_DATABASE_ENV]?.trim() || null;

type FixtureSupplementInput = {
  brand: string;
  canonicalKey?: string;
  dataOrigin?: "brand_site" | "dailymed" | "dsld" | "plasticlist_bay_area_2024";
  id: string;
  name: string;
  offMarket?: boolean;
  priority?: number;
  terms?: readonly string[];
  upc?: string;
};

type FixtureSupplement = {
  brand: string;
  canonicalKey: string;
  dataOrigin: FixtureSupplementInput["dataOrigin"];
  dataOriginId: string;
  id: string;
  label: { fixture: true };
  name: string;
  offMarket: boolean;
  priority: number;
  searchText: string;
  upc: string | null;
};

type SearchCase = {
  category: string;
  excludedIds?: readonly string[];
  expectedEmpty?: boolean;
  expectedIds?: readonly string[];
  expectedTopBrand?: string;
  expectedTopId?: string;
  includeOffMarket?: boolean;
  limit?: number;
  name: string;
  query: string;
};

function fixture(input: FixtureSupplementInput): FixtureSupplement {
  const upc = input.upc ?? null;

  return {
    brand: input.brand,
    canonicalKey: input.canonicalKey ?? `fixture:${input.id}`,
    dataOrigin: input.dataOrigin ?? "brand_site",
    dataOriginId: input.id,
    id: input.id,
    label: { fixture: true },
    name: input.name,
    offMarket: input.offMarket ?? false,
    priority: input.priority ?? (input.dataOrigin === "dsld" ? 10 : 0),
    searchText: [input.name, input.brand, upc, ...(input.terms ?? [])]
      .filter((value): value is string => Boolean(value))
      .join(" "),
    upc,
  };
}

const FIXTURE_SUPPLEMENTS = [
  fixture({
    brand: "Momentous",
    id: "momentous-creatine",
    name: "Creatine Monohydrate",
    terms: ["micronized powder 5 g"],
  }),
  fixture({
    brand: "Momentous",
    id: "momentous-magnesium",
    name: "Magnesium L-Threonate",
    terms: ["magtein capsules"],
  }),
  fixture({
    brand: "Pure Encapsulations",
    id: "pure-magnesium",
    name: "Magnesium Glycinate Capsules",
    terms: ["120 mg"],
  }),
  fixture({
    brand: "Thorne",
    id: "thorne-magnesium",
    name: "Magnesium Bisglycinate",
    terms: ["powder 200 mg"],
  }),
  fixture({
    brand: "Thorne",
    id: "thorne-vitamin-d",
    name: "Vitamin D-5000",
    terms: ["vitamin d3 5000 iu capsules"],
  }),
  fixture({
    brand: "Nature Made",
    id: "nature-made-vitamin-c",
    name: "Vitamin C 500 mg Tablets",
    terms: ["ascorbic acid"],
  }),
  fixture({
    brand: "Life Extension",
    id: "life-extension-magnesium",
    name: "Magnesium Caps",
    terms: ["oxide citrate succinate 500 mg"],
  }),
  fixture({
    brand: "Optimum Nutrition",
    id: "optimum-whey",
    name: "Gold Standard 100% Whey",
    terms: ["protein powder vanilla"],
  }),
  fixture({
    brand: "Doctor's Best",
    id: "doctors-best-magnesium",
    name: "High Absorption Magnesium",
    terms: ["glycinate lysinate tablets"],
  }),
  fixture({
    brand: "Garden of Life Dr. Formulated",
    id: "garden-dr-probiotics",
    name: "Dr. Formulated Probiotics Once Daily",
    terms: ["30 billion cfu capsules"],
  }),
  fixture({
    brand: "Garden of Life MyKind Organics",
    id: "garden-mykind-womens-multi",
    name: "Women's Multi",
    terms: ["organic multivitamin tablets"],
  }),
  fixture({
    brand: "Garden of Life MyKind Organics",
    id: "garden-mykind-once-daily",
    name: "Women's Once Daily",
    terms: ["organic multivitamin tablets"],
  }),
  fixture({
    brand: "Garden of Life Vitamin Code",
    id: "garden-vitamin-code-iron",
    name: "Raw Iron",
    terms: ["iron vitamin capsules"],
  }),
  fixture({
    brand: "Blueprint",
    id: "blueprint-antioxidants",
    name: "Advanced Antioxidants",
    terms: ["antioxidant capsules"],
  }),
  fixture({
    brand: "Blueprint",
    id: "blueprint-nac-ginger",
    name: "NAC + Ginger",
    terms: ["n acetyl cysteine ginger capsules"],
  }),
  fixture({
    brand: "Blueprint",
    id: "blueprint-essentials",
    name: "Essentials",
    terms: ["bryan johnson daily capsules"],
  }),
  fixture({
    brand: "Essentials",
    id: "essentials-foundation",
    name: "Daily Foundation",
    terms: ["vitamins minerals"],
  }),
  fixture({
    brand: "Basic Labs",
    dataOrigin: "dsld",
    id: "generic-creatine",
    name: "Creatine",
    terms: ["monohydrate"],
  }),
  fixture({
    brand: "NutraBase",
    dataOrigin: "dsld",
    id: "generic-magnesium-powder",
    name: "Magnesium Glycinate Powder",
    terms: ["200 mg"],
  }),
  fixture({
    brand: "NutraBase",
    dataOrigin: "dsld",
    id: "generic-vitamin-d3",
    name: "Vitamin D3 5000 IU",
    terms: ["cholecalciferol capsules"],
  }),
  fixture({
    brand: "NutraBase",
    dataOrigin: "dsld",
    id: "generic-omega-fish-oil",
    name: "Omega-3 Fish Oil",
    terms: ["epa dha softgels"],
  }),
  fixture({
    brand: "NutraBase",
    dataOrigin: "dsld",
    id: "generic-zinc",
    name: "Zinc Picolinate",
    terms: ["30 mg tablets"],
  }),
  fixture({
    brand: "NutraBase",
    dataOrigin: "dsld",
    id: "generic-probiotic",
    name: "Probiotic Capsules",
    terms: ["10 billion cfu"],
  }),
  fixture({
    brand: "NutraBase",
    dataOrigin: "dsld",
    id: "generic-ashwagandha",
    name: "Ashwagandha",
    terms: ["root extract ksm 66 capsules"],
  }),
  fixture({
    brand: "NutraBase",
    dataOrigin: "dsld",
    id: "generic-coq10",
    name: "Coenzyme Q10",
    terms: ["coq10 ubiquinone softgels"],
  }),
  fixture({
    brand: "NutraBase",
    dataOrigin: "dsld",
    id: "generic-nac",
    name: "N-Acetyl Cysteine",
    terms: ["nac 600 mg capsules"],
  }),
  fixture({
    brand: "NutraBase",
    dataOrigin: "dsld",
    id: "generic-alpha-lipoic-acid",
    name: "Alpha-Lipoic Acid",
    terms: ["ala 300 mg capsules"],
  }),
  fixture({
    brand: "NutraBase",
    dataOrigin: "dsld",
    id: "generic-l-theanine",
    name: "L-Theanine",
    terms: ["200 mg capsules"],
  }),
  fixture({
    brand: "NutraBase",
    dataOrigin: "dsld",
    id: "generic-b-complex",
    name: "B-Complex",
    terms: ["b vitamins capsules"],
  }),
  fixture({
    brand: "NutraBase",
    dataOrigin: "dsld",
    id: "generic-multivitamin",
    name: "Multivitamin",
    terms: ["vitamins minerals tablets"],
  }),
  fixture({
    brand: "NutraBase",
    dataOrigin: "dsld",
    id: "generic-digestive-enzymes",
    name: "Digestive Enzymes",
    terms: ["enzyme capsules"],
  }),
  fixture({
    brand: "NutraBase",
    dataOrigin: "dsld",
    id: "generic-elderberry-gummies",
    name: "Elderberry Gummies",
    terms: ["sambucus berry gummy"],
  }),
  fixture({
    brand: "NutraBase",
    dataOrigin: "dsld",
    id: "generic-mineral-tablets",
    name: "Mineral Tablets",
    terms: ["calcium magnesium zinc"],
  }),
  fixture({
    brand: "NutraBase",
    dataOrigin: "dsld",
    id: "generic-electrolytes",
    name: "Electrolytes",
    terms: ["sodium potassium magnesium powder"],
  }),
  fixture({
    brand: "NutraBase",
    dataOrigin: "dsld",
    id: "generic-antioxidants",
    name: "Antioxidants",
    terms: ["vitamin c vitamin e capsules"],
  }),
  fixture({
    brand: "Everyday Health",
    dataOrigin: "dsld",
    id: "daily-supplement",
    name: "Daily Supplement",
    terms: ["daily vitamins"],
  }),
  fixture({
    brand: "NOW",
    canonicalKey: "fixture:now-omega",
    id: "now-omega-brand-site",
    name: "Omega-3 Mini Gels",
    terms: ["fish oil epa dha"],
  }),
  fixture({
    brand: "Now",
    canonicalKey: "fixture:now-omega",
    dataOrigin: "dsld",
    id: "now-omega-dsld",
    name: "Omega-3 Mini Gels",
    terms: ["fish oil epa dha"],
  }),
  fixture({
    brand: "NOW",
    id: "now-creatine",
    name: "Creatine Monohydrate Powder",
    terms: ["micronized 5 g"],
  }),
  fixture({
    brand: "Now",
    id: "now-magnesium",
    name: "Magnesium Citrate",
    terms: ["200 mg capsules"],
  }),
  fixture({
    brand: "Decoy Labs",
    dataOrigin: "dsld",
    id: "decoy-now-omega",
    name: "NOW Omega-3 Mini Gels",
    terms: ["fish oil"],
  }),
  fixture({
    brand: "Decoy Labs",
    dataOrigin: "dsld",
    id: "decoy-now-creatine",
    name: "NOW Creatine Monohydrate",
    terms: ["powder"],
  }),
  fixture({
    brand: "Decoy Labs",
    dataOrigin: "dsld",
    id: "decoy-now-magnesium",
    name: "NOW Magnesium Citrate",
    terms: ["capsules"],
  }),
  fixture({
    brand: "Solgar",
    dataOrigin: "dsld",
    id: "solgar-vitamin-d3-exact",
    name: "Vitamin D3",
    terms: ["cholecalciferol"],
  }),
  fixture({
    brand: "Solgar",
    id: "solgar-vitamin-d3-official",
    name: "Vitamin D3 1000 IU Softgels",
    terms: ["cholecalciferol"],
  }),
  fixture({
    brand: "Solgar",
    dataOrigin: "dsld",
    id: "solgar-vitamin-d3-dsld",
    name: "Vitamin D3 1000 IU Softgels",
    terms: ["cholecalciferol"],
  }),
  fixture({
    brand: "Solgar",
    id: "solgar-calcium-d3",
    name: "Calcium Magnesium Plus Vitamin D3",
    terms: ["tablets"],
  }),
  fixture({
    brand: "Ritual",
    id: "ritual-womens-multivitamin",
    name: "Essential for Women Multivitamin 18+",
    terms: ["daily capsules"],
  }),
  fixture({
    brand: "Café Santé",
    id: "cafe-sante-electrolytes",
    name: "Electrolyte Mineral Drops",
    terms: ["sodium potassium magnesium"],
  }),
  fixture({
    brand: "Théa Labs",
    id: "thea-womens-multivitamin",
    name: "Women's Multivitamin",
    terms: ["daily tablets"],
  }),
  fixture({
    brand: "O'Connor Nutrition",
    id: "oconnor-coq10",
    name: "CoQ10 200 mg",
    terms: ["coenzyme q10 ubiquinone softgels"],
  }),
  fixture({
    brand: "Heritage Health",
    dataOrigin: "dsld",
    id: "legacy-liver-support",
    name: "Legacy Liver Support",
    offMarket: true,
    terms: ["milk thistle capsules"],
  }),
  fixture({
    brand: "Heritage Health",
    id: "current-liver-support",
    name: "Current Liver Support",
    terms: ["milk thistle capsules"],
  }),
  fixture({
    brand: "Canonical Labs",
    canonicalKey: "fixture:canonical-omega",
    id: "canonical-omega-brand-site",
    name: "Canonical Omega-3 Active",
    terms: ["fish oil softgels"],
  }),
  fixture({
    brand: "Canonical Labs",
    canonicalKey: "fixture:canonical-omega",
    dataOrigin: "dsld",
    id: "canonical-omega-dsld",
    name: "Canonical Omega-3 Active",
    terms: ["fish oil softgels"],
  }),
  fixture({
    brand: "Excluded Source",
    dataOrigin: "plasticlist_bay_area_2024",
    id: "excluded-source-creatine",
    name: "Excluded Source Creatine",
    terms: ["creatine monohydrate"],
  }),
  fixture({
    brand: "Barcode Labs",
    id: "barcode-vitamin-k2",
    name: "Vitamin K2 MK-7",
    terms: ["menaquinone"],
    upc: "012345678905",
  }),
] as const;

const NORMALIZATION_CASES: readonly SearchCase[] = [
  { category: "normalization", name: "ordinary brand prefix", query: "Momentous Creatine", expectedTopId: "momentous-creatine" },
  { category: "normalization", name: "lowercase query", query: "momentous creatine", expectedTopId: "momentous-creatine" },
  { category: "normalization", name: "uppercase query", query: "MOMENTOUS CREATINE", expectedTopId: "momentous-creatine" },
  { category: "normalization", name: "outer and repeated spaces", query: "  Momentous   Creatine  ", expectedTopId: "momentous-creatine" },
  { category: "normalization", name: "hyphen separator", query: "Momentous-Creatine", expectedTopId: "momentous-creatine" },
  { category: "normalization", name: "slash separator", query: "Momentous/Creatine", expectedTopId: "momentous-creatine" },
  { category: "normalization", name: "colon separator", query: "Momentous: Creatine", expectedTopId: "momentous-creatine" },
  { category: "normalization", name: "one-word brand suffix", query: "Creatine Momentous", expectedTopId: "momentous-creatine" },
  { category: "normalization", name: "weak singular suffix", query: "Momentous Creatine supplement", expectedTopId: "momentous-creatine" },
  { category: "normalization", name: "weak plural prefix", query: "supplements Momentous Creatine", expectedTopId: "momentous-creatine" },
  { category: "normalization", name: "multiword brand", query: "Pure Encapsulations Magnesium Glycinate", expectedTopId: "pure-magnesium" },
  { category: "normalization", name: "multiword brand lowercase", query: "pure encapsulations magnesium glycinate", expectedTopId: "pure-magnesium" },
  { category: "normalization", name: "multiword brand punctuation", query: "Pure-Encapsulations: Magnesium Glycinate", expectedTopId: "pure-magnesium" },
  { category: "normalization", name: "nature made exact", query: "Nature Made Vitamin C", expectedTopId: "nature-made-vitamin-c" },
  { category: "normalization", name: "nature made hyphenated", query: "Nature-Made Vitamin C", expectedTopId: "nature-made-vitamin-c" },
  { category: "normalization", name: "nature made suffix", query: "Vitamin C Nature Made", expectedTopId: "nature-made-vitamin-c" },
  { category: "normalization", name: "life extension exact", query: "Life Extension Magnesium", expectedTopId: "life-extension-magnesium" },
  { category: "normalization", name: "life extension punctuation", query: "Life-Extension: Magnesium", expectedTopId: "life-extension-magnesium" },
  { category: "normalization", name: "optimum whey", query: "Optimum Nutrition Gold Standard Whey", expectedTopId: "optimum-whey" },
  { category: "normalization", name: "optimum percent punctuation", query: "Optimum Nutrition / Gold Standard 100% Whey", expectedTopId: "optimum-whey" },
  { category: "normalization", name: "straight possessive brand", query: "Doctor's Best Magnesium", expectedTopId: "doctors-best-magnesium" },
  { category: "normalization", name: "possessive omitted", query: "Doctors Best Magnesium", expectedTopId: "doctors-best-magnesium" },
  { category: "normalization", name: "period omitted from sub-brand", query: "Garden of Life Dr Formulated Probiotics", expectedTopId: "garden-dr-probiotics" },
  { category: "normalization", name: "period retained in sub-brand", query: "Garden of Life Dr. Formulated Probiotics", expectedTopId: "garden-dr-probiotics" },
  { category: "normalization", name: "parent brand reaches product line", query: "Garden of Life Organics Women's Multi", expectedTopId: "garden-mykind-womens-multi" },
] as const;

const BRAND_AND_RANKING_CASES: readonly SearchCase[] = [
  { category: "brand-ranking", name: "thorne magnesium", query: "Thorne Magnesium Bisglycinate", expectedTopId: "thorne-magnesium" },
  { category: "brand-ranking", name: "thorne vitamin d", query: "Thorne Vitamin D 5000", expectedTopId: "thorne-vitamin-d" },
  { category: "brand-ranking", name: "garden once daily", query: "Garden of Life Organics Women's Once Daily", expectedTopId: "garden-mykind-once-daily" },
  { category: "brand-ranking", name: "garden vitamin code", query: "Garden of Life Vitamin Code Raw Iron", expectedTopId: "garden-vitamin-code-iron" },
  { category: "brand-ranking", name: "blueprint singular antioxidant", query: "Blueprint Advanced Antioxidant", expectedTopId: "blueprint-antioxidants" },
  { category: "brand-ranking", name: "blueprint nac ginger", query: "Blueprint NAC Ginger", expectedTopId: "blueprint-nac-ginger" },
  { category: "brand-ranking", name: "ambiguous trailing line brand", query: "Bryan Johnson Blueprint Essentials", expectedTopId: "blueprint-essentials" },
  { category: "brand-ranking", name: "ritual women", query: "Ritual Essential for Women", expectedTopId: "ritual-womens-multivitamin" },
  { category: "brand-ranking", name: "exact short name beats adjacent official row", query: "Solgar Vitamin D3", expectedTopId: "solgar-vitamin-d3-exact" },
  { category: "brand-ranking", name: "exact long official row", query: "Solgar Vitamin D3 1000 IU Softgels", expectedTopId: "solgar-vitamin-d3-official" },
  { category: "brand-ranking", name: "source priority resolves identical product tie", query: "SOLGAR VITAMIN D3 1000 IU SOFTGELS", expectedTopId: "solgar-vitamin-d3-official" },
  { category: "brand-ranking", name: "adjacent calcium row does not beat exact d3", query: "Solgar: Vitamin D3", expectedTopId: "solgar-vitamin-d3-exact" },
  { category: "brand-ranking", name: "duplicate normalized now brand omega", query: "NOW Omega-3", expectedTopId: "now-omega-brand-site", expectedTopBrand: "NOW", excludedIds: ["decoy-now-omega"] },
  { category: "brand-ranking", name: "duplicate normalized now brand lowercase", query: "now omega 3", expectedTopId: "now-omega-brand-site", expectedTopBrand: "NOW", excludedIds: ["decoy-now-omega"] },
  { category: "brand-ranking", name: "duplicate normalized now brand full product", query: "Now Omega-3 Mini Gels", expectedTopId: "now-omega-brand-site", expectedTopBrand: "NOW", excludedIds: ["decoy-now-omega"] },
  { category: "brand-ranking", name: "duplicate normalized now brand punctuation", query: "NOW: Omega-3 Mini Gels", expectedTopId: "now-omega-brand-site", expectedTopBrand: "NOW", excludedIds: ["decoy-now-omega"] },
  { category: "brand-ranking", name: "duplicate normalized now brand as suffix", query: "Omega-3 Mini Gels NOW", expectedTopId: "now-omega-brand-site", expectedTopBrand: "NOW", excludedIds: ["decoy-now-omega"] },
  { category: "brand-ranking", name: "duplicate normalized now brand creatine", query: "NOW Creatine", expectedTopId: "now-creatine", expectedTopBrand: "NOW", excludedIds: ["decoy-now-creatine"] },
  { category: "brand-ranking", name: "duplicate normalized now brand creatine details", query: "now creatine monohydrate", expectedTopId: "now-creatine", expectedTopBrand: "NOW", excludedIds: ["decoy-now-creatine"] },
  { category: "brand-ranking", name: "duplicate normalized now creatine suffix", query: "creatine now", expectedTopId: "now-creatine", expectedTopBrand: "NOW", excludedIds: ["decoy-now-creatine"] },
  { category: "brand-ranking", name: "duplicate normalized now brand magnesium", query: "NOW Magnesium", expectedTopId: "now-magnesium", expectedTopBrand: "Now", excludedIds: ["decoy-now-magnesium"] },
  { category: "brand-ranking", name: "duplicate normalized now magnesium details", query: "now magnesium citrate", expectedTopId: "now-magnesium", expectedTopBrand: "Now", excludedIds: ["decoy-now-magnesium"] },
] as const;

const INGREDIENT_AND_FORM_CASES: readonly SearchCase[] = [
  { category: "ingredient-form", name: "generic creatine exact", query: "creatine", expectedTopId: "generic-creatine" },
  { category: "ingredient-form", name: "creatine monohydrate", query: "creatine monohydrate", expectedIds: ["momentous-creatine", "generic-creatine"] },
  { category: "ingredient-form", name: "micronized creatine powder", query: "micronized creatine powder", expectedIds: ["momentous-creatine", "now-creatine"] },
  { category: "ingredient-form", name: "magnesium glycinate powder", query: "magnesium glycinate powder", expectedTopId: "generic-magnesium-powder" },
  { category: "ingredient-form", name: "magnesium bisglycinate", query: "magnesium bisglycinate", expectedTopId: "thorne-magnesium" },
  { category: "ingredient-form", name: "magnesium l threonate", query: "magnesium l threonate", expectedTopId: "momentous-magnesium" },
  { category: "ingredient-form", name: "vitamin d3 dose", query: "vitamin d3 5000 iu", expectedTopId: "generic-vitamin-d3" },
  { category: "ingredient-form", name: "omega fish oil", query: "omega 3 fish oil", expectedTopId: "generic-omega-fish-oil" },
  { category: "ingredient-form", name: "omega epa dha", query: "omega 3 epa dha", expectedIds: ["generic-omega-fish-oil"] },
  { category: "ingredient-form", name: "zinc salt", query: "zinc picolinate", expectedTopId: "generic-zinc" },
  { category: "ingredient-form", name: "probiotic cfu", query: "probiotic 10 billion cfu", expectedTopId: "generic-probiotic" },
  { category: "ingredient-form", name: "ashwagandha extract", query: "ashwagandha root extract", expectedTopId: "generic-ashwagandha" },
  { category: "ingredient-form", name: "coenzyme q10", query: "coenzyme q10", expectedTopId: "generic-coq10" },
  { category: "ingredient-form", name: "coq10 synonym", query: "coq10 ubiquinone", expectedIds: ["generic-coq10", "oconnor-coq10"] },
  { category: "ingredient-form", name: "n acetyl cysteine", query: "n acetyl cysteine", expectedTopId: "generic-nac" },
  { category: "ingredient-form", name: "alpha lipoic acid", query: "alpha lipoic acid", expectedTopId: "generic-alpha-lipoic-acid" },
  { category: "ingredient-form", name: "l theanine", query: "l theanine 200 mg", expectedTopId: "generic-l-theanine" },
  { category: "ingredient-form", name: "b complex", query: "b complex vitamins", expectedTopId: "generic-b-complex" },
  { category: "ingredient-form", name: "multivitamin minerals", query: "multivitamin vitamins minerals", expectedTopId: "generic-multivitamin" },
  { category: "ingredient-form", name: "electrolyte mineral mix", query: "electrolytes sodium potassium", expectedTopId: "generic-electrolytes" },
] as const;

const STEMMING_CASES: readonly SearchCase[] = [
  { category: "stemming", name: "singular antioxidant", query: "antioxidant", expectedTopId: "generic-antioxidants" },
  { category: "stemming", name: "plural antioxidants", query: "antioxidants", expectedTopId: "generic-antioxidants" },
  { category: "stemming", name: "singular probiotic", query: "probiotic capsule", expectedTopId: "generic-probiotic" },
  { category: "stemming", name: "plural probiotics", query: "probiotics capsules", expectedTopId: "generic-probiotic" },
  { category: "stemming", name: "singular digestive enzyme", query: "digestive enzyme", expectedTopId: "generic-digestive-enzymes" },
  { category: "stemming", name: "plural digestive enzymes", query: "digestive enzymes", expectedTopId: "generic-digestive-enzymes" },
  { category: "stemming", name: "singular mineral tablet", query: "mineral tablet", expectedTopId: "generic-mineral-tablets" },
  { category: "stemming", name: "plural mineral tablets", query: "mineral tablets", expectedTopId: "generic-mineral-tablets" },
  { category: "stemming", name: "singular elderberry gummy", query: "elderberry gummy", expectedTopId: "generic-elderberry-gummies" },
  { category: "stemming", name: "plural elderberry gummies", query: "elderberry gummies", expectedTopId: "generic-elderberry-gummies" },
  { category: "stemming", name: "plural multivitamins", query: "multivitamins", expectedTopId: "generic-multivitamin" },
  { category: "stemming", name: "singular antioxidant with weak token", query: "antioxidant supplement", expectedTopId: "generic-antioxidants" },
] as const;

const TYPO_CASES: readonly SearchCase[] = [
  { category: "typo", name: "creatine missing final letter", query: "creatin", expectedTopId: "generic-creatine" },
  { category: "typo", name: "ashwagandha missing h", query: "ashwaganda", expectedTopId: "generic-ashwagandha" },
  { category: "typo", name: "magnesium transposition", query: "magnesium glycintae", expectedIds: ["generic-magnesium-powder"] },
  { category: "typo", name: "coenzyme missing e", query: "coenzme q10", expectedTopId: "generic-coq10" },
  { category: "typo", name: "probiotic missing i", query: "probotic", expectedTopId: "generic-probiotic" },
  { category: "typo", name: "antioxidants vowel typo", query: "antioxidents", expectedTopId: "generic-antioxidants" },
  { category: "typo", name: "electrolytes missing y", query: "electrolites", expectedTopId: "generic-electrolytes" },
  { category: "typo", name: "theanine missing e", query: "l theanin", expectedTopId: "generic-l-theanine" },
  { category: "typo", name: "zinc transposition", query: "zinc picolintae", expectedTopId: "generic-zinc" },
  { category: "typo", name: "multivitamin missing a", query: "multivitmin", expectedIds: ["generic-multivitamin"] },
  { category: "typo", name: "cysteine missing final e", query: "n acetyl cystein", expectedTopId: "generic-nac" },
  { category: "typo", name: "acid missing i", query: "alpha lipoic acd", expectedTopId: "generic-alpha-lipoic-acid" },
] as const;

const UNICODE_CASES: readonly SearchCase[] = [
  { category: "unicode", name: "curly possessive apostrophe", query: "Doctor’s Best Magnesium", expectedTopId: "doctors-best-magnesium" },
  { category: "unicode", name: "modifier-letter possessive apostrophe", query: "Doctorʼs Best Magnesium", expectedTopId: "doctors-best-magnesium" },
  { category: "unicode", name: "curly oconnor apostrophe", query: "O’Connor Nutrition CoQ10", expectedTopId: "oconnor-coq10" },
  { category: "unicode", name: "apostrophe omitted from oconnor", query: "OConnor Nutrition CoQ10", expectedTopId: "oconnor-coq10" },
  { category: "unicode", name: "accented brand exact", query: "Café Santé Electrolyte", expectedTopId: "cafe-sante-electrolytes" },
  { category: "unicode", name: "accentless brand query", query: "Cafe Sante Electrolyte", expectedTopId: "cafe-sante-electrolytes" },
  { category: "unicode", name: "decomposed accented brand", query: "Cafe\u0301 Sante\u0301 Electrolyte", expectedTopId: "cafe-sante-electrolytes" },
  { category: "unicode", name: "fullwidth latin brand", query: "Ｃａｆｅ Ｓａｎｔｅ Electrolyte", expectedTopId: "cafe-sante-electrolytes" },
  { category: "unicode", name: "accented thea brand exact", query: "Théa Labs Women's Multivitamin", expectedTopId: "thea-womens-multivitamin" },
  { category: "unicode", name: "accentless thea brand", query: "Thea Labs Womens Multivitamin", expectedTopId: "thea-womens-multivitamin" },
  { category: "unicode", name: "nonbreaking brand space", query: "Life\u00a0Extension Magnesium", expectedTopId: "life-extension-magnesium" },
  { category: "unicode", name: "em dash separator", query: "Nature Made—Vitamin C", expectedTopId: "nature-made-vitamin-c" },
] as const;

const WEAK_QUERY_CASES: readonly SearchCase[] = [
  { category: "weak-query", name: "weak singular only does not search", query: "supplement", expectedEmpty: true },
  { category: "weak-query", name: "weak plural only does not search", query: "supplements", expectedEmpty: true },
  { category: "weak-query", name: "repeated weak terms do not search", query: "supplement supplement", expectedEmpty: true },
  { category: "weak-query", name: "weak creatine suffix removed", query: "creatine supplement", expectedTopId: "generic-creatine" },
  { category: "weak-query", name: "weak creatine prefix removed", query: "supplements creatine", expectedTopId: "generic-creatine" },
  { category: "weak-query", name: "weak magnesium suffix removed", query: "magnesium glycinate powder supplement", expectedTopId: "generic-magnesium-powder" },
  { category: "weak-query", name: "weak branded suffix removed", query: "Thorne Magnesium Bisglycinate supplement", expectedTopId: "thorne-magnesium" },
  { category: "weak-query", name: "daily plus weak plural", query: "daily supplements", expectedTopId: "daily-supplement" },
] as const;

const CANONICAL_AND_FILTER_CASES: readonly SearchCase[] = [
  { category: "canonical-filter", name: "canonical group chooses preferred source", query: "Canonical Labs Canonical Omega-3 Active", expectedTopId: "canonical-omega-brand-site", excludedIds: ["canonical-omega-dsld"] },
  { category: "canonical-filter", name: "canonical group dedupes generic query", query: "canonical omega 3 active", expectedTopId: "canonical-omega-brand-site", excludedIds: ["canonical-omega-dsld"] },
  { category: "canonical-filter", name: "off-market row excluded by default", query: "Legacy Liver Support", excludedIds: ["legacy-liver-support"] },
  { category: "canonical-filter", name: "off-market row included explicitly", query: "Legacy Liver Support", includeOffMarket: true, expectedTopId: "legacy-liver-support" },
  { category: "canonical-filter", name: "active replacement remains visible", query: "Current Liver Support", expectedTopId: "current-liver-support" },
  { category: "canonical-filter", name: "excluded contaminant source never appears", query: "Excluded Source Creatine", excludedIds: ["excluded-source-creatine"] },
  { category: "canonical-filter", name: "searches exact twelve-digit upc", query: "012345678905", expectedTopId: "barcode-vitamin-k2" },
  { category: "canonical-filter", name: "searches barcode product identity", query: "Vitamin K2 MK 7", expectedTopId: "barcode-vitamin-k2" },
  { category: "canonical-filter", name: "blank query returns no rows", query: "   ", expectedEmpty: true },
  { category: "canonical-filter", name: "unknown ingredient returns no rows", query: "xyloferrozymase", expectedEmpty: true },
] as const;

const SEARCH_CASES = [
  ...NORMALIZATION_CASES,
  ...BRAND_AND_RANKING_CASES,
  ...INGREDIENT_AND_FORM_CASES,
  ...STEMMING_CASES,
  ...TYPO_CASES,
  ...UNICODE_CASES,
  ...WEAK_QUERY_CASES,
  ...CANONICAL_AND_FILTER_CASES,
] as const;

const canonicalKeyById = new Map(
  FIXTURE_SUPPLEMENTS.map((row) => [row.id, row.canonicalKey]),
);

function isClearlyLocalPostgresUrl(value: string): boolean {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return false;
  }

  const hostOverrides = parsed.searchParams.getAll("host");
  if (hostOverrides.length > 1) {
    return false;
  }

  const hostOverride = hostOverrides[0];
  const effectiveHost = (
    hostOverride === undefined || hostOverride === ""
      ? parsed.hostname
      : hostOverride
  ).toLowerCase();

  return (
    effectiveHost === "localhost" ||
    effectiveHost === "127.0.0.1" ||
    effectiveHost === "::1" ||
    effectiveHost === "[::1]" ||
    effectiveHost.startsWith("/")
  );
}

if (testDatabaseUrl && !isClearlyLocalPostgresUrl(testDatabaseUrl)) {
  throw new Error(
    `${TEST_DATABASE_ENV} must point to localhost, loopback, or a PostgreSQL Unix socket`,
  );
}

describe("supplement PostgreSQL search corpus definition", () => {
  it("contains at least 100 named regression cases", () => {
    expect(SEARCH_CASES.length).toBeGreaterThanOrEqual(100);
    expect(new Set(SEARCH_CASES.map((testCase) => testCase.name)).size).toBe(
      SEARCH_CASES.length,
    );
  });

  it("allows only explicitly local test database URLs", () => {
    expect(isClearlyLocalPostgresUrl("postgresql://localhost/fixture")).toBe(
      true,
    );
    expect(isClearlyLocalPostgresUrl("postgresql://127.0.0.1/fixture")).toBe(
      true,
    );
    expect(
      isClearlyLocalPostgresUrl(
        "postgresql:///fixture?host=%2Fvar%2Frun%2Fpostgresql",
      ),
    ).toBe(true);
    expect(
      isClearlyLocalPostgresUrl(
        "postgresql://db.example.test/fixture?host=127.0.0.1",
      ),
    ).toBe(true);
    expect(isClearlyLocalPostgresUrl("postgresql://db.example.test/fixture")).toBe(
      false,
    );
    expect(
      isClearlyLocalPostgresUrl(
        "postgresql://localhost/fixture?host=db.example.test",
      ),
    ).toBe(false);
    expect(
      isClearlyLocalPostgresUrl(
        "postgresql://localhost/fixture?host=127.0.0.1&host=db.example.test",
      ),
    ).toBe(false);
    expect(isClearlyLocalPostgresUrl("https://localhost/fixture")).toBe(false);
  });
});

describe.runIf(Boolean(testDatabaseUrl))(
  "supplement PostgreSQL search regressions",
  () => {
    const client = new pg.Client({
      connectionString: testDatabaseUrl ?? undefined,
      statement_timeout: 8_000,
    });
    let connected = false;
    let transactionStarted = false;
    let contaminantQueryCount = 0;

    const queryClient = {
      async query<T>(text: string, values: unknown[]) {
        if (
          text.includes("FROM product_tests") ||
          text.includes("JOIN product_tests")
        ) {
          contaminantQueryCount += 1;
          return { rows: [] as T[] };
        }

        const result = await client.query(text, values);
        return { rows: result.rows };
      },
    };
    const queries = createSupplementsQueries(queryClient);
    const foodQueries = createFoodsQueries(queryClient);

    beforeAll(async () => {
      await client.connect();
      connected = true;
      await client.query("BEGIN");
      transactionStarted = true;
      await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
      await client.query("SET LOCAL pg_trgm.similarity_threshold = 0.3");
      await client.query(`
        CREATE TEMP TABLE supplements (
          id TEXT PRIMARY KEY,
          canonical_key TEXT NOT NULL,
          data_origin TEXT NOT NULL,
          data_origin_id TEXT NOT NULL,
          data_origin_priority SMALLINT NOT NULL,
          name TEXT NOT NULL,
          brand TEXT,
          upc TEXT,
          off_market BOOLEAN NOT NULL,
          search_text TEXT NOT NULL,
          label JSONB NOT NULL,
          serving_grams NUMERIC
        ) ON COMMIT DROP
      `);
      await client.query(
        `
        INSERT INTO supplements (
          id,
          canonical_key,
          data_origin,
          data_origin_id,
          data_origin_priority,
          name,
          brand,
          upc,
          off_market,
          search_text,
          label
        )
        SELECT
          seed.id,
          seed.canonical_key,
          seed.data_origin,
          seed.data_origin_id,
          seed.data_origin_priority,
          seed.name,
          seed.brand,
          seed.upc,
          seed.off_market,
          seed.search_text,
          seed.label
        FROM jsonb_to_recordset($1::jsonb) AS seed(
          id TEXT,
          canonical_key TEXT,
          data_origin TEXT,
          data_origin_id TEXT,
          data_origin_priority SMALLINT,
          name TEXT,
          brand TEXT,
          upc TEXT,
          off_market BOOLEAN,
          search_text TEXT,
          label JSONB
        )
        `,
        [
          JSON.stringify(
            FIXTURE_SUPPLEMENTS.map((row) => ({
              brand: row.brand,
              canonical_key: row.canonicalKey,
              data_origin: row.dataOrigin,
              data_origin_id: row.dataOriginId,
              data_origin_priority: row.priority,
              id: row.id,
              label: row.label,
              name: row.name,
              off_market: row.offMarket,
              search_text: row.searchText,
              upc: row.upc,
            })),
          ),
        ],
      );
      await client.query(
        "CREATE INDEX supplements_fixture_search_idx ON supplements USING GIN (to_tsvector('simple', search_text))",
      );
      await client.query(
        "CREATE INDEX supplements_fixture_search_english_idx ON supplements USING GIN (to_tsvector('english', search_text))",
      );
      await client.query(
        "CREATE INDEX supplements_fixture_name_trgm_idx ON supplements USING GIN (name gin_trgm_ops)",
      );
      await client.query("ANALYZE supplements");
      await client.query(`
        CREATE TEMP TABLE foods (
          id TEXT PRIMARY KEY,
          canonical_key TEXT NOT NULL,
          data_origin TEXT NOT NULL,
          data_origin_id TEXT NOT NULL,
          data_origin_priority SMALLINT NOT NULL,
          name TEXT NOT NULL,
          brand TEXT,
          upc TEXT,
          off_market BOOLEAN NOT NULL,
          search_text TEXT NOT NULL,
          label JSONB NOT NULL,
          serving_grams NUMERIC
        ) ON COMMIT DROP
      `);
      await client.query(
        `
        INSERT INTO foods (
          id,
          canonical_key,
          data_origin,
          data_origin_id,
          data_origin_priority,
          name,
          brand,
          upc,
          off_market,
          search_text,
          label
        )
        VALUES (
          'trader-joes:099032',
          'trader-joes:099032',
          'brand_site',
          'trader-joes:099032',
          5,
          'Butter Chicken with Basmati Rice',
          'Trader Joe''s',
          NULL,
          false,
          'Trader Joe''s Butter Chicken with Basmati Rice 099032 chicken sauce basmati rice milk',
          '{"fixture":true}'::jsonb
        )
        `,
      );
      await client.query(`
        INSERT INTO foods (
          id,
          canonical_key,
          data_origin,
          data_origin_id,
          data_origin_priority,
          name,
          brand,
          upc,
          off_market,
          search_text,
          label
        )
        SELECT
          CASE WHEN seed = 6000
            THEN 'zz-food-boundary-fts-alias-priority'
            ELSE 'food-boundary-fts-alias-' || seed::text
          END,
          'food-boundary-fts-alias',
          'usda_branded',
          'food-boundary-fts-alias-' || seed::text,
          CASE WHEN seed = 6000 THEN 1 ELSE 100 END,
          'Boundaryfts Alias',
          NULL,
          NULL,
          false,
          'Boundaryfts Alias',
          '{"fixture":true}'::jsonb
        FROM generate_series(1, 6000) AS aliases(seed)

        UNION ALL

        SELECT
          'food-boundary-fts-distinct-' || seed::text,
          'food-boundary-fts-distinct-' || seed::text,
          'usda_branded',
          'food-boundary-fts-distinct-' || seed::text,
          50,
          'Boundaryfts Distinct ' || seed::text,
          NULL,
          NULL,
          false,
          'Boundaryfts Distinct ' || seed::text,
          '{"fixture":true}'::jsonb
        FROM generate_series(1, 60) AS distinct_rows(seed)

        UNION ALL

        SELECT
          'zz-food-boundary-fts-winner',
          'zz-food-boundary-fts-winner',
          'usda_branded',
          'zz-food-boundary-fts-winner',
          1,
          'Boundaryfts',
          NULL,
          NULL,
          false,
          'Boundaryfts',
          '{"fixture":true}'::jsonb

        UNION ALL

        SELECT
          'food-literal-percent-whey',
          'food-literal-percent-whey',
          'usda_branded',
          'food-literal-percent-whey',
          1,
          '100% Whey',
          NULL,
          NULL,
          false,
          '100% Whey protein',
          '{"fixture":true}'::jsonb
      `);
      await client.query(
        "CREATE INDEX foods_fixture_search_idx ON foods USING GIN (to_tsvector('simple', search_text))",
      );
      await client.query(
        "CREATE INDEX foods_fixture_name_trgm_idx ON foods USING GIN (name gin_trgm_ops)",
      );
      await client.query(
        "CREATE INDEX foods_fixture_name_rank_idx ON foods USING GIST (name gist_trgm_ops)",
      );
      await client.query(
        "CREATE INDEX foods_fixture_name_exact_rank_idx ON foods (lower(name), data_origin_priority, id)",
      );
      await client.query(
        "CREATE INDEX foods_fixture_canonical_rank_idx ON foods (canonical_key, data_origin_priority, id)",
      );
      await client.query("ANALYZE foods");
    });

    afterAll(async () => {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }
      if (connected) {
        await client.end();
      }
    });

    it.each(SEARCH_CASES)(
      "$category: $name",
      async (testCase) => {
        const rows = await queries.searchSupplements({
          includeOffMarket: testCase.includeOffMarket ?? false,
          limit: testCase.limit ?? 8,
          q: testCase.query,
        });

        assertSearchCase(rows, testCase);
      },
      20_000,
    );

    it.each(["Trader Joe's", "Trader Joe's Butter Chicken"])(
      "keeps apostrophized food search %j reachable through PostgreSQL",
      async (q) => {
        const rows = await foodQueries.searchFoods({
          includeOffMarket: false,
          limit: 5,
          q,
        });

        expect(rows.map((row) => row.id)).toContain("trader-joes:099032");
      },
      20_000,
    );

    it("keeps food ranking and canonical diversity beyond the match cap", async () => {
      const first = await foodQueries.searchFoods({
        includeOffMarket: false,
        limit: 50,
        q: "boundaryfts",
      });
      const repeated = await foodQueries.searchFoods({
        includeOffMarket: false,
        limit: 50,
        q: "boundaryfts",
      });

      expect(first).toHaveLength(50);
      expect(first[0]?.id).toBe("zz-food-boundary-fts-winner");
      expect(first.map((row) => row.id)).toContain(
        "zz-food-boundary-fts-alias-priority",
      );
      expect(repeated.map((row) => row.id)).toEqual(
        first.map((row) => row.id),
      );
    }, 20_000);

    it.each(["% boundaryfts", "_ boundaryfts"])(
      "treats SQL wildcard characters as ordinary food-search input for %s",
      async (q) => {
        const rows = await foodQueries.searchFoods({
          includeOffMarket: false,
          limit: 50,
          q,
        });

        expect(rows).toHaveLength(50);
        expect(rows[0]?.id).toBe("zz-food-boundary-fts-winner");
      },
      20_000,
    );

    it("keeps literal percent product names searchable", async () => {
      const rows = await foodQueries.searchFoods({
        includeOffMarket: false,
        limit: 5,
        q: "100% Whey",
      });

      expect(rows.map((row) => row.id)).toContain("food-literal-percent-whey");
    }, 20_000);

    it("intercepts every contaminant lookup instead of requiring product-test tables", () => {
      expect(contaminantQueryCount).toBeGreaterThan(0);
    });
  },
);

describe.runIf(Boolean(testDatabaseUrl))(
  "public supplement evidence PostgreSQL query",
  () => {
    it("deduplicates, counts, bounds, and screens exact-record product evidence", async () => {
      const client = new pg.Client({
        connectionString: testDatabaseUrl ?? undefined,
        statement_timeout: 8_000,
      });

      await client.connect();
      await client.query("BEGIN");

      try {
        await client.query(`
          CREATE TEMP TABLE supplements (
            id TEXT PRIMARY KEY,
            canonical_key TEXT NOT NULL,
            data_origin TEXT NOT NULL,
            data_origin_id TEXT NOT NULL,
            data_origin_url TEXT,
            data_origin_priority SMALLINT NOT NULL DEFAULT 100,
            name TEXT NOT NULL,
            brand TEXT,
            upc TEXT,
            off_market BOOLEAN NOT NULL DEFAULT FALSE,
            search_text TEXT NOT NULL,
            label JSONB NOT NULL,
            serving_grams NUMERIC,
            imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
          ) ON COMMIT DROP
        `);
        await client.query(`
          INSERT INTO supplements (
            id,
            canonical_key,
            data_origin,
            data_origin_id,
            name,
            brand,
            search_text,
            label,
            serving_grams
          )
          VALUES
            (
              'brand:public-source',
              'canonical-public-product',
              'brand_site',
              'brand:public-source',
              'Public Source Product',
              'Example Nutrition',
              'Public Source Product Example Nutrition',
              '{}'::jsonb,
              5
            ),
            (
              'dsld:tested-alias',
              'canonical-public-product',
              'dsld',
              'dsld:tested-alias',
              'Tested Alias Product',
              'Example Nutrition',
              'Tested Alias Product Example Nutrition',
              '{}'::jsonb,
              5
            )
        `);
        await client.query(`
          CREATE TEMP TABLE product_tests (
            id TEXT PRIMARY KEY,
            food_id TEXT,
            supplement_id TEXT,
            source_key TEXT NOT NULL,
            source_result_id TEXT NOT NULL,
            source_name TEXT NOT NULL,
            source_url TEXT,
            source_report_title TEXT,
            report_date DATE,
            tested_product_name TEXT,
            tested_product_brand TEXT,
            tested_product_upc TEXT,
            tested_product_upc_raw TEXT,
            tested_source_product_id TEXT,
            evidence_type TEXT NOT NULL DEFAULT 'laboratory_measurement',
            sampling_context TEXT NOT NULL DEFAULT 'unspecified',
            source_sample_id TEXT,
            source_sample_count INTEGER,
            tested_lot_code TEXT,
            tested_best_by TEXT,
            tested_package_size TEXT,
            collected_on DATE,
            tested_on DATE,
            match_method TEXT NOT NULL,
            contaminant_key TEXT NOT NULL,
            contaminant_name TEXT NOT NULL,
            result_operator TEXT NOT NULL,
            result_value NUMERIC,
            result_upper_value NUMERIC,
            result_unit TEXT NOT NULL,
            result_basis TEXT NOT NULL,
            normalized_value NUMERIC,
            normalized_upper_value NUMERIC,
            normalized_unit TEXT,
            normalized_basis TEXT,
            result_qualifier TEXT,
            detection_limit_value NUMERIC,
            detection_limit_unit TEXT,
            quantification_limit_value NUMERIC,
            quantification_limit_unit TEXT,
            reporting_limit_value NUMERIC,
            reporting_limit_unit TEXT,
            uncertainty_value NUMERIC,
            uncertainty_unit TEXT,
            lab_name TEXT,
            test_method TEXT,
            imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
          ) ON COMMIT DROP
        `);
        await client.query(`
          INSERT INTO product_tests (
            id,
            supplement_id,
            source_key,
            source_result_id,
            source_name,
            report_date,
            tested_product_name,
            tested_product_brand,
            match_method,
            contaminant_key,
            contaminant_name,
            result_operator,
            result_value,
            result_unit,
            result_basis,
            normalized_value,
            normalized_unit,
            normalized_basis,
            lab_name,
            test_method
          )
          SELECT
            'test-' || series,
            'brand:public-source',
            'example_report',
            'result-' || series,
            'Example Report',
            DATE '2026-06-01',
            'Public Source Product',
            'Example Nutrition',
            'manual_confirmed',
            'lead',
            'Lead',
            'eq',
            CASE WHEN series = 1 THEN 2 ELSE 0.5 END,
            'ppm',
            'product_mass',
            CASE WHEN series = 1 THEN 2 ELSE 0.5 END,
            'ppm',
            'product_mass',
            'Example Lab',
            'Example Method'
          FROM generate_series(1, 21) series
        `);
        await client.query(`
          INSERT INTO product_tests (
            id,
            supplement_id,
            source_key,
            source_result_id,
            source_name,
            tested_product_name,
            match_method,
            contaminant_key,
            contaminant_name,
            result_operator,
            result_value,
            result_unit,
            result_basis
          )
          VALUES (
            'sibling-only-test',
            'dsld:tested-alias',
            'example_report',
            'sibling-result',
            'Example Report',
            'Tested Alias Product',
            'manual_confirmed',
            'lead',
            'Lead',
            'eq',
            10,
            'ppm',
            'product_mass'
          )
        `);
        await client.query(`
          CREATE TEMP TABLE contaminant_thresholds (
            id TEXT PRIMARY KEY,
            contaminant_key TEXT NOT NULL,
            threshold_name TEXT NOT NULL,
            authority_name TEXT NOT NULL,
            threshold_url TEXT,
            threshold_value NUMERIC NOT NULL,
            threshold_unit TEXT NOT NULL,
            threshold_basis TEXT NOT NULL,
            normalized_value NUMERIC,
            normalized_unit TEXT,
            normalized_basis TEXT,
            concern_level_if_exceeded TEXT NOT NULL,
            active BOOLEAN NOT NULL
          ) ON COMMIT DROP
        `);
        await client.query(`
          INSERT INTO contaminant_thresholds (
            id,
            contaminant_key,
            threshold_name,
            authority_name,
            threshold_value,
            threshold_unit,
            threshold_basis,
            normalized_value,
            normalized_unit,
            normalized_basis,
            concern_level_if_exceeded,
            active
          )
          VALUES (
            'lead-screening',
            'lead',
            'Example screening threshold',
            'Example Authority',
            1,
            'ppm',
            'product_mass',
            1,
            'ppm',
            'product_mass',
            'medium',
            true
          )
        `);

        const queryClient = {
          async query<T>(text: string, values: unknown[]) {
            const result = await client.query(text, values);
            return { rows: result.rows as T[] };
          },
        };
        const publicQueries = createPublicSupplementsQueries(queryClient);
        const evidence = await publicQueries.getPublicSupplementEvidence({
          id: "brand:public-source",
        });

        expect(evidence).toMatchObject({
          total: 21,
          returned: 20,
          truncated: true,
        });
        expect(evidence.observations).toHaveLength(20);
        expect(evidence.observations.map((observation) => observation.id)).not.toContain(
          "sibling-only-test",
        );
        expect(evidence.observations[0]).toMatchObject({
          id: "test-1",
          labName: "Example Lab",
          testMethod: "Example Method",
          screening: {
            comparison: "exceeds",
          },
          alert: {
            concernLevel: "medium",
          },
        });
      } finally {
        await client.query("ROLLBACK");
        await client.end();
      }
    }, 20_000);
  },
);

describe.runIf(Boolean(testDatabaseUrl))(
  "supplement PostgreSQL legacy constraint rollout",
  () => {
    it("enforces new payloads before validating repaired legacy rows", async () => {
      const client = new pg.Client({
        connectionString: testDatabaseUrl ?? undefined,
        statement_timeout: 8_000,
      });

      await client.connect();
      await client.query("BEGIN");

      try {
        await client.query(`
          CREATE TEMP TABLE supplements (
            id TEXT PRIMARY KEY,
            canonical_key TEXT NOT NULL,
            data_origin TEXT NOT NULL,
            data_origin_id TEXT NOT NULL,
            data_origin_url TEXT,
            data_origin_priority SMALLINT NOT NULL DEFAULT 100,
            name TEXT NOT NULL,
            brand TEXT,
            upc TEXT,
            off_market BOOLEAN NOT NULL DEFAULT FALSE,
            search_text TEXT NOT NULL,
            label JSONB NOT NULL,
            serving_grams NUMERIC,
            imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (data_origin, data_origin_id)
          ) ON COMMIT DROP
        `);
        await client.query(`
          INSERT INTO supplements (
            id,
            canonical_key,
            data_origin,
            data_origin_id,
            name,
            search_text,
            label
          )
          VALUES (
            'legacy-oversized',
            'legacy-oversized',
            'brand_site',
            'legacy-oversized',
            'Legacy Oversized',
            repeat('x', 6001),
            '{}'::jsonb
          )
        `);

        const schemaSql = await readFile(
          new URL("../sql/supplements/schema.sql", import.meta.url),
          "utf8",
        );
        await client.query(schemaSql);

        await expect(client.query<{ convalidated: boolean }>(`
          SELECT convalidated
          FROM pg_constraint
          WHERE conrelid = 'supplements'::regclass
            AND conname = 'supplements_payload_format_check'
        `)).resolves.toMatchObject({ rows: [{ convalidated: false }] });

        await client.query("SAVEPOINT invalid_payload");
        await expect(client.query(`
          INSERT INTO supplements (
            id,
            canonical_key,
            data_origin,
            data_origin_id,
            name,
            search_text,
            label
          )
          VALUES (
            'new-invalid',
            'new-invalid',
            'brand_site',
            'new-invalid',
            'New Invalid',
            '',
            '{}'::jsonb
          )
        `)).rejects.toMatchObject({ code: "23514" });
        await client.query("ROLLBACK TO SAVEPOINT invalid_payload");

        await client.query(`
          UPDATE supplements
          SET search_text = 'Legacy Oversized repaired'
          WHERE id = 'legacy-oversized'
        `);
        await client.query(`
          ALTER TABLE supplements
          VALIDATE CONSTRAINT supplements_payload_format_check
        `);
        await client.query(schemaSql);

        await expect(client.query<{ convalidated: boolean }>(`
          SELECT convalidated
          FROM pg_constraint
          WHERE conrelid = 'supplements'::regclass
            AND conname = 'supplements_payload_format_check'
        `)).resolves.toMatchObject({ rows: [{ convalidated: true }] });
      } finally {
        await client.query("ROLLBACK");
        await client.end();
      }
    }, 20_000);
  },
);

function assertSearchCase(
  rows: SupplementSearchItem[],
  testCase: SearchCase,
): void {
  const ids = rows.map((row) => row.id);

  if (testCase.expectedEmpty) {
    expect(rows).toEqual([]);
  }

  if (testCase.expectedTopId) {
    expect(ids[0]).toBe(testCase.expectedTopId);
  }

  if (testCase.expectedTopBrand) {
    expect(rows[0]?.brand).toBe(testCase.expectedTopBrand);
  }

  for (const expectedId of testCase.expectedIds ?? []) {
    expect(ids).toContain(expectedId);
  }

  for (const excludedId of testCase.excludedIds ?? []) {
    expect(ids).not.toContain(excludedId);
  }

  const canonicalKeys = ids.map((id) => {
    const canonicalKey = canonicalKeyById.get(id);

    if (!canonicalKey) {
      throw new Error(`search returned unknown fixture id: ${id}`);
    }

    return canonicalKey;
  });

  expect(new Set(canonicalKeys).size).toBe(canonicalKeys.length);
}
