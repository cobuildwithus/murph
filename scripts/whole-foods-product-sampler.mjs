#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const WHOLE_FOODS_ORIGIN = "https://www.wholefoodsmarket.com";
const DATA_ORIGIN = "whole_foods_market";
const DATA_ORIGIN_PRIORITY = 40;
const SEARCH_TEXT_MAX_LENGTH = 6000;
const DEFAULT_LIMIT = 100;
const NUTRIENT_MAP = new Map([
  ["calories", { id: 1008, number: "208", name: "Energy", unit: "kcal" }],
  ["total fat", { id: 1004, number: "204", name: "Total lipid (fat)", unit: "g" }],
  ["saturated fat", { id: 1258, number: "606", name: "Fatty acids, total saturated", unit: "g" }],
  ["trans fat", { id: 1257, number: "605", name: "Fatty acids, total trans", unit: "g" }],
  ["cholesterol", { id: 1253, number: "601", name: "Cholesterol", unit: "mg" }],
  ["sodium", { id: 1093, number: "307", name: "Sodium, Na", unit: "mg" }],
  ["total carbohydrate", { id: 1005, number: "205", name: "Carbohydrate, by difference", unit: "g" }],
  ["dietary fiber", { id: 1079, number: "291", name: "Fiber, total dietary", unit: "g" }],
  ["total sugars", { id: 2000, number: "269", name: "Sugars, total including NLEA", unit: "g" }],
  ["sugars", { id: 2000, number: "269", name: "Sugars, total including NLEA", unit: "g" }],
  ["added sugars", { id: 1235, number: "539", name: "Sugars, added", unit: "g" }],
  ["protein", { id: 1003, number: "203", name: "Protein", unit: "g" }],
  ["vitamin d", { id: 1114, number: "328", name: "Vitamin D (D2 + D3)", unit: "mcg" }],
  ["calcium", { id: 1087, number: "301", name: "Calcium, Ca", unit: "mg" }],
  ["iron", { id: 1089, number: "303", name: "Iron, Fe", unit: "mg" }],
  ["potassium", { id: 1092, number: "306", name: "Potassium, K", unit: "mg" }],
  ["vitamin a", { id: 1104, number: "318", name: "Vitamin A, IU", unit: "IU" }],
  ["vitamin c", { id: 1162, number: "401", name: "Vitamin C, total ascorbic acid", unit: "mg" }],
]);
const DEFAULT_SEEDS = [
  "https://www.wholefoodsmarket.com/products/search/cereal",
  "https://www.wholefoodsmarket.com/products/search/yogurt",
  "https://www.wholefoodsmarket.com/products/search/crackers",
  "https://www.wholefoodsmarket.com/products/search/pasta",
  "https://www.wholefoodsmarket.com/products/search/ice%20cream",
  "https://www.wholefoodsmarket.com/products/search/bread",
  "https://www.wholefoodsmarket.com/products/search/cookies",
];

function usage() {
  return `Usage: node scripts/whole-foods-product-sampler.mjs [options]

Samples public Whole Foods product pages by fetching HTML directly, extracting
Next.js product JSON, and printing a coverage summary. No database writes.

Options:
  --limit <n>                Product pages to sample. Default: ${DEFAULT_LIMIT}
  --seed <url>               Discovery URL to scan for product links. Repeatable.
  --product-url <url>        Product URL to sample directly. Repeatable.
  --jsonl-out <path>         Write normalized successful products as JSONL.
  --prepared-csv-out <path>  Write rows shaped like apps/web/sql/foods prepared CSV.
  --sample-date <YYYY-MM-DD> Date for prepared CSV fdc_release_date. Default: today UTC.
  --context-dev-fallback     Use Context.dev HTML scrape fallback when direct fetch fails.
  --delay-ms <n>             Delay between product fetches. Default: 250.
  --timeout-ms <n>           Per-request timeout. Default: 15000.
  -h, --help                 Show this help.

Context.dev fallback env:
  CONTEXT_DEV_API_KEY        Required when --context-dev-fallback is used.
`;
}

export function compactText(value) {
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length > 0 ? compact : null;
}

function normalizeKeyText(value) {
  const compact = compactText(value);
  if (!compact) return null;
  const normalized = compact
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
  return normalized.length > 0 ? normalized : null;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function asStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
}

function normalizeProductUrl(value) {
  const compact = compactText(value);
  if (!compact) return null;

  let url;
  try {
    url = new URL(compact, WHOLE_FOODS_ORIGIN);
  } catch {
    return null;
  }

  if (!/(\.|^)wholefoodsmarket\.com$/u.test(url.hostname)) {
    return null;
  }

  if (!url.pathname.includes("/product/")) {
    return null;
  }

  url.protocol = "https:";
  url.hostname = "www.wholefoodsmarket.com";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function normalizeSeedUrl(value) {
  const compact = compactText(value);
  if (!compact) return null;

  let url;
  try {
    url = new URL(compact, WHOLE_FOODS_ORIGIN);
  } catch {
    return null;
  }

  if (!/(\.|^)wholefoodsmarket\.com$/u.test(url.hostname)) {
    return null;
  }

  if (!url.pathname.startsWith("/products/")) {
    return null;
  }

  url.protocol = "https:";
  url.hostname = "www.wholefoodsmarket.com";
  url.hash = "";
  return url.toString();
}

export function discoverProductUrlsFromHtml(html, baseUrl = WHOLE_FOODS_ORIGIN) {
  const urls = new Set();
  const hrefPattern = /\bhref=(["'])(.*?)\1/giu;
  let match;

  while ((match = hrefPattern.exec(html)) !== null) {
    const href = match[2];
    if (!href || !href.includes("/product/")) continue;
    let resolved;
    try {
      resolved = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    const normalized = normalizeProductUrl(resolved);
    if (normalized) urls.add(normalized);
  }

  return [...urls];
}

export function extractNextDataFromHtml(html) {
  const match = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>(.*?)<\/script>/isu);
  if (!match?.[1]) {
    return null;
  }

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function findAapiData(value, depth = 0) {
  if (depth > 8) return null;
  const record = asRecord(value);
  if (!record) return null;

  const direct = asRecord(record.aapiData);
  if (direct && typeof direct.asin === "string" && typeof direct.name === "string") {
    return direct;
  }

  for (const child of Object.values(record)) {
    const found = findAapiData(child, depth + 1);
    if (found) return found;
  }

  return null;
}

export function extractWholeFoodsProductFromHtml(html, sourceUrl = null) {
  const nextData = extractNextDataFromHtml(html);
  const aapiData = findAapiData(nextData);
  if (!aapiData) {
    return null;
  }
  return normalizeWholeFoodsProduct(aapiData, sourceUrl);
}

function normalizeNutritionFacts(value) {
  const facts = asRecord(value);
  if (!facts) return null;

  const normalized = {};
  for (const key of ["caloriesAmount", "servingsPerContainer", "servingSize"]) {
    const text = compactText(facts[key]);
    if (text) normalized[key] = text;
  }

  for (const key of ["macronutrients", "vitaminsAndMinerals"]) {
    const rows = Array.isArray(facts[key])
      ? facts[key]
          .map((row) => {
            const record = asRecord(row);
            if (!record) return null;
            const name = compactText(record.name);
            if (!name) return null;
            return {
              name,
              amount: compactText(record.amount),
              percent: compactText(record.percent),
              level: compactText(record.level),
            };
          })
          .filter(Boolean)
      : [];
    if (rows.length > 0) normalized[key] = rows;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function stripUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function parseNutritionNumber(value) {
  const text = compactText(value);
  if (!text) return null;
  const match = text.match(/([<>])?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/u);
  if (!match?.[2]) return null;
  const parsed = Number.parseFloat(match[2].replace(/,/gu, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePercentDailyValue(value) {
  const text = compactText(value);
  if (!text) return null;
  const match = text.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*%/u);
  if (!match?.[1]) return null;
  const parsed = Number.parseFloat(match[1].replace(/,/gu, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseAmount(value) {
  const text = compactText(value);
  if (!text) return null;
  const match = text.match(/^\s*([<>])?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*([a-zA-Zµ]+)\b/u);
  if (!match?.[2] || !match?.[3]) return null;
  const parsed = Number.parseFloat(match[2].replace(/,/gu, ""));
  if (!Number.isFinite(parsed)) return null;
  const unit = match[3].replace("µ", "u").toLowerCase() === "ug" ? "mcg" : match[3].replace("µ", "u");
  return {
    lessThan: match[1] === "<" ? true : undefined,
    value: parsed,
    unit: unit === "u" ? "mcg" : unit,
  };
}

function parseServingSizeGramWeight(value) {
  const text = compactText(value);
  if (!text) return null;

  const parenthetical = [...text.matchAll(/\(([^)]*)\)/gu)]
    .map((match) => parseGramAmount(match[1]))
    .find((parsed) => parsed != null);
  if (parenthetical != null) return parenthetical;

  return parseGramAmount(text);
}

function parseGramAmount(value) {
  const text = compactText(value);
  if (!text) return null;
  const match = text.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*g\b/iu);
  if (!match?.[1]) return null;
  const parsed = Number.parseFloat(match[1].replace(/,/gu, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeNutrientName(value) {
  return normalizeKeyText(value);
}

function roundNutrientValue(value) {
  return Number(value.toFixed(4));
}

function normalizeNutritionFactsForDb(nutritionFacts) {
  if (!nutritionFacts) return {};

  const servingSizeText = compactText(nutritionFacts.servingSize);
  const servingSizeGramWeight = parseServingSizeGramWeight(servingSizeText);
  const servingsPerContainer = parseNutritionNumber(nutritionFacts.servingsPerContainer);
  const calories = parseNutritionNumber(nutritionFacts.caloriesAmount);
  const nutrientsPerServing = [];

  if (calories != null) {
    const energy = NUTRIENT_MAP.get("calories");
    nutrientsPerServing.push({
      ...energy,
      value: calories,
      sourceName: "Calories",
    });
  }

  for (const row of [
    ...(nutritionFacts.macronutrients ?? []),
    ...(nutritionFacts.vitaminsAndMinerals ?? []),
  ]) {
    const sourceName = compactText(row.name);
    const amount = parseAmount(row.amount);
    if (!sourceName || !amount) continue;

    const mapped = NUTRIENT_MAP.get(normalizeNutrientName(sourceName));
    nutrientsPerServing.push(stripUndefined({
      id: mapped?.id,
      number: mapped?.number,
      name: mapped?.name ?? sourceName,
      value: amount.value,
      unit: mapped?.unit ?? amount.unit,
      sourceName,
      sourceAmount: compactText(row.amount),
      percentDailyValue: parsePercentDailyValue(row.percent),
      lessThan: amount.lessThan,
    }));
  }

  const nutrientsPer100g =
    servingSizeGramWeight != null
      ? nutrientsPerServing.map((nutrient) => stripUndefined({
          id: nutrient.id,
          number: nutrient.number,
          name: nutrient.name,
          value: roundNutrientValue((nutrient.value / servingSizeGramWeight) * 100),
          unit: nutrient.unit,
        }))
      : [];

  return {
    servingSize: servingSizeGramWeight,
    servingSizeUnit: servingSizeGramWeight != null ? "g" : undefined,
    householdServing: servingSizeText,
    servingsPerContainer,
    calories,
    nutrientsPerServing: nutrientsPerServing.length > 0 ? nutrientsPerServing : undefined,
    nutrientsPer100g: nutrientsPer100g.length > 0 ? nutrientsPer100g : undefined,
  };
}

function normalizeCategory(value) {
  const category = asRecord(value);
  if (!category) return null;

  const normalized = {
    productType: compactText(category.productType),
    displayName: compactText(category.displayName),
    glProductGroupSymbol: compactText(category.glProductGroupSymbol),
  };
  return Object.fromEntries(Object.entries(normalized).filter(([, item]) => item != null));
}

function buildCanonicalKey(brand, name, asin) {
  const brandKey = normalizeKeyText(brand);
  const nameKey = normalizeKeyText(name);
  if (brandKey || nameKey) {
    return [brandKey ?? "", nameKey ?? ""].join("|");
  }
  return `wfm:${asin.toLowerCase()}`;
}

function buildSearchText(product) {
  return [product.name, product.brand, product.asin]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, SEARCH_TEXT_MAX_LENGTH);
}

export function normalizeWholeFoodsProduct(aapiData, sourceUrl = null) {
  const asin = compactText(aapiData.asin);
  const name = compactText(aapiData.name);
  if (!asin || !name) return null;

  const brand = compactText(aapiData.brandName);
  const canonicalUrl = normalizeProductUrl(sourceUrl ?? aapiData.url) ?? sourceUrl ?? null;
  const ingredients = compactText(aapiData.ingredients);
  const nutritionFacts = normalizeNutritionFacts(aapiData.nutritionFacts);
  const normalizedNutritionFacts = normalizeNutritionFactsForDb(nutritionFacts);
  const category = normalizeCategory(aapiData.category);
  const dietTypes = asStringArray(aapiData.dietTypes);

  const label = {
    source: DATA_ORIGIN,
    asin,
    programType: compactText(aapiData.programType),
    category,
    ingredients,
    dietTypes,
    ...normalizedNutritionFacts,
    nutritionFacts,
    productImageCount: Array.isArray(aapiData.productImages) ? aapiData.productImages.length : undefined,
  };
  for (const key of Object.keys(label)) {
    const value = label[key];
    if (value == null || (Array.isArray(value) && value.length === 0) || (asRecord(value) && Object.keys(value).length === 0)) {
      delete label[key];
    }
  }

  const product = {
    id: `wfm:${asin.toLowerCase()}`,
    canonicalKey: buildCanonicalKey(brand, name, asin),
    dataOrigin: DATA_ORIGIN,
    dataOriginId: asin,
    dataOriginUrl: canonicalUrl,
    dataOriginPriority: DATA_ORIGIN_PRIORITY,
    name,
    brand,
    upc: null,
    offMarket: false,
    searchText: "",
    label,
    hasNutritionFacts: nutritionFacts != null,
    hasIngredients: ingredients != null,
  };
  product.searchText = buildSearchText(product);
  return product;
}

function csvEscape(value) {
  if (value == null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `"${text.replace(/"/gu, '""')}"`;
}

export function buildPreparedFoodCsvRow(product, sampleDate) {
  return [
    product.id,
    product.canonicalKey,
    product.dataOrigin,
    product.dataOriginId,
    product.dataOriginUrl,
    String(product.dataOriginPriority),
    product.name,
    product.brand,
    product.upc,
    product.offMarket ? "t" : "f",
    product.searchText,
    JSON.stringify(product.label),
    sampleDate,
  ].map(csvEscape).join(",");
}

export function preparedFoodCsvHeader() {
  return [
    "id",
    "canonical_key",
    "data_origin",
    "data_origin_id",
    "data_origin_url",
    "data_origin_priority",
    "name",
    "brand",
    "upc",
    "off_market",
    "search_text",
    "label",
    "fdc_release_date",
  ].map(csvEscape).join(",");
}

function parseArgs(argv) {
  const options = {
    limit: DEFAULT_LIMIT,
    seeds: [],
    productUrls: [],
    jsonlOut: null,
    preparedCsvOut: null,
    sampleDate: new Date().toISOString().slice(0, 10),
    contextDevFallback: false,
    delayMs: 250,
    timeoutMs: 15000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      return value;
    };

    switch (arg) {
      case "--limit":
        options.limit = parsePositiveInteger(next(), arg);
        break;
      case "--seed":
        {
          const seedUrl = normalizeSeedUrl(next());
          if (!seedUrl) {
            throw new Error("--seed must be a Whole Foods products URL");
          }
          options.seeds.push(seedUrl);
        }
        break;
      case "--product-url":
        options.productUrls.push(next());
        break;
      case "--jsonl-out":
        options.jsonlOut = next();
        break;
      case "--prepared-csv-out":
        options.preparedCsvOut = next();
        break;
      case "--sample-date":
        options.sampleDate = parseDate(next(), arg);
        break;
      case "--context-dev-fallback":
        options.contextDevFallback = true;
        break;
      case "--delay-ms":
        options.delayMs = parseNonNegativeInteger(next(), arg);
        break;
      case "--timeout-ms":
        options.timeoutMs = parsePositiveInteger(next(), arg);
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.seeds.length === 0 && options.productUrls.length === 0) {
    options.seeds = [...DEFAULT_SEEDS];
  }

  return options;
}

function parsePositiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function parseDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD`);
  }
  return value;
}

async function fetchText(url, { timeoutMs, headers = {} }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent": "Murph food label sampler; contact: engineering",
        ...headers,
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return {
      url: response.url,
      text: await response.text(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchContextDevHtml(url, options) {
  const apiKey = process.env.CONTEXT_DEV_API_KEY;
  if (!apiKey) {
    throw new Error("CONTEXT_DEV_API_KEY is required for Context.dev fallback");
  }
  const endpoint = `https://api.context.dev/v1/web/scrape/html?url=${encodeURIComponent(url)}`;
  const response = await fetchText(endpoint, {
    ...options,
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json,text/html,*/*",
    },
  });

  const content = response.text.trim();
  if (content.startsWith("{")) {
    const parsed = JSON.parse(content);
    const html = parsed.html ?? parsed.data?.html ?? parsed.content ?? parsed.data?.content;
    if (typeof html === "string") {
      return { url, text: html };
    }
  }
  return { url, text: response.text };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function discoverFromSeeds(seeds, options) {
  const discovered = [];
  const seen = new Set();
  const seedResults = [];

  for (const seed of seeds) {
    try {
      const response = await fetchText(seed, options);
      const urls = discoverProductUrlsFromHtml(response.text, response.url);
      for (const url of urls) {
        if (!seen.has(url)) {
          seen.add(url);
          discovered.push(url);
        }
      }
      seedResults.push({ seed, ok: true, productUrls: urls.length });
    } catch (error) {
      seedResults.push({ seed, ok: false, error: error.message });
    }
  }

  return { discovered, seedResults };
}

export async function fetchProductHtml(url, options) {
  try {
    const direct = await fetchText(url, options);
    if (extractWholeFoodsProductFromHtml(direct.text, direct.url)) {
      return { ...direct, method: "direct" };
    }
    if (!options.contextDevFallback) {
      return { ...direct, method: "direct" };
    }
  } catch (error) {
    if (!options.contextDevFallback) {
      throw error;
    }
  }

  const fallback = await fetchContextDevHtml(url, options);
  return { ...fallback, method: "context_dev" };
}

async function runSampler(options) {
  const directProductUrls = options.productUrls.map(normalizeProductUrl).filter(Boolean);
  const discovery = await discoverFromSeeds(options.seeds, options);
  const queue = [...new Set([...directProductUrls, ...discovery.discovered])].slice(0, options.limit);

  const successes = [];
  const failures = [];
  const methods = {};

  for (const [index, productUrl] of queue.entries()) {
    if (index > 0 && options.delayMs > 0) {
      await sleep(options.delayMs);
    }
    try {
      const response = await fetchProductHtml(productUrl, options);
      methods[response.method] = (methods[response.method] ?? 0) + 1;
      const product = extractWholeFoodsProductFromHtml(response.text, response.url);
      if (!product) {
        failures.push({ url: productUrl, reason: "missing_product_json", method: response.method });
        continue;
      }
      successes.push(product);
    } catch (error) {
      failures.push({ url: productUrl, reason: error.message });
    }
  }

  const nutritionCount = successes.filter((product) => product.hasNutritionFacts).length;
  const ingredientCount = successes.filter((product) => product.hasIngredients).length;
  const summary = {
    seeds: options.seeds,
    seedResults: discovery.seedResults,
    discoveredProductUrls: discovery.discovered.length,
    requestedLimit: options.limit,
    sampledProductUrls: queue.length,
    parsedProducts: successes.length,
    failedProducts: failures.length,
    withNutritionFacts: nutritionCount,
    withIngredients: ingredientCount,
    directFetches: methods.direct ?? 0,
    contextDevFetches: methods.context_dev ?? 0,
    nutritionCoverage: successes.length > 0 ? Number((nutritionCount / successes.length).toFixed(3)) : 0,
    ingredientCoverage: successes.length > 0 ? Number((ingredientCount / successes.length).toFixed(3)) : 0,
    failures: failures.slice(0, 20),
  };

  if (options.jsonlOut) {
    await writeTextFile(options.jsonlOut, successes.map((product) => JSON.stringify(product)).join("\n") + (successes.length ? "\n" : ""));
  }

  if (options.preparedCsvOut) {
    const lines = [preparedFoodCsvHeader(), ...successes.map((product) => buildPreparedFoodCsvRow(product, options.sampleDate))];
    await writeTextFile(options.preparedCsvOut, lines.join("\n") + "\n");
  }

  return { summary, products: successes };
}

async function writeTextFile(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exitCode = 64;
    return;
  }

  if (options.help) {
    console.log(usage());
    return;
  }

  try {
    const result = await runSampler(options);
    console.log(JSON.stringify(result.summary, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
