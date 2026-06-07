#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildSearchText,
  getDbUrl,
  runPsql,
} from "./supplement-db-brand-site-labels.mjs";

const DEFAULT_BATCH_SIZE = 400;
const DEFAULT_OUTPUT_DIR = "/tmp/murph-supplement-audit";
const MAX_PARSED_ROWS = 150;

function parseArgs(argv) {
  const options = {
    batchSize: DEFAULT_BATCH_SIZE,
    limit: null,
    outputDir: DEFAULT_OUTPUT_DIR,
    onlyOversized: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--batch-size") {
      const value = Number.parseInt(argv[index + 1] ?? "", 10);
      if (!Number.isInteger(value) || value < 1 || value > 2000) {
        throw new Error("--batch-size requires an integer from 1 to 2000");
      }
      options.batchSize = value;
      index += 1;
    } else if (arg === "--limit") {
      const value = Number.parseInt(argv[index + 1] ?? "", 10);
      if (!Number.isInteger(value) || value < 1) throw new Error("--limit requires a positive integer");
      options.limit = value;
      index += 1;
    } else if (arg === "--output-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error("--output-dir requires a value");
      options.outputDir = value;
      index += 1;
    } else if (arg === "--only-oversized") {
      options.onlyOversized = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node .agents/skills/research-supplements/scripts/supplement-db-brand-site-repair-preview.mjs [options]

Build a read-only repair preview for brand_site supplement rows.

Options:
  --batch-size <n>       Rows per DB read batch. Default: ${DEFAULT_BATCH_SIZE}.
  --limit <n>            Preview at most n rows.
  --only-oversized       Preview only rows with search_text length >= 18000.
  --output-dir <dir>     Artifact directory. Default: ${DEFAULT_OUTPUT_DIR}.

This command never writes to the database.
`);
}

function sqlString(value) {
  return String(value).replaceAll("'", "''");
}

function readRows(dbUrl, options, offset) {
  const where = options.onlyOversized
    ? "data_origin = 'brand_site' and length(coalesce(search_text, '')) >= 18000"
    : "data_origin = 'brand_site'";
  const remainingLimit = options.limit === null ? options.batchSize : Math.min(options.batchSize, options.limit - offset);
  if (remainingLimit <= 0) return [];

  const sql = `
select coalesce(jsonb_agg(to_jsonb(rows)), '[]'::jsonb)::text as rows
from (
  select
    id,
    data_origin_id as "dataOriginId",
    data_origin_url as "dataOriginUrl",
    name,
    brand,
    upc,
    off_market as "offMarket",
    search_text as "searchText",
    label
  from supplements
  where ${where}
  order by id
  limit ${remainingLimit}
  offset ${offset}
) rows;
`;
  return JSON.parse(extractSingleColumn(runPsql(dbUrl, sql)));
}

function extractSingleColumn(psqlOutput) {
  const lines = psqlOutput.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const payload = lines.find((line) => line.startsWith("[") || line.startsWith("{"));
  if (!payload) throw new Error("Expected a JSON payload from psql.");
  return payload;
}

function sourceFromOriginId(dataOriginId) {
  const [source] = String(dataOriginId).split(":", 1);
  return source || "brand-site";
}

function sourceIdFromOriginId(dataOriginId) {
  return String(dataOriginId).includes(":") ? String(dataOriginId).slice(String(dataOriginId).indexOf(":") + 1) : String(dataOriginId);
}

function hasArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function repairPreviewForRow(row) {
  const label = row.label && typeof row.label === "object" && !Array.isArray(row.label) ? row.label : {};
  const parsedServingSizes = hasArray(label.servingSizes) ? [] : extractServingSizes(label);
  const parsedIngredientRows = hasArray(label.ingredientRows) ? [] : extractIngredientRows(label);
  const proposedLabel = {
    ...label,
    ...(parsedServingSizes.length > 0 ? { servingSizes: parsedServingSizes } : {}),
    ...(parsedIngredientRows.length > 0 ? { ingredientRows: parsedIngredientRows } : {}),
  };
  const source = label.source || sourceFromOriginId(row.dataOriginId);
  const sourceId = label.sourceId || sourceIdFromOriginId(row.dataOriginId);
  const proposedSearchText = buildSearchText({
    source,
    sourceId,
    dataOrigin: "brand_site",
    dataOriginId: row.dataOriginId,
    name: row.name,
    brand: row.brand,
    upc: row.upc,
    dataOriginUrl: row.dataOriginUrl,
    label: proposedLabel,
  });
  const removableFieldCandidates = findRemovableFieldCandidates(label, {
    hasParsedIngredientRows: parsedIngredientRows.length > 0 || hasArray(label.ingredientRows),
    hasParsedServingSizes: parsedServingSizes.length > 0 || hasArray(label.servingSizes),
  });

  return {
    id: row.id,
    dataOriginId: row.dataOriginId,
    name: row.name,
    brand: row.brand,
    oldSearchTextLength: String(row.searchText ?? "").length,
    proposedSearchTextLength: proposedSearchText.length,
    searchTextWouldChange: proposedSearchText !== row.searchText,
    existingIngredientRows: Array.isArray(label.ingredientRows) ? label.ingredientRows.length : 0,
    parsedIngredientRows: parsedIngredientRows.length,
    existingServingSizes: Array.isArray(label.servingSizes) ? label.servingSizes.length : 0,
    parsedServingSizes: parsedServingSizes.length,
    parserStatus: parserStatus(label, parsedIngredientRows, parsedServingSizes),
    removableFieldCandidates,
    dataOriginUrl: row.dataOriginUrl,
    proposedSearchTextPreview: proposedSearchText.slice(0, 500),
  };
}

function parserStatus(label, ingredientRows, servingSizes) {
  const hasExistingRows = hasArray(label.ingredientRows);
  const hasExistingServing = hasArray(label.servingSizes);
  const parsedRowsAreCompleteEnough = hasHighConfidenceParsedIngredientRows(label, ingredientRows);
  if ((hasExistingRows || parsedRowsAreCompleteEnough) && (hasExistingServing || servingSizes.length > 0)) {
    return "structured_ready";
  }
  if (hasExistingRows || ingredientRows.length > 0 || servingSizes.length > 0) return "partial_parse";
  return "needs_better_parser";
}

function hasHighConfidenceParsedIngredientRows(label, rows) {
  if (rows.length === 0) return false;
  if (hasPageBodyContamination(label)) return false;
  if (rows.some((row) => !isUsefulIngredientRow(row))) return false;

  const amountPatternRows = rows.filter((row) => row.source === "factsText_amount_pattern");
  if (amountPatternRows.length === 0) return true;
  return false;
}

function countPotentialAmountMentions(label) {
  let count = 0;
  const pattern = /\b(?:<\s*)?\d[\d,./]*(?:\.\d+)?(?:\s*\([^)]+\))?\s*(?:mcg\s+RAE|mcg\s+DFE|billion\s+CFU|million\s+CFU|CFU|IU|mg|mcg|g|ml|kcal|calories?)\b/giu;
  for (const text of labelTexts(label)) {
    count += [...text.matchAll(pattern)].length;
    if (count > 2) return count;
  }
  return count;
}

function maxFactsPanelLength(label) {
  return Math.max(0, ...labelTexts(label).map((text) => factsPanelText(text).length));
}

function hasPageBodyContamination(label) {
  return labelTexts(label).some((text) => {
    const lowered = text.toLowerCase();
    if (factsPanelText(text).length <= 1200) return false;
    return [
      "add to cart",
      "buy now",
      "notify me when available",
      "view full details",
      "copy link",
      "shopify-section",
      "reviews filter",
      "quantity: decrease",
      "faq previous next",
      "home all products",
    ].some((marker) => lowered.includes(marker));
  });
}

function findRemovableFieldCandidates(label, state) {
  const candidates = [];
  if (typeof label.bodyText === "string" && label.bodyText.trim().length > 0) {
    candidates.push("bodyText");
  }
  if (typeof label.rawPageText === "string" && label.rawPageText.trim().length > 0) {
    candidates.push("rawPageText");
  }
  if (state.hasParsedIngredientRows && state.hasParsedServingSizes && hasArray(label.allProductFactsText)) {
    candidates.push("allProductFactsText");
  }
  return candidates;
}

function extractServingSizes(label) {
  const servingSizes = [];
  for (const text of labelTexts(label)) {
    const pattern = /\bServing Size\s*:?\s*([^|;\n]+?)(?=\s+Servings?\s+Per\s+Container|\s+Amount\s+Per\s+Serving|\s+Calories\b|\s+%?\s*Daily\s+Value\b|$)/giu;
    for (const match of text.matchAll(pattern)) {
      const value = cleanValue(match[1]);
      if (value && value.length <= 120) servingSizes.push(value);
    }
  }
  return uniqueStrings(servingSizes).map((text) => ({ text, source: "factsText" })).slice(0, 8);
}

function extractIngredientRows(label) {
  const structuredRows = extractIngredientRowsFromStructured(label);
  if (structuredRows.length > 0) return structuredRows.slice(0, MAX_PARSED_ROWS);

  const rows = [];
  for (const text of labelTexts(label)) {
    rows.push(...extractIngredientRowsFromText(text));
    if (rows.length >= MAX_PARSED_ROWS) break;
  }
  return dedupeIngredientRows(rows.filter(isUsefulIngredientRow)).slice(0, MAX_PARSED_ROWS);
}

function extractIngredientRowsFromStructured(label) {
  const rows = [];
  for (const value of [label.ingredients, label.activeIngredients]) {
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      const row = ingredientRowFromValue(entry, "structured_label_field");
      if (row) rows.push(row);
    }
  }
  return dedupeIngredientRows(rows.filter(isUsefulIngredientRow));
}

function ingredientRowFromValue(value, source) {
  if (typeof value === "string") {
    return ingredientRowFromTextSegment(value, source);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const name = cleanValue(value.name ?? value.ingredient ?? value.nutrient ?? value.title);
  if (!name) return null;
  const amount = cleanValue(value.amount ?? value.quantity ?? value.value);
  const unit = cleanValue(value.unit);
  const dailyValue = cleanValue(value.dailyValue ?? value.dv ?? value.percentDailyValue);
  return {
    name,
    ...(amount ? { amount } : {}),
    ...(unit ? { unit } : {}),
    ...(dailyValue ? { dailyValue } : {}),
    source,
  };
}

function labelTexts(label) {
  return [
    label.factsText,
    label.nutritionFactsText,
    label.activeIngredientText,
  ].flatMap(textValues).map(cleanText).filter(Boolean);
}

function textValues(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(textValues);
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(textValues);
}

function extractIngredientRowsFromText(input) {
  const factsText = factsPanelText(input);
  if (!factsText) return [];
  const rows = [];
  const lineCandidates = factsText
    .replace(/\s+\|\s+/gu, " | ")
    .split(/\n| {2,}|(?<=%)\s+(?=[A-Z][A-Za-z(])|(?<=\*\*)\s+(?=[A-Z][A-Za-z(])/u)
    .map(cleanValue)
    .filter(Boolean);

  for (const line of lineCandidates) {
    const row = ingredientRowFromTextSegment(line, "factsText");
    if (row) rows.push(row);
  }

  if (rows.length < 2) {
    rows.push(...ingredientRowsByAmountPattern(factsText));
  }

  return dedupeIngredientRows(rows);
}

function factsPanelText(input) {
  const cleaned = cleanText(input);
  const factsIndex = cleaned.search(/\b(Supplement|Nutrition)\s+Facts\b/iu);
  let text = factsIndex >= 0 ? cleaned.slice(factsIndex) : cleaned;
  const startIndex = text.search(/\b(Amount\s+Per\s+Serving|%?\s*Daily\s+Value)\b/iu);
  if (startIndex >= 0) text = text.slice(startIndex);
  const endIndex = text.search(/\b(Other Ingredients?|Directions?|Suggested Use|Warning|Caution|Contains:)\b/iu);
  if (endIndex > 20) text = text.slice(0, endIndex);
  return text;
}

function ingredientRowFromTextSegment(segment, source) {
  const text = cleanValue(segment)
    .replace(/^(Amount\s+Per\s+Serving|%?\s*Daily\s+Value)\s*/iu, "")
    .replace(/^Supplement Facts\s*/iu, "");
  if (!text || isHeaderText(text)) return null;

  const pipeParts = text.split("|").map(cleanValue).filter(Boolean);
  if (pipeParts.length >= 2) {
    const [namePart, amountPart, dailyValuePart] = pipeParts;
    const amount = parseAmount(amountPart);
    const name = cleanIngredientName(namePart);
    if (name && amount) {
      return {
        name,
        amount: amount.amount,
        unit: amount.unit,
        ...(dailyValuePart ? { dailyValue: cleanDailyValue(dailyValuePart) } : {}),
        source,
      };
    }
  }

  const amountMatch = text.match(/^(.+?)\s+((?:<\s*)?\d[\d,./]*(?:\.\d+)?(?:\s*\([^)]+\))?)\s*(mcg\s+RAE|mcg\s+DFE|billion\s+CFU|million\s+CFU|CFU|IU|mg|mcg|g|ml|kcal|calories?)\b(?:\s+(\d{1,5}%|\*\*|†|‡))?$/iu);
  if (!amountMatch) return null;
  const name = cleanIngredientName(amountMatch[1]);
  if (!name) return null;
  return {
    name,
    amount: cleanValue(amountMatch[2]),
    unit: cleanValue(amountMatch[3]),
    ...(amountMatch[4] ? { dailyValue: cleanDailyValue(amountMatch[4]) } : {}),
    source,
  };
}

function ingredientRowsByAmountPattern(text) {
  const rows = [];
  const normalized = factsPanelText(text).replaceAll("|", " ");
  const pattern = /([A-Z][A-Za-z0-9,()\-+.'’/&\s]{2,}?)\s+((?:<\s*)?\d[\d,./]*(?:\.\d+)?(?:\s*\([^)]+\))?)\s*(mcg\s+RAE|mcg\s+DFE|billion\s+CFU|million\s+CFU|CFU|IU|mg|mcg|g|ml|kcal|calories?)\b(?:\s+(\d{1,5}%|\*\*|†|‡))?/giu;
  for (const match of normalized.matchAll(pattern)) {
    const name = cleanIngredientName(match[1]);
    if (!name) continue;
    rows.push({
      name,
      amount: cleanValue(match[2]),
      unit: cleanValue(match[3]),
      ...(match[4] ? { dailyValue: cleanDailyValue(match[4]) } : {}),
      source: "factsText_amount_pattern",
    });
  }
  return rows;
}

function isUsefulIngredientRow(row) {
  if (!row || typeof row !== "object") return false;
  const name = cleanIngredientName(row.name);
  const amount = cleanValue(row.amount);
  const unit = cleanValue(row.unit);
  if (!name || !amount || !unit) return false;
  if (isKnownNonIngredientName(name)) return false;
  if (/\b(percent daily values?|daily values? are based|amount per serving|servings? per container|serving size|supplement facts|nutrition facts)\b/iu.test(name)) {
    return false;
  }
  if (/\b(not established|based on a|from fat|years of age|children|adults|other ingredients?)\b/iu.test(name)) return false;
  if (/\b(add to cart|buy now|notify me|view full details|copy link|shopify|reviews?|quantity|faq|shipping)\b/iu.test(name)) {
    return false;
  }
  if (/\b(provides|deliver|offers|designed|taking|supports?)\b/iu.test(name) && name.length > 40) return false;
  if (/\b(natural and artificial flavor|artificial flavor|citric acid|malic acid|tartaric acid|sucralose|silicon dioxide|red 40|blue 2)\b/iu.test(name)) {
    return false;
  }
  if (/\b(daily serving value|per serving\s*\/\s*per|tells you how much a nutrient|less than)\b/iu.test(name)) return false;
  if (/^(?:mg|mcg|g|iu|cfu|ml|kcal|calories?)\b/iu.test(name)) return false;
  if (/\b(?:mg|mcg|g|iu|cfu|ml)\s+\d/u.test(name)) return false;
  if (/\b(calories|total fat|saturated fat|cholesterol|total carbohydrate|total sugars|added sugars|protein)\b/iu.test(name)
    && /\b(total fat|cholesterol|total carbohydrate|total sugars|added sugars|vitamin|minerals?|amount per serving|years of age|children|adults)\b/iu.test(name)) {
    return false;
  }
  if (/^(includes|from fat|dv|%dv|amount|blend|each|calories|mg|mcg|g|iu|cfu)$/iu.test(name)) return false;
  if (/^(dv|%dv|each|per serving|daily serving value)\b/iu.test(name)) return false;
  if (/^percent daily values? are based/iu.test(name)) return false;
  return true;
}

function parseAmount(value) {
  const match = cleanValue(value).match(/^((?:<\s*)?\d[\d,./]*(?:\.\d+)?(?:\s*\([^)]+\))?)\s*(mcg\s+RAE|mcg\s+DFE|billion\s+CFU|million\s+CFU|CFU|IU|mg|mcg|g|ml|kcal|calories?)\b/iu);
  if (!match) return null;
  return { amount: cleanValue(match[1]), unit: cleanValue(match[2]) };
}

function isHeaderText(text) {
  return /\b(Serving Size|Servings Per Container|Amount Per Serving|Daily Value|Calories|Total Fat|Total Carbohydrate)\b/iu.test(text)
    && !/\b\d[\d,.]*\s*(mcg|mg|g|IU|CFU|ml)\b/iu.test(text);
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/&nbsp;/giu, " ")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&amp;/giu, "&")
    .replace(/\r/gu, "\n")
    .replace(/[ \t]+/gu, " ")
    .trim();
}

function cleanValue(value) {
  return cleanText(value)
    .replace(/^[:;,\-\s]+/u, "")
    .replace(/[:;,\-\s]+$/u, "")
    .trim();
}

function cleanIngredientName(value) {
  const name = cleanValue(value)
    .replace(/\b(Amount Per Serving|Daily Value|Supplement Facts|Nutrition Facts)\b/giu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (name.length < 2 || name.length > 180) return null;
  if (isKnownNonIngredientName(name)) return null;
  return name;
}

function isKnownNonIngredientName(name) {
  return /^(serving size|servings per container|amount per serving|daily value|% daily value|supplement facts|nutrition facts|amount)$/iu.test(name);
}

function cleanDailyValue(value) {
  return cleanValue(value).slice(0, 80);
}

function uniqueStrings(values) {
  return [...new Set(values.map(cleanValue).filter(Boolean))];
}

function dedupeIngredientRows(rows) {
  const seen = new Set();
  const deduped = [];
  for (const row of rows) {
    const key = `${row.name}|${row.amount ?? ""}|${row.unit ?? ""}|${row.dailyValue ?? ""}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function summarize(previews) {
  const summary = {
    rowsReviewed: previews.length,
    searchTextWouldChange: previews.filter((row) => row.searchTextWouldChange).length,
    oldOversizedSearchTextRows: previews.filter((row) => row.oldSearchTextLength >= 18000).length,
    proposedOversizedSearchTextRows: previews.filter((row) => row.proposedSearchTextLength >= 18000).length,
    addIngredientRows: previews.filter((row) => row.parsedIngredientRows > 0).length,
    addServingSizes: previews.filter((row) => row.parsedServingSizes > 0).length,
    structuredReady: previews.filter((row) => row.parserStatus === "structured_ready").length,
    partialParse: previews.filter((row) => row.parserStatus === "partial_parse").length,
    needsBetterParser: previews.filter((row) => row.parserStatus === "needs_better_parser").length,
    removableFieldCandidateRows: previews.filter((row) => row.removableFieldCandidates.length > 0).length,
  };
  const byBrand = new Map();
  for (const row of previews) {
    const brandSlug = sourceFromOriginId(row.dataOriginId);
    const current = byBrand.get(brandSlug) ?? { rows: 0, structuredReady: 0, needsBetterParser: 0 };
    current.rows += 1;
    if (row.parserStatus === "structured_ready") current.structuredReady += 1;
    if (row.parserStatus === "needs_better_parser") current.needsBetterParser += 1;
    byBrand.set(brandSlug, current);
  }
  summary.byBrand = Object.fromEntries([...byBrand.entries()].sort((a, b) => b[1].rows - a[1].rows || a[0].localeCompare(b[0])));
  return summary;
}

function csvEscape(value) {
  const stringValue = Array.isArray(value) ? value.join(";") : String(value ?? "");
  return /[",\n\r]/u.test(stringValue) ? `"${stringValue.replaceAll("\"", "\"\"")}"` : stringValue;
}

function writeArtifacts(outputDir, previews, summary) {
  mkdirSync(outputDir, { recursive: true });
  const jsonPath = join(outputDir, "brand_site_repair_preview.json");
  const summaryPath = join(outputDir, "brand_site_repair_preview_summary.json");
  const csvPath = join(outputDir, "brand_site_repair_preview.csv");
  writeFileSync(jsonPath, `${JSON.stringify(previews, null, 2)}\n`);
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  const headers = [
    "parserStatus",
    "id",
    "dataOriginId",
    "name",
    "brand",
    "oldSearchTextLength",
    "proposedSearchTextLength",
    "searchTextWouldChange",
    "existingIngredientRows",
    "parsedIngredientRows",
    "existingServingSizes",
    "parsedServingSizes",
    "removableFieldCandidates",
    "dataOriginUrl",
    "proposedSearchTextPreview",
  ];
  writeFileSync(csvPath, `${headers.join(",")}\n${previews.map((row) => headers.map((header) => csvEscape(row[header])).join(",")).join("\n")}\n`);
  return { jsonPath, summaryPath, csvPath };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dbUrl = getDbUrl();
  const previews = [];
  for (let offset = 0; options.limit === null || offset < options.limit; offset += options.batchSize) {
    const rows = readRows(dbUrl, options, offset);
    if (rows.length === 0) break;
    previews.push(...rows.map(repairPreviewForRow));
    if (rows.length < options.batchSize) break;
  }
  const summary = summarize(previews);
  const artifacts = writeArtifacts(options.outputDir, previews, summary);
  console.log(JSON.stringify({ ...summary, artifacts }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export {
  extractIngredientRows,
  extractIngredientRowsFromText,
  extractServingSizes,
  repairPreviewForRow,
};
