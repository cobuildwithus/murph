#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildSearchText,
  getDbUrl,
  normalizeItem,
  runPsql,
} from "./supplement-db-brand-site-labels.mjs";

const DEFAULT_BATCH_SIZE = 400;
const DEFAULT_OUTPUT_DIR = "/tmp/murph-supplement-audit";
const MAX_READ_ATTEMPTS = 4;
const MAX_PARSED_ROWS = 150;
const AMOUNT_VALUE_PATTERN = String.raw`(?<![\d,./])(?:<\s*)?\d(?:[\d,./]*)(?:\.\d+)?(?:\s*x\s*10\^?\d+)?(?:\s*\([^)]+\))?`;
const UNIT_PATTERN = String.raw`mcg\s+RAE|mcg\s+DFE|(?:µ|μ)g\s+RAE|(?:µ|μ)g\s+DFE|mg\s+NE|billion\s+CFUs?|million\s+CFUs?|CFUs?|IU|mcgt|mgt|mlt|mca|mg|mcg|(?:µ|μ)g|gt|g(?!\.[A-Za-z])|ml|kcal|calories?`;
const AMOUNT_WITH_UNIT_PATTERN = String.raw`${AMOUNT_VALUE_PATTERN}\s*(?:${UNIT_PATTERN})`;
const SERVING_AMOUNT_PATTERN = String.raw`(?:about\s*)?(?:\d+(?:[.,]\d+)?(?:\s*-\s*\d+(?:[.,]\d+)?)?|\d+\s*/\s*\d+|one|two|three|four|five|six|seven|eight|nine|ten|un|una|dos|tres|quatre)`;
const SERVING_FORM_PATTERN = String.raw`(?:(?:quick\s+release|vegetarian|vegan|veggie|vegetable|coated|chewable|rounded|level|heaping|heaped|liquid|effervescent|oil\s*-?\s*infused|biodegradable)\s+)*(?:g(?![A-Za-z])|grams?|mg|mcg|mL|ml|milliliters?|fl\.?\s*oz\.?|fluid\s+ounces?|oz|tsp|teaspoons?|tbsp|tablespoons?|scoops?|capsules?(?:\(s\))?|tabletten?|tablety|(?!tablet[tky])tablets?(?:\(s\))?|caplets?|soft\s*-?\s*gels?|softgels?|gumm(?:y|ies)(?:\(ies\))?|chews?|chewables?|wafers?|lozenges?|packets?|stick\s+packs?|sticks?|VegCaps?|servings?|drops?(?:\(s\))?|gouttes?|gotas?|pumps?|bars?|sachets?|vials?|latas?|l[aá]hev|s[aá]č(?:ek|ky|ků)?|shots?|shota|cps|tbl|porcje?|porcj[ęea]?|kapsu[lł]ki|kapsu[lł]ka|kapsle|kapsl[iíe]|kapseln?|tabletk[ęeai]?|miark[ęea]?(?:\s+proszku)?|cacitos?|comprimidos?|comprim[eé]s?|g[eé]lules?|capsulas?|c[aá]psulas?|perlas?|pipettes?|cuill[eè]res?|כמוס(?:ה|ות)|טבלי(?:ה|ות)|קפסול(?:ה|ות))`;
const PROMINENT_FACTS_ROW_NAMES = [
  "Vitamin A",
  "Vitamin C",
  "Vitamin D",
  "Vitamin D3",
  "Vitamin E",
  "Vitamin K",
  "Thiamin",
  "Thiamine",
  "Riboflavin",
  "Niacin",
  "Vitamin B6",
  "Folate",
  "Vitamin B12",
  "Biotin",
  "Pantothenic Acid",
  "Choline",
  "Calcium",
  "Iron",
  "Iodine",
  "Magnesium",
  "Zinc",
  "Selenium",
  "Copper",
  "Manganese",
  "Chromium",
  "Molybdenum",
  "Sodium",
  "Potassium",
  "Total Carbohydrate",
  "Total Carbohydrates",
  "Dietary Fiber",
  "Protein",
];
const REPAIR_SOURCE_BRAND_OVERRIDES = new Map([
  ["bird-and-be", "Bird&Be"],
  ["lemme", "Lemme"],
  ["new-chapter", "New Chapter"],
  ["swolverine", "Swolverine"],
]);

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
Writes local preview artifacts including compact search-text proposals,
automated-backfill readiness, and prioritized official refetch/OCR queues.

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
  return JSON.parse(extractSingleColumn(runPsqlWithRetry(dbUrl, sql, offset)));
}

function runPsqlWithRetry(dbUrl, sql, offset) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_READ_ATTEMPTS; attempt += 1) {
    try {
      return runPsql(dbUrl, sql);
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_READ_ATTEMPTS || !isTransientPsqlReadError(error)) break;
      console.error(`Transient supplement DB read failure at offset ${offset}; retrying ${attempt}/${MAX_READ_ATTEMPTS - 1}.`);
      sleepSync(250 * attempt);
    }
  }
  throw lastError;
}

function isTransientPsqlReadError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /SSL SYSCALL error|EOF detected|server closed the connection unexpectedly|connection .* failed|timeout expired/iu.test(message);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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

function repairBrandForSource(source, fallbackBrand) {
  return REPAIR_SOURCE_BRAND_OVERRIDES.get(cleanValue(source)) ?? fallbackBrand;
}

function hasArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function repairPreviewForRow(row) {
  const label = row.label && typeof row.label === "object" && !Array.isArray(row.label) ? row.label : {};
  const existingIngredientRows = existingIngredientRowsState(label);
  const existingServingSizes = existingServingSizesState(label);
  const parserState = {
    existingIngredientRows,
    existingServingSizes,
    parsedRowsAreCompleteEnough: false,
  };
  const shouldParseIngredientRows = !hasArray(label.ingredientRows) || existingIngredientRows.invalidRows.length > 0;
  const shouldParseServingSizes = !hasArray(label.servingSizes) || existingServingSizes.invalidServingSizes.length > 0;
  const parsedIngredientRows = shouldParseIngredientRows ? extractIngredientRows(label) : [];
  parserState.parsedRowsAreCompleteEnough = hasHighConfidenceParsedIngredientRows(label, parsedIngredientRows);
  const servingSizeIngredientRows = parsedIngredientRows.length > 0 ? parsedIngredientRows : existingIngredientRows.validRows;
  const extractedServingSizes = shouldParseServingSizes ? extractServingSizes(label, {
    productName: row.name,
    ingredientRows: servingSizeIngredientRows,
  }) : [];
  const existingServingSizeReplacements = existingServingSizes.invalidServingSizes.length > 0
    ? existingServingSizes.validServingSizes.map(normalizedServingSizeRow).filter(Boolean)
    : [];
  const parsedServingSizes = extractedServingSizes.length > 0 ? extractedServingSizes : existingServingSizeReplacements;
  const proposedLabel = {
    ...label,
    ...(parsedServingSizes.length > 0 ? { servingSizes: parsedServingSizes } : {}),
    ...(parsedIngredientRows.length > 0 ? { ingredientRows: parsedIngredientRows } : {}),
  };
  const source = label.source || sourceFromOriginId(row.dataOriginId);
  const sourceId = label.sourceId || sourceIdFromOriginId(row.dataOriginId);
  const brand = repairBrandForSource(source, row.brand);
  const proposedSearchText = buildSearchText({
    source,
    sourceId,
    dataOrigin: "brand_site",
    dataOriginId: row.dataOriginId,
    name: row.name,
    brand,
    upc: row.upc,
    dataOriginUrl: row.dataOriginUrl,
    label: proposedLabel,
  });
  const parserBlockers = parserBlockersForRow(row, label, parsedIngredientRows, parsedServingSizes, parserState);
  const currentParserStatus = parserStatus(parsedIngredientRows, parsedServingSizes, parserState);
  const automatedBackfillReady = currentParserStatus === "structured_ready" && parserBlockers.length === 0;
  const removableFieldCandidates = findRemovableFieldCandidates(label, {
    allowRawEvidenceRemoval: automatedBackfillReady,
  });
  const productionCandidate = automatedBackfillReady
    ? normalizeItem({
      id: row.dataOriginId,
      dataOrigin: "brand_site",
      dataOriginId: row.dataOriginId,
      dataOriginUrl: row.dataOriginUrl,
      source,
      sourceId,
      name: row.name,
      brand,
      upc: row.upc,
      offMarket: row.offMarket,
      label: removeLabelFields(proposedLabel, removableFieldCandidates),
    })
    : null;
  const parsedIngredientRowSources = uniqueStrings(parsedIngredientRows.map((ingredientRow) => ingredientRow.source));
  const evidenceRecoveryHint = evidenceRecoveryHintForRow(label, {
    parserStatus: currentParserStatus,
    parserBlockers,
    parsedIngredientRows: parsedIngredientRows.length,
    parsedServingSizes: parsedServingSizes.length,
  });

  return {
    id: row.id,
    dataOriginId: row.dataOriginId,
    name: row.name,
    brand,
    oldSearchTextLength: String(row.searchText ?? "").length,
    proposedSearchTextLength: proposedSearchText.length,
    searchTextWouldChange: proposedSearchText !== row.searchText,
    existingIngredientRows: Array.isArray(label.ingredientRows) ? label.ingredientRows.length : 0,
    parsedIngredientRows: parsedIngredientRows.length,
    existingServingSizes: Array.isArray(label.servingSizes) ? label.servingSizes.length : 0,
    parsedServingSizes: parsedServingSizes.length,
    parsedServingSizesPreview: parsedServingSizes.slice(0, 10),
    parserStatus: currentParserStatus,
    parserBlockers,
    automatedBackfillReady,
    evidenceRecoveryHint,
    parsedIngredientRowSources,
    removableFieldCandidates,
    dataOriginUrl: row.dataOriginUrl,
    productionCandidate,
    proposedSearchTextPreview: proposedSearchText.slice(0, 500),
  };
}

function evidenceRecoveryHintForRow(label, state) {
  if (state.parserStatus === "structured_ready" && state.parserBlockers.length === 0) return "structured_ready";
  if (state.parserBlockers.includes("likely_food_or_non_supplement")) return "not_standalone_supplement_review";
  if (state.parserBlockers.includes("page_body_contamination") || state.parserBlockers.includes("facts_panel_too_long")) {
    return "official_refetch_page_body";
  }
  if (state.parserStatus === "needs_better_parser") return "official_refetch_or_ocr";
  if (state.parserBlockers.includes("fallback_amount_pattern_rows")) return "manual_review_fallback_rows";
  if (state.parserBlockers.includes("missing_ingredient_rows") && state.parsedServingSizes > 0) {
    return countPotentialAmountMentions(label) > 1 ? "parser_or_manual_review" : "official_refetch_or_ocr";
  }
  if (state.parserBlockers.includes("missing_serving_sizes") && state.parsedIngredientRows > 0) {
    return "parser_serving_size_review";
  }
  return "parser_or_manual_review";
}

function parserStatus(ingredientRows, servingSizes, state) {
  const { existingIngredientRows, existingServingSizes, parsedRowsAreCompleteEnough } = state;
  const hasExistingRows = existingIngredientRows.validRows.length > 0 && existingIngredientRows.invalidRows.length === 0;
  const hasExistingServing = existingServingSizes.validServingSizes.length > 0;
  if ((hasExistingRows || parsedRowsAreCompleteEnough) && (hasExistingServing || servingSizes.length > 0)) {
    return "structured_ready";
  }
  if (existingIngredientRows.validRows.length > 0 || ingredientRows.length > 0 || existingServingSizes.validServingSizes.length > 0 || servingSizes.length > 0) {
    return "partial_parse";
  }
  return "needs_better_parser";
}

function parserBlockersForRow(row, label, ingredientRows, servingSizes, state) {
  const blockers = [];
  const { existingIngredientRows, existingServingSizes, parsedRowsAreCompleteEnough } = state;
  if (existingIngredientRows.invalidRows.length > 0 && !parsedRowsAreCompleteEnough) {
    blockers.push("invalid_existing_ingredient_rows");
  }
  if (existingServingSizes.invalidServingSizes.length > 0 && existingServingSizes.validServingSizes.length === 0 && servingSizes.length === 0) {
    blockers.push("invalid_existing_serving_sizes");
  }
  if (existingIngredientRows.validRows.length === 0 && ingredientRows.length === 0) blockers.push("missing_ingredient_rows");
  if (existingServingSizes.validServingSizes.length === 0 && servingSizes.length === 0) blockers.push("missing_serving_sizes");
  if (hasPageBodyContamination(label)) blockers.push("page_body_contamination");
  if (hasOversizedRetainedEvidence(label)) blockers.push("oversized_retained_evidence");
  if (hasStackedTableContinuationRisk(label) && !hasStrongParsedTableRows(ingredientRows, servingSizes)) {
    blockers.push("stacked_table_continuation_risk");
  }
  if (maxFactsPanelLength(label) > 6000) blockers.push("facts_panel_too_long");
  if (hasLikelyMissingProminentFactsRows(label, ingredientRows)) blockers.push("likely_missing_facts_rows");
  if (hasMissingProminentFactsRows(label, ingredientRows)) blockers.push("missing_prominent_facts_rows");
  if (ingredientRows.some((row) => !isUsefulIngredientRow(row))) blockers.push("invalid_parsed_ingredient_row");
  if (isLikelyFoodOrNonSupplementRow(row, label)) blockers.push("likely_food_or_non_supplement");
  if (ingredientRows.some((row) => row.source === "factsText_amount_pattern")) blockers.push("fallback_amount_pattern_rows");
  return uniqueStrings(blockers);
}

function isLikelyFoodOrNonSupplementRow(row, label) {
  const haystack = [
    row.id,
    row.dataOriginId,
    row.dataOriginUrl,
    row.name,
    label.productType,
    label.productKind,
    label.classification,
    label.itemType,
    Array.isArray(label.tags) ? label.tags.join(" ") : label.tags,
  ].filter(Boolean).join(" ").toLowerCase();
  return /\b(?:oil\s+spray|flavou?r\s+drops?|chunky\s+flavou?r|seed\s+mix|cacao\s+powder|cocoa\s+powder|breakfast\s+(?:mix|cereal|porridge)|(?:protein\s+)?oatmeal(?:\s+\d|\s*[-–]\s*\d|\s*$)|muesli|granola)\b/u.test(haystack);
}

function existingIngredientRowsState(label) {
  if (!Array.isArray(label.ingredientRows)) return { validRows: [], invalidRows: [] };
  const validRows = [];
  const invalidRows = [];
  for (const row of label.ingredientRows) {
    if (isUsefulIngredientRow(row)) {
      validRows.push(row);
    } else {
      invalidRows.push(row);
    }
  }
  return { validRows, invalidRows };
}

function existingServingSizesState(label) {
  if (!Array.isArray(label.servingSizes)) return { validServingSizes: [], invalidServingSizes: [] };
  const validServingSizes = [];
  const invalidServingSizes = [];
  for (const servingSize of label.servingSizes) {
    if (isUsefulServingSize(servingSize)) {
      validServingSizes.push(servingSize);
    } else {
      invalidServingSizes.push(servingSize);
    }
  }
  return { validServingSizes, invalidServingSizes };
}

function hasHighConfidenceParsedIngredientRows(label, rows) {
  if (rows.length === 0) return false;
  if (hasPageBodyContamination(label)) return false;
  if (hasStackedTableContinuationRisk(label) && !hasStrongParsedTableRows(rows)) return false;
  if (maxFactsPanelLength(label) > 6000) return false;
  if (rows.some((row) => !isUsefulIngredientRow(row))) return false;

  const amountPatternRows = rows.filter((row) => row.source === "factsText_amount_pattern");
  if (amountPatternRows.length === 0) return true;
  return false;
}

function hasStrongParsedTableRows(rows, servingSizes = []) {
  return rows.length >= 2
    && rows.every((row) => row.source !== "factsText_amount_pattern" && isUsefulIngredientRow(row))
    && (servingSizes.length === 0 || servingSizes.every((servingSize) => cleanValue(servingSize?.text).length > 0));
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

function hasPageBodyContamination(label) {
  return labelTexts(label).some((text) => {
    const factsPanel = factsPanelText(text);
    const lowered = factsPanel.toLowerCase();
    if (factsPanel.length <= 1200) return false;
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

function maxFactsPanelLength(label) {
  return Math.max(0, ...labelTexts(label).map((text) => factsPanelText(text).length));
}

function hasOversizedRetainedEvidence(label) {
  return [
    label.factsText,
    label.factsTextEvidence,
    label.ingredientText,
    label.ingredients,
    label.otherIngredients,
  ].flatMap(textValues).some((text) => cleanText(text).length > 6000);
}

function hasLikelyMissingProminentFactsRows(label, ingredientRows) {
  if (label.source !== "official_facts_image_ocr_preview" && label.evidenceStatus !== "structured_facts_from_official_facts_image_ocr") {
    return false;
  }
  if (!Array.isArray(ingredientRows) || ingredientRows.length === 0) return false;
  if (ingredientRows.length > 2) return false;
  let amountMentions = 0;
  for (const text of labelTexts(label)) {
    const factsText = factsPanelText(text, { preserveLeadingTableRows: true });
    for (const _match of factsText.matchAll(new RegExp(AMOUNT_WITH_UNIT_PATTERN, "giu"))) {
      amountMentions += 1;
      if (amountMentions >= 12) return true;
    }
  }
  return false;
}

function hasMissingProminentFactsRows(label, ingredientRows) {
  if (!Array.isArray(ingredientRows) || ingredientRows.length === 0) return false;
  const parsedNames = new Set(ingredientRows.map((row) => baseIngredientName(row.name)).filter(Boolean));
  for (const text of labelTexts(label)) {
    const expectedNames = prominentFactsRowNamesFromText(text);
    if (expectedNames.length < 5) continue;
    if (expectedNames.some((name) => !parsedNames.has(name.toLowerCase()))) return true;
  }
  return false;
}

function prominentFactsRowNamesFromText(text) {
  const names = [];
  const rowNamePattern = prominentFactsRowNamePattern();
  const matches = [...factsPanelText(text, { preserveLeadingTableRows: true }).matchAll(rowNamePattern)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const name = cleanValue(match[1]);
    const segmentEnd = matches[index + 1]?.index ?? undefined;
    const segment = cleanValue(factsPanelText(text, { preserveLeadingTableRows: true }).slice(match.index, segmentEnd));
    if (!new RegExp(String.raw`\b(?:${AMOUNT_VALUE_PATTERN})(?:\s*${UNIT_PATTERN}|\s*\([^)]*\b${UNIT_PATTERN}\b[^)]*\))`, "iu").test(segment)) continue;
    names.push(name.replace(/s$/u, ""));
  }
  return uniqueStrings(names);
}

function hasStackedTableContinuationRisk(label) {
  return labelTexts(label).some((text) => {
    const lines = factsPanelText(text)
      .split(/\n+/u)
      .map(cleanValue)
      .filter(Boolean);
    for (let index = 0; index < lines.length - 1; index += 1) {
      const line = lines[index];
      if (isHeaderText(line) || isFootnoteText(line) || isDailyValueText(line) || parseStandaloneAmount(line)) continue;
      if (!parseStandaloneAmount(lines[index + 1])) continue;
      if (/^\(/u.test(line) && hasPreviousStackedNameLine(lines, index)) continue;
      if (/^(?:as\b|from\b|fruiting\s+body\b|extract\b|\()/iu.test(line)) return true;
      if (/^[a-z]/u.test(line) && hasPreviousStackedNameLine(lines, index)) continue;
      if (/^[a-z]/u.test(line) && !isAllowedLowercaseIngredientName(line)) return true;
      if (new RegExp(String.raw`\b${AMOUNT_WITH_UNIT_PATTERN}\b`, "iu").test(line)) return true;
    }
    return false;
  });
}

function hasPreviousStackedNameLine(lines, index) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const line = cleanValue(lines[cursor]);
    if (!line) continue;
    if (isHeaderText(line) || isFootnoteText(line) || isDailyValueText(line)) continue;
    if (parseStandaloneAmount(line)) return false;
    return Boolean(cleanIngredientName(line));
  }
  return false;
}

function findRemovableFieldCandidates(label, state) {
  const candidates = [];
  if (!state.allowRawEvidenceRemoval) return candidates;
  if (typeof label.bodyText === "string" && label.bodyText.trim().length > 0) {
    candidates.push("bodyText");
  }
  if (typeof label.rawPageText === "string" && label.rawPageText.trim().length > 0) {
    candidates.push("rawPageText");
  }
  if (hasArray(label.allProductFactsText)) {
    candidates.push("allProductFactsText");
  }
  if (hasContaminatedIngredientText(label)) {
    candidates.push("ingredientText");
  }
  return candidates;
}

function removeLabelFields(label, fields) {
  const output = { ...label };
  for (const field of fields) delete output[field];
  return output;
}

function hasContaminatedIngredientText(label) {
  const values = textValues(label.ingredientText ?? label.ingredients).map(cleanText).filter(Boolean);
  if (values.length === 0) return false;
  return values.some((text) => {
    if (/\b(other ingredients?|inactive ingredients?)\s*:/iu.test(text)) return false;
    if (/^\s*ingredients\s+supplement facts\b/iu.test(text)) return true;
    return text.length > 600
      && /\b(?:faq|reviews?|notify me|add to cart|buy now|why choose|benefits?|product gallery)\b/iu.test(text);
  });
}

function extractServingSizes(label, context = {}) {
  const servingSizes = [];
  for (const servingSize of extractStructuredServingSizes(label)) addServingSizeCandidate(servingSizes, servingSize);
  for (const value of textValues(label.servingSize)) {
    addServingSizeCandidate(servingSizes, value);
  }
  for (const text of labelTexts(label)) {
    const ageQualifiedServingPattern = new RegExp(String.raw`\bServings?\s+Size\s*(?:\([^)]{1,80}\))?\s*(?:\d+\+?\s+years?\s+)?(${SERVING_AMOUNT_PATTERN}\s*${SERVING_FORM_PATTERN}(?:\s*\([^)]{1,70}\))?)`, "giu");
    for (const match of text.matchAll(ageQualifiedServingPattern)) {
      addServingSizeCandidate(servingSizes, match[1]);
    }
    const boundedServingPattern = new RegExp(String.raw`\bServings?\s+Size\s*:?\s*(${SERVING_AMOUNT_PATTERN}\s*${SERVING_FORM_PATTERN}(?:\s*\([^)]{1,70}\))?)`, "giu");
    for (const match of text.matchAll(boundedServingPattern)) {
      addServingSizeCandidate(servingSizes, match[1]);
    }
    const pattern = /\bServings?\s+Size\s*:?\s*([^|;\n]+?)(?=\s+Servings?\s*(?:Per\s+Container)?\s*:|\s+Servings?\s+Per\s+Container|\s+Amount\s+Per\s+Serving|\s+Calories\b|\s+%?\s*Daily\s+Value\b|$)/giu;
    for (const match of text.matchAll(pattern)) {
      addServingSizeCandidate(servingSizes, match[1]);
    }
    const chineseServingPattern = /每一份量\s*([^/\n]+)/giu;
    for (const match of text.matchAll(chineseServingPattern)) {
      addServingSizeCandidate(servingSizes, match[1]);
    }
    const amountPerCountPattern = /\bAmount\s+per\s+((?!(?:Serving|Capsule|Tablet|Softgel|VegCap|Scoop|Gummy|Gummies|Chew|Chewable|Lozenge)\b)(?:\d|one|two|three|four|five|six|seven|eight|nine|ten)\b[^|;\n]+?)(?=\s+%?\s*Daily\s+Value\b|\s+%DV\b)/giu;
    for (const match of text.matchAll(amountPerCountPattern)) {
      addServingSizeCandidate(servingSizes, match[1]);
    }
    const amountPerFormPattern = /\bAmount\s+Per\s+(Capsule|Tablet|Softgel|VegCap|Scoop|Gummy|Gummies|Chew|Chewable|Lozenge)\b/giu;
    for (const match of text.matchAll(amountPerFormPattern)) {
      addServingSizeCandidate(servingSizes, `1 ${match[1]}`);
    }
    if (hasUsageDoseMarker(text) && !isFactsPanelWithAmountRows(text)) {
      for (const servingSize of servingSizesFromUsageText(text)) {
        addServingSizeCandidate(servingSizes, servingSize);
      }
    }
  }
  for (const text of usageTexts(label)) {
    for (const servingSize of servingSizesFromUsageText(text)) {
      addServingSizeCandidate(servingSizes, servingSize);
    }
  }
  for (const servingSize of inferServingSizesFromProductName(context.productName, context.ingredientRows)) {
    addServingSizeCandidate(servingSizes, servingSize);
  }
  return uniqueStrings(servingSizes).map((text) => ({ text, source: "factsText" })).slice(0, 8);
}

function isFactsPanelWithAmountRows(text) {
  const factsText = factsPanelText(text, { preserveLeadingTableRows: true });
  return /\b(?:Supplement|Nutrition)\s+Facts\b/iu.test(factsText)
    && /\bAmount\s+Per\b|\bAmount\s+per\s+serving\b|\b%?\s*Daily\s+Value\b|\b%DV\b/iu.test(factsText);
}

function addServingSizeCandidate(servingSizes, value) {
  const text = normalizedServingSizeText(value);
  if (!text) return;
  servingSizes.push(text);
}

function normalizedServingSizeRow(value) {
  const text = normalizedServingSizeText(value);
  if (!text) return null;
  return {
    text,
    source: typeof value === "object" && value?.source ? cleanValue(value.source) : "existing_serving_size",
  };
}

function normalizedServingSizeText(value) {
  if (!isUsefulServingSize(value)) return "";
  return cleanServingSize(servingSizeRawText(value));
}

function extractStructuredServingSizes(label) {
  const servingSizes = [];
  const preparedLists = label.rawTargetNutritionFacts?.value_prepared_list;
  if (Array.isArray(preparedLists)) {
    for (const preparedList of preparedLists) {
      const description = cleanValue(preparedList?.description);
      if (/^(?:Amount\s+)?Per\s+Serving$/iu.test(description)) {
        servingSizes.push("1 serving");
      }
    }
  }
  for (const dose of textValues(label.dose ?? label.dosage ?? label.servingDose)) {
    servingSizes.push(...servingSizesFromUsageText(dose));
  }
  return servingSizes;
}

function usageTexts(label) {
  return [
    label.dosageText,
    label.servingDirectionsText,
    label.servingRecommendationText,
    label.directions,
    label.directionsText,
    label.suggestedUse,
    label.recommendedUse,
    label.recommendedUsage,
    label.usage,
    label.usageText,
    label.usageInstructions,
    label.instructions,
  ].flatMap(textValues).map(cleanText).filter(Boolean);
}

function servingSizesFromUsageText(input) {
  const text = cleanText(input);
  if (!text) return [];
  const servingSizes = [];
  const pattern = new RegExp(String.raw`(?:^|[.;,:\s(])(${SERVING_AMOUNT_PATTERN}\s*${SERVING_FORM_PATTERN}(?:\s*\([^)]{1,70}\))?)`, "giu");
  const polishPortionPattern = new RegExp(String.raw`\b(?:Porcj[ęea]|Dawk[ęea])\s*\(\s*(${SERVING_AMOUNT_PATTERN}\s*${SERVING_FORM_PATTERN})(?:\s*[-–]\s*[^)]{1,60})?\)`, "giu");
  for (const windowText of usageDoseWindows(text)) {
    const normalized = windowText
      .replace(/\b(?:Recommended\s+Usage\s+Level|Serving\/directions|Serving\s+dose|Serving\/dose|Dosage|Suggested\s+Use)\s*(?:\([^)]*\))?\s*[:：-]?\s*/giu, " ")
      .replace(/\b(?:Take|Use|Consume|Mix|Dissolve|Dilute|Tomar|Prendre|Prenez|Consommer|Nehmen|Verzehren|Täglich|Taeglich|Przyjmowa[cć]|Stosowa[cć]|Stosowa[cć]\s+raz\s+dziennie)\s+/giu, " ");
    for (const segment of normalized.split(/\n|[.;](?=\s|$)/u).map(cleanValue).filter(Boolean)) {
      if (hasUsageTextExclusion(segment)) continue;
      let hasExplicitPortion = false;
      for (const match of segment.matchAll(polishPortionPattern)) {
        servingSizes.push(match[1]);
        hasExplicitPortion = true;
      }
      if (hasExplicitPortion) continue;
      for (const match of segment.matchAll(/((?:כמוס(?:ה|ות)|טבלי(?:ה|ות)|קפסול(?:ה|ות))\s+אחת)/gu)) {
        servingSizes.push(match[1]);
      }
      const germanDescribedDosePattern = /\b(\d+(?:[.,]\d+)?)\s+(?:[\p{L}\d+®™.-]+\s+){1,5}(kapseln?|tabletten?)\b/giu;
      for (const match of segment.matchAll(germanDescribedDosePattern)) {
        servingSizes.push(`${match[1]} ${match[2]}`);
      }
      for (const match of segment.matchAll(pattern)) {
        if (shouldSkipUsageServingMatch(segment, match)) continue;
        servingSizes.push(match[1]);
      }
    }
  }
  return servingSizes;
}

function shouldSkipUsageServingMatch(segment, match) {
  const value = cleanValue(match[1]);
  const prefix = cleanValue(segment.slice(Math.max(0, match.index - 18), match.index));
  if (/^(?:\d+(?:[.,]\d+)?)\s*(?:mg|mcg)$/iu.test(value)) return true;
  if (/^(?:\d+(?:[.,]\d+)?)\s*(?:mL|ml|milliliters?|fl\.?\s*oz\.?|fluid\s+ounces?|oz)$/iu.test(value)
    && /\b(?:with|in|into|of|water|w|z|do|po|dans|de|con)\s*$/iu.test(prefix)) {
    return true;
  }
  return false;
}

function usageDoseWindows(text) {
  const windows = [];
  const markerPattern = /\b(?:Recommended\s+Usage\s+Level|Serving\/directions|Serving\s+dose|Serving\/dose|Dosage|Directions?|Suggested\s+Use|Verzehrempfehlung|Einnahmeempfehlung|STOSOWANIE|Stosowa[cć])\b/giu;
  const matches = [...text.matchAll(markerPattern)];
  if (matches.length === 0) return [text];
  for (const match of matches) {
    const start = match.index ?? 0;
    const rest = text.slice(start);
    const boundaryMatch = rest.slice(match[0].length).search(/\b(?:Package|Net\s+(?:Wt|Weight|Contents)|Medicinal\s+ingredients?|Nutritional\s+Information|Nutrition\s+Facts|Supplement\s+Facts|Ingredients?|Storage|Caution|Warning|Manufactured\s+By|FOR\s+MFR)\b|(?:שם הרכיב|ערכים תזונתיים|רכיבים נוספים|חומרי עזר)/iu);
    windows.push(boundaryMatch >= 0 ? rest.slice(0, match[0].length + boundaryMatch) : rest);
  }
  return windows;
}

function hasUsageDoseMarker(value) {
  return /\b(?:Recommended\s+Usage\s+Level|Serving\/directions|Serving\s+dose|Serving\/dose|Dosage|Suggested\s+Use\s*:\s*(?:Take|Use|Consume|Mix|Dissolve|Dilute|Prendre|Tomar)|Directions?\s*:\s*(?:Take|Use|Consume|Mix|Dissolve|Dilute)|Verzehrempfehlung|Einnahmeempfehlung|STOSOWANIE|Stosowa[cć])\b/iu.test(value);
}

function hasUsageTextExclusion(value) {
  return /\b(?:store|storage|keep out of reach|warning|caution|not to exceed|do not exceed|manufactured by|batch no|lic\.?\s*no|net\s+contents?|contents?|inhalt|à consommer dans les|conserver|aufbewahren)\b/iu.test(cleanValue(value));
}

function inferServingSizesFromProductName(productName, ingredientRows) {
  if (!productName || !Array.isArray(ingredientRows) || ingredientRows.length !== 1) return [];
  const row = ingredientRows[0];
  if (!isUsefulIngredientRow(row) || row.source === "factsText_amount_pattern") return [];
  const match = cleanValue(productName).match(/\b(\d+(?:\.\d+)?)\s*(mg|mcg|g|IU)\b.{0,60}\bPer\s+(Tablet|Caplet|Capsule|Softgel|Gummy|Drop|Wafer)\b/iu);
  if (!match) return [];
  if (cleanValue(match[1]) !== cleanValue(row.amount) || cleanValue(match[2]).toLowerCase() !== cleanValue(row.unit).toLowerCase()) {
    return [];
  }
  return [`1 ${match[3]}`];
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
  for (const value of [label.ingredients, label.activeIngredients, label.facts, label.factsRows]) {
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      const row = ingredientRowFromValue(entry, "structured_label_field");
      if (row) rows.push(row);
    }
  }
  const targetPreparedLists = label.rawTargetNutritionFacts?.value_prepared_list;
  if (Array.isArray(targetPreparedLists)) {
    for (const preparedList of targetPreparedLists) {
      if (!Array.isArray(preparedList?.nutrients)) continue;
      for (const nutrient of preparedList.nutrients) {
        const row = ingredientRowFromValue({
          name: nutrient.name,
          amount: nutrient.quantity,
          unit: nutrient.unit_of_measurement,
          dailyValue: nutrient.percentage ? `${nutrient.percentage}%` : "",
        }, "structured_label_field");
        if (row) rows.push(row);
      }
    }
  }
  return dedupeIngredientRows(rows.filter(isUsefulIngredientRow));
}

function ingredientRowFromValue(value, source) {
  if (typeof value === "string") {
    return ingredientRowFromTextSegment(value, source);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const baseName = cleanValue(value.name ?? value.ingredient ?? value.nutrient ?? value.title);
  const parentheses = cleanValue(value.parentheses);
  const name = parentheses ? `${baseName} (${parentheses})` : baseName;
  if (!name) return null;
  let amount = cleanValue(value.amount ?? value.quantity ?? value.value);
  let unit = cleanValue(value.unit);
  if (amount && !unit) {
    const parsedAmount = parseAmount(amount);
    if (parsedAmount) {
      amount = parsedAmount.amount;
      unit = parsedAmount.unit;
    }
  }
  const dailyValue = cleanValue(value.dailyValue ?? value.dv ?? value.percentDailyValue ?? value.dailyValuePercentage);
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
    label.servingText,
    label.activeIngredientText,
  ].flatMap(textValues).map(cleanText).filter(Boolean);
}

function textValues(value) {
  if (typeof value === "string") return parsedJsonTextValues(value);
  if (Array.isArray(value)) return value.flatMap(textValues);
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(textValues);
}

function parsedJsonTextValues(value) {
  const text = String(value);
  const trimmed = text.trim();
  if (!/^(?:\[|\{)/u.test(trimmed)) return [text];
  try {
    const parsed = JSON.parse(trimmed);
    const values = textValues(parsed);
    return values.length > 0 ? values : [text];
  } catch {
    return [text];
  }
}

function extractIngredientRowsFromText(input) {
  const parsedInputs = parsedJsonTextValues(input);
  if (parsedInputs.length !== 1 || parsedInputs[0] !== input) {
    return dedupeIngredientRows(parsedInputs.flatMap(extractIngredientRowsFromText).filter(isUsefulIngredientRow));
  }
  const factsText = factsPanelText(input);
  if (!factsText) return [];
  const rows = [];
  rows.push(...ingredientRowsByChineseFacts(input));
  rows.push(...ingredientRowsByColonDelimited(factsText));
  rows.push(...ingredientRowsByPipeDelimitedTable(input));
  rows.push(...ingredientRowsByTransposedTable(input));
  rows.push(...ingredientRowsByLeadingAmountTable(input));
  rows.push(...ingredientRowsByEachServingProvides(input));
  rows.push(...ingredientRowsByNameAmountBlockTable(input));
  rows.push(...ingredientRowsByInlineNameAmountBlock(input));
  rows.push(...ingredientRowsByProminentInlineFacts(input));
  rows.push(...ingredientRowsByMultiDailyValueLines(input));
  rows.push(...ingredientRowsBySupplementFactsLines(input));

  const lineCandidates = factsText
    .replace(/\s+\+\s+Contains\b[^\n]*/giu, "")
    .replace(/\s+\|\s+/gu, " | ")
    .replace(/[•·]/gu, "\n")
    .replace(new RegExp(String.raw`(${AMOUNT_WITH_UNIT_PATTERN})(?:\s*[†‡*+])?,\s+`, "giu"), "$1\n")
    .replace(/(\d[\d,]{0,6}%\*?|<\s*\d[\d,]{0,6}%\*?|[†‡*+])(?:\s*(?:Daily Value|DV)(?:\s*\([^)]*\))?\s+not\s+established\.?)?[."'“”]*\s+["'“”]?(?=[A-Z][A-Za-z0-9('"’®-])/giu, "$1\n")
    .replace(new RegExp(String.raw`(${AMOUNT_WITH_UNIT_PATTERN})\s*[."'“”]*\s+["'“”]?(?=(?:Daily\s+Value|DV)\b)`, "giu"), "$1\n")
    .replace(/\b((?:<\s*)?\d[\d,./]*(?:\.\d+)?(?:\s*\([^)]+\))?\s*(?:mcg\s+RAE|mcg\s+DFE|billion\s+CFU|million\s+CFU|CFU|IU|mg|mcg|g|ml|kcal|calories?))\s+(?=\b(?:alpha|beta|gamma)\b)/giu, "$1\n")
    .replace(new RegExp(String.raw`(${AMOUNT_WITH_UNIT_PATTERN}(?:\s+(?:NE|RAE|DFE))?)\s+(?!(?:NE|RAE|DFE)\b)(?=[A-Z][A-Za-z(])`, "giu"), "$1\n")
    .split(/\n| {2,}|(?<=%)\s+(?=[A-Z][A-Za-z(])|(?<=\*\*)\s+(?=[A-Z][A-Za-z(])/u)
    .map(cleanValue)
    .filter(Boolean);

  for (const line of lineCandidates) {
    const row = ingredientRowFromTextSegment(line, "factsText");
    if (row) rows.push(row);
  }

  rows.push(...ingredientRowsByAmountBeforeNameTable(factsText));
  rows.push(...ingredientRowsByStackedTable(input));

  if (rows.length === 0) {
    rows.push(...ingredientRowsByAmountPattern(factsText));
  }

  return dedupeIngredientRows(removeSourceComponentRows(rows.filter(isUsefulIngredientRow)));
}

function factsPanelText(input, options = {}) {
  const cleaned = cleanText(input);
  const factsIndex = cleaned.search(/\b(Supplement|Nutrition)\s+Facts\b/iu);
  let text = factsIndex >= 0 ? cleaned.slice(factsIndex) : cleaned;
  const startIndex = text.search(/(?:\bAmount\s+Per\s+%?\s*Daily\s+Serving\s+Value\b|\bAmount\s*(?:Per\s+\w+|\/\s*Serving)\b|%DV\b|%?\s*Daily\s+Value\b)/iu);
  if (startIndex >= 0 && !options.preserveLeadingTableRows) text = text.slice(startIndex);
  const endIndex = text.search(/\b(Other Ingredients?|Directions?|Suggested Use|Warning|Caution)\b/iu);
  if (endIndex > 20) text = text.slice(0, endIndex);
  return text;
}

function ingredientRowFromTextSegment(segment, source) {
  const text = cleanValue(stripServingPrefixFromIngredientName(cleanValue(segment))
    .replace(/\s+\+\s+Contains\b.*$/iu, "")
    .replace(/\s+([†‡+*])\s+\1(?=\s+(?:Daily Value|DV)\b)/giu, " $1")
    .replace(/^(?:Amount\s+Per\s+)?%?\s*Daily\s+Serving\s+Value\*?\s*/iu, "")
    .replace(/^(?:(?:Amount\s+Per\s+Serving|%?\s*Daily\s+Value|%?\s*DV)[."'“”\s]*)+/iu, "")
    .replace(/^(?:%?\s*DV|%?\s*Daily\s+Value)\s*,\s*/iu, "")
    .replace(/^Supplement Facts\s*/iu, ""));
  if (!text || isHeaderText(text)) return null;

  const parentheticalUnitAmountRow = ingredientRowFromParentheticalUnitAmountTextSegment(text, source);
  if (parentheticalUnitAmountRow) return parentheticalUnitAmountRow;

  const sourceParentheticalRow = ingredientRowFromSourceParentheticalTextSegment(text, source);
  if (sourceParentheticalRow) return sourceParentheticalRow;

  const tabularRow = ingredientRowFromMultiDailyValueTextSegment(text, source);
  if (tabularRow) return tabularRow;

  const pipeParts = text.split("|").map(cleanValue).filter(Boolean);
  if (pipeParts.length >= 2) {
    const [namePart, amountPart, dailyValuePart] = pipeParts;
    const amount = parseAmount(amountPart);
    const name = cleanIngredientName(stripServingPrefixFromIngredientName(namePart));
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

  const amountMatch = text.match(new RegExp(String.raw`^(.+?)\s+(${AMOUNT_VALUE_PATTERN})\s*(${UNIT_PATTERN})\b(?:\s+(?:NE|RAE|DFE))?(?:\s*\((\d[\d,]{0,6}%[†‡*+]?|<\s*\d[\d,]{0,6}%[†‡*+]?|\*{1,2}|†|‡|\+)\s*(?:DV|Daily Value)?\))?(?:\s*\([^)]+\))*(?:\s*(\d[\d,]{0,6}%[†‡*+]?|<\s*\d[\d,]{0,6}%[†‡*+]?|\*{1,2}|†|‡|\+))?(?:\s+[†‡*+])?(?:\s*(?:Daily Value|DV)(?:\s*\([^)]*\))?\s+not\s+established\.?)?[."'“”]*$`, "iu"));
  if (!amountMatch) return null;
  const name = cleanIngredientName(amountMatch[1]);
  if (!name) return null;
  if (/^\(/u.test(name)) return null;
  return {
    name,
    amount: cleanValue(amountMatch[2]),
    unit: cleanParsedUnit(amountMatch[3]),
    ...(amountMatch[4] || amountMatch[5] ? { dailyValue: cleanDailyValue(amountMatch[4] ?? amountMatch[5]) } : {}),
    source,
  };
}

function ingredientRowFromParentheticalUnitAmountTextSegment(segment, source) {
  const text = cleanValue(segment);
  const primaryAmountMatch = text.match(new RegExp(String.raw`^(.+?)\s+(${AMOUNT_VALUE_PATTERN})\s*(${UNIT_PATTERN})\s*\(\s*\d[\d,.]*\s*IU\s*\)\s*(\d[\d,]{0,6}%[†‡*+]?|<\s*\d[\d,]{0,6}%[†‡*+]?|\*{1,2}|†|‡|\+)?$`, "iu"));
  if (primaryAmountMatch) {
    const name = cleanIngredientName(primaryAmountMatch[1]);
    if (!name) return null;
    return {
      name,
      amount: cleanValue(primaryAmountMatch[2]),
      unit: cleanParsedUnit(primaryAmountMatch[3]),
      ...(primaryAmountMatch[4] ? { dailyValue: cleanDailyValue(primaryAmountMatch[4]) } : {}),
      source,
    };
  }

  const match = text.match(new RegExp(String.raw`^(.+?)\s+(${AMOUNT_VALUE_PATTERN})\s*\(\s*\d[\d,.]*\s*(${UNIT_PATTERN})\s+IU\s*\)\s*(\d[\d,]{0,6}%[†‡*+]?|<\s*\d[\d,]{0,6}%[†‡*+]?|\*{1,2}|†|‡|\+)?$`, "iu"));
  if (!match) return null;
  const name = cleanIngredientName(match[1]);
  if (!name) return null;
  return {
    name,
    amount: cleanValue(match[2]),
    unit: cleanParsedUnit(match[3]),
    ...(match[4] ? { dailyValue: cleanDailyValue(match[4]) } : {}),
    source,
  };
}

function ingredientRowFromSourceParentheticalTextSegment(segment, source) {
  const text = cleanValue(segment);
  const prominentNamePattern = PROMINENT_FACTS_ROW_NAMES.map(escapeRegExp).join("|");
  const match = text.match(new RegExp(String.raw`^(${prominentNamePattern})\s+\(`, "iu"));
  if (!match) return null;
  const beforeLastClose = text.slice(0, text.lastIndexOf(")"));
  if (!new RegExp(String.raw`\b${AMOUNT_VALUE_PATTERN}\s*${UNIT_PATTERN}\b`, "iu").test(beforeLastClose)) return null;
  const amountMatches = [...text.matchAll(new RegExp(String.raw`(${AMOUNT_VALUE_PATTERN})\s*(${UNIT_PATTERN})(?:\s+(?:RAE|DFE|NE))?\s*(\d[\d,]{0,6}%[†‡*+]?|<\s*\d[\d,]{0,6}%[†‡*+]?|\*{1,2}|†|‡|\+)?`, "giu"))];
  const amountMatch = amountMatches.at(-1);
  if (!amountMatch) return null;
  return {
    name: cleanValue(match[1]),
    amount: cleanValue(amountMatch[1]),
    unit: cleanParsedUnit(amountMatch[2]),
    ...(amountMatch[3] ? { dailyValue: cleanDailyValue(amountMatch[3]) } : {}),
    source,
  };
}

function ingredientRowsByProminentInlineFacts(text) {
  const factsText = factsPanelText(text, { preserveLeadingTableRows: true });
  if (factsText.includes("\n")) return [];
  const matches = [...factsText.matchAll(prominentFactsRowNamePattern())];
  const rows = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const segmentEnd = matches[index + 1]?.index ?? undefined;
    const segment = cleanValue(factsText.slice(match.index, segmentEnd));
    if (!segment || segment.length > 260) continue;
    const amountMentions = [...segment.matchAll(new RegExp(AMOUNT_WITH_UNIT_PATTERN, "giu"))].length;
    if (amountMentions > 2) continue;
    const row = ingredientRowFromTextSegment(segment, "factsText");
    if (row) rows.push(row);
  }
  return rows;
}

function ingredientRowFromMultiDailyValueTextSegment(segment, source) {
  const text = cleanValue(segment);
  const pattern = new RegExp(String.raw`^(.+?)\s+(${AMOUNT_VALUE_PATTERN})\s*(${UNIT_PATTERN})(?:\s+(?:RAE|DFE|NE))?(?:\s*\[[^\]]{1,40}\])?(?:\s+\([^)]+\))?\s+((?:(?:<\s*)?\d[\d,]{0,6}%[†‡*+]?|\*{1,2}|†|‡|\+)(?:\s+(?:(?:<\s*)?\d[\d,]{0,6}%[†‡*+]?|\*{1,2}|†|‡|\+))*)$`, "iu");
  const match = text.match(pattern);
  if (!match) return null;
  const name = cleanIngredientName(match[1]);
  if (!name) return null;
  const dailyValues = uniqueStrings(match[4].split(/\s+/u).map(cleanDailyValue));
  if (dailyValues.length < 2 || dailyValues.some((value) => !/^(?:<\s*)?\d[\d,]{0,6}%[†‡*+]?$/u.test(value))) return null;
  return {
    name,
    amount: cleanValue(match[2]),
    unit: cleanParsedUnit(match[3]),
    ...(dailyValues.length > 0 ? { dailyValue: dailyValues.join(" / ") } : {}),
    source,
  };
}

function prominentFactsRowNamePattern() {
  const prominentNamePattern = PROMINENT_FACTS_ROW_NAMES
    .slice()
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join("|");
  return new RegExp(String.raw`\b(${prominentNamePattern})\b(?=\s+(?:\(|${AMOUNT_VALUE_PATTERN}\b))`, "giu");
}

function ingredientRowsByMultiDailyValueLines(text) {
  return factsPanelText(text, { preserveLeadingTableRows: true })
    .split(/\n+/u)
    .map(cleanValue)
    .filter((line) => (line.match(/\d[\d,]{0,6}%/gu) ?? []).length >= 2)
    .map((line) => ingredientRowFromMultiDailyValueTextSegment(line, "factsText_multi_dv"))
    .filter(Boolean);
}

function ingredientRowsBySupplementFactsLines(text) {
  const factsText = factsPanelText(text, { preserveLeadingTableRows: true });
  if (!/\bSupplement\s+Facts\b/iu.test(factsText) || !/\bServing\s+Size\b/iu.test(factsText)) return [];
  const rows = [];
  const lines = factsText
    .split(/\n+/u)
    .map(cleanValue)
    .filter(Boolean);
  for (const line of lines) {
    if (isHeaderText(line) || isFootnoteText(line) || isDailyValueText(line)) continue;
    if (/^Supplement\s+Facts$/iu.test(line)) continue;
    if (/^Servings?\s+(?:Size|Per\s+Container)\b/iu.test(line)) continue;
    if (line.length > 180) continue;
    const normalizedLine = line.replace(/(\([^)]*\b(?:DV|Daily Value)\))\s*;.*$/iu, "$1");
    const row = ingredientRowFromTextSegment(normalizedLine, "factsText");
    if (row) rows.push(row);
  }
  return rows;
}

function ingredientRowsByChineseFacts(text) {
  if (!/營養標示|其他成分含量/u.test(text)) return [];
  const rows = [];
  const lines = cleanText(text)
    .split(/\n+/u)
    .map(cleanValue)
    .filter(Boolean);
  for (let index = 0; index < lines.length - 1; index += 1) {
    const name = cleanChineseIngredientName(lines[index]);
    if (!name) continue;
    const amount = parseChineseAmount(lines[index + 1]);
    if (!amount) continue;
    const dailyValueLine = cleanValue(lines[index + 2]);
    rows.push({
      name,
      amount: amount.amount,
      unit: amount.unit,
      ...(isDailyValueText(dailyValueLine) ? { dailyValue: cleanDailyValue(dailyValueLine) } : {}),
      source: "factsText_table",
    });
  }
  return rows;
}

function ingredientRowsByPipeDelimitedTable(text) {
  if (!String(text).includes("|")) return [];
  const rows = [];
  const cells = factsPanelText(text, { preserveLeadingTableRows: true })
    .split(/\n+/u)
    .flatMap((line) => line.split("|"))
    .map(cleanValue)
    .filter(Boolean);
  let pendingNameCells = [];
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    if (isHeaderText(cell) || isIngredientTableHeaderCell(cell) || isFootnoteText(cell)) {
      pendingNameCells = [];
      continue;
    }

    const sameCellRow = ingredientRowFromTextSegment(cell, "factsText_pipe");
    if (sameCellRow) {
      const nextCell = cleanValue(cells[index + 1]);
      if (isDailyValueText(nextCell)) {
        sameCellRow.dailyValue = cleanDailyValue(nextCell);
        index += 1;
      }
      rows.push(sameCellRow);
      pendingNameCells = [];
      continue;
    }

    const amount = parseStandaloneAmount(cell);
    if (!amount) {
      if (!isDailyValueText(cell) && !isBareNumberText(cell)) pendingNameCells.push(cell);
      continue;
    }

    if (pendingNameCells.length === 0) continue;
    const name = cleanIngredientName(stripServingPrefixFromIngredientName(pendingNameCells.join(" ")));
    pendingNameCells = [];
    if (!name) continue;
    const nextCell = cleanValue(cells[index + 1]);
    rows.push({
      name,
      amount: amount.amount,
      unit: amount.unit,
      ...(amount.dailyValue ? { dailyValue: amount.dailyValue } : {}),
      ...(isDailyValueText(nextCell) && !amount.dailyValue ? { dailyValue: cleanDailyValue(nextCell) } : {}),
      source: "factsText_pipe",
    });
    if (isDailyValueText(nextCell) && !amount.dailyValue) index += 1;
  }
  return rows;
}

function ingredientRowsByTransposedTable(text) {
  const lines = factsPanelText(text, { preserveLeadingTableRows: true })
    .split(/\n+/u)
    .map(cleanValue)
    .filter(Boolean);
  const amountHeaderIndex = lines.findIndex((line) => /Amount\s+Per/iu.test(line));
  if (amountHeaderIndex < 1) return [];

  const nameLines = compactTransposedNameLines(lines.slice(0, amountHeaderIndex));
  if (nameLines.length === 0 || nameLines.length > 40) return [];

  const amountEntries = [];
  const dailyValues = [];
  let amountBlockStarted = false;
  for (const line of lines.slice(amountHeaderIndex + 1)) {
    if (isHeaderText(line) || isFootnoteText(line)) continue;
    const amount = parseStandaloneAmount(line);
    if (amount) {
      amountEntries.push(amount);
      amountBlockStarted = true;
      continue;
    }
    if (isBareNumberText(line) && nameLines[amountEntries.length]?.toLowerCase() === "calories") {
      amountEntries.push({ amount: cleanValue(line), unit: "calories" });
      amountBlockStarted = true;
      continue;
    }
    if (!amountBlockStarted && /^Value$/iu.test(line)) continue;
    if (amountBlockStarted && isDailyValueText(line)) {
      dailyValues.push(cleanDailyValue(line));
      continue;
    }
    if (amountBlockStarted) break;
  }

  if (amountEntries.length === 0) return [];
  const names = nameLines.length === amountEntries.length ? nameLines : nameLines.slice(-amountEntries.length);
  if (names.length !== amountEntries.length) return [];

  let dailyValueIndex = dailyValues.length === amountEntries.length ? 0 : dailyValues.length === amountEntries.length - 1 ? -1 : null;
  return names.map((name, index) => {
    const amount = amountEntries[index];
    const dailyValue = amount.dailyValue ?? (
      dailyValueIndex === null ? null : dailyValues[dailyValueIndex < 0 && index === 0 ? -1 : index + dailyValueIndex]
    );
    return {
      name,
      amount: amount.amount,
      unit: amount.unit,
      ...(dailyValue ? { dailyValue } : {}),
      source: "factsText_table",
    };
  });
}

function ingredientRowsByLeadingAmountTable(text) {
  const lines = factsPanelText(text, { preserveLeadingTableRows: true })
    .split(/\n+/u)
    .map(cleanValue)
    .filter(Boolean);
  const amountHeaderIndex = lines.findIndex((line) => /Amount\s+Per/iu.test(line));
  if (amountHeaderIndex < 0) return [];

  const amounts = [];
  const dailyValues = [];
  let index = amountHeaderIndex + 1;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^(?:Serving|Value|%?\s*Daily|%?\s*DV)$/iu.test(line) || isHeaderText(line)) continue;
    const amount = parseStandaloneAmount(line);
    if (amount) {
      amounts.push(amount);
      continue;
    }
    if (isDailyValueText(line)) {
      dailyValues.push(cleanDailyValue(line));
      continue;
    }
    if (amounts.length === 0 && cleanIngredientName(line)) return [];
    if (amounts.length > 0) break;
  }
  if (amounts.length === 0 || amounts.length > 40) return [];

  const names = [];
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || isFootnoteText(line)) break;
    if (/^(?:Serving|Value|%?\s*Daily|%?\s*DV)$/iu.test(line) || isHeaderText(line) || isDailyValueText(line)) continue;
    if (parseStandaloneAmount(line)) break;
    if (/^(?:\(|\[from\b|as\b)/iu.test(line) && names.length > 0) {
      names[names.length - 1] = cleanValue(`${names[names.length - 1]} ${line}`);
      continue;
    }
    const name = cleanIngredientName(line);
    if (name) names.push(name);
    if (names.length >= amounts.length && !hasUnbalancedParentheses(names[names.length - 1] ?? "")) {
      const nextLine = cleanValue(lines[index + 1]);
      if (/^(?:\(|\[from\b|as\b)/iu.test(nextLine)) continue;
      break;
    }
  }

  if (names.length !== amounts.length) return [];
  return names.map((name, rowIndex) => {
    const amount = amounts[rowIndex];
    const dailyValue = amount.dailyValue ?? dailyValues[rowIndex] ?? null;
    return {
      name,
      amount: amount.amount,
      unit: amount.unit,
      ...(dailyValue ? { dailyValue } : {}),
      source: "factsText_table",
    };
  });
}

function ingredientRowsByNameAmountBlockTable(text) {
  const lines = factsPanelText(text, { preserveLeadingTableRows: true })
    .split(/\n+/u)
    .map(cleanValue)
    .filter(Boolean);
  const amountHeaderIndex = lines.findIndex((line) => /Amount\s+Per/iu.test(line));
  if (amountHeaderIndex < 0) return [];

  const names = [];
  const amounts = [];
  const dailyValues = [];
  let sawAmountOrName = false;
  for (const line of lines.slice(amountHeaderIndex + 1)) {
    if (!line) continue;
    if (isFootnoteText(line)) break;
    if (isHeaderText(line)) continue;
    if (isDailyValueText(line)) {
      if (amounts.length > 0) dailyValues.push(cleanDailyValue(line));
      continue;
    }

    const amount = parseStandaloneAmount(line);
    if (amount) {
      amounts.push(amount);
      sawAmountOrName = true;
      continue;
    }

    if (isBareNumberText(line)) continue;
    const normalizedName = normalizeTableIngredientName(line);
    if (!normalizedName) continue;
    if (/^(?:\(|\[from\b|as\b|from\b|standardized\b|guaranteed\b|providing\b|supplying\b)/iu.test(normalizedName) && names.length > 0) {
      names[names.length - 1] = cleanValue(`${names[names.length - 1]} ${normalizedName}`);
    } else {
      names.push(normalizedName);
    }
    sawAmountOrName = true;
    if (names.length > 80 || amounts.length > 80) return [];
  }

  if (!sawAmountOrName || names.length === 0 || amounts.length === 0 || names.length !== amounts.length) return [];
  return names.map((name, index) => {
    const amount = amounts[index];
    const dailyValue = amount.dailyValue ?? dailyValues[index] ?? null;
    return {
      name,
      amount: amount.amount,
      unit: amount.unit,
      ...(dailyValue ? { dailyValue } : {}),
      source: "factsText_table",
    };
  });
}

function ingredientRowsByEachServingProvides(text) {
  const normalized = cleanText(text).replace(/\s+/gu, " ");
  const markerMatch = normalized.match(/\bEACH\s+SERVING\s+PROVIDES\s*:?\s*/iu);
  if (!markerMatch || markerMatch.index === undefined) return [];
  let section = cleanValue(normalized.slice(markerMatch.index + markerMatch[0].length));
  const boundaryIndex = section.search(/\b(?:Recommended\s+Usage|Directions?|Suggested\s+Use|Other\s+Ingredients?|Ingredients?:|Nutritional\s+Information|Nutrition\s+Facts|Supplement\s+Facts|Servings?\s+per\s+container|Serving\s+Size|NOT\s+FOR|FOR\s+MFR|MFG\.?\s*UNIT|Store|Storage|Warning|Caution)\b/iu);
  if (boundaryIndex > 20) section = cleanValue(section.slice(0, boundaryIndex));
  if (!section || section.length > 1200) return [];

  const rows = [];
  const amountPattern = new RegExp(String.raw`(${AMOUNT_VALUE_PATTERN})\s*(${UNIT_PATTERN})\b`, "giu");
  let cursor = 0;
  for (const match of section.matchAll(amountPattern)) {
    const nameSegment = cleanValue(section.slice(cursor, match.index));
    cursor = (match.index ?? 0) + match[0].length;
    const name = cleanIngredientName(nameSegment);
    if (!name) continue;
    rows.push({
      name,
      amount: cleanValue(match[1]),
      unit: cleanParsedUnit(match[2]),
      source: "factsText_table",
    });
  }
  return rows;
}

function ingredientRowsByInlineNameAmountBlock(text) {
  const factsText = factsPanelText(text);
  if (factsText.includes("\n")) return [];
  const amountHeaderMatch = factsText.match(/\bAmount\s+Per\s+(?:Serving|Tablet|Capsule|VegCap|Softgel|Scoop)\b/iu);
  if (amountHeaderMatch?.index === undefined) return [];

  let section = cleanValue(factsText.slice(amountHeaderMatch.index + amountHeaderMatch[0].length))
    .replace(/^(?:%?\s*Daily\s+Value|%DV|DV)\s*/iu, "");
  const footnoteIndex = section.search(/\s+(?:[*†‡+]\s*)?(?:Daily\s+Value|Percent\s+Daily\s+Values?|Other\s+Ingredients?)\b/iu);
  if (footnoteIndex > 20) section = section.slice(0, footnoteIndex);
  section = cleanValue(section.replace(/\b%?\s*Daily\s+Value\b|\b%DV\b/giu, " "));
  if (!section || section.length > 1200) return [];

  const amounts = [];
  let leadingAmountMatch = section.match(new RegExp(String.raw`^(${AMOUNT_WITH_UNIT_PATTERN})(?:\s*[†‡*+])?\s+`, "iu"));
  while (leadingAmountMatch) {
    const amount = parseAmount(leadingAmountMatch[1]);
    if (!amount) break;
    amounts.push(amount);
    section = cleanValue(section.slice(leadingAmountMatch[0].length));
    leadingAmountMatch = section.match(new RegExp(String.raw`^(${AMOUNT_WITH_UNIT_PATTERN})(?:\s*[†‡*+])?\s+`, "iu"));
  }

  const trailingPattern = new RegExp(String.raw`\s((?:${AMOUNT_WITH_UNIT_PATTERN}(?:\s*[†‡*+])?\s*){1,40})$`, "iu");
  const trailingMatch = section.match(trailingPattern);
  if (!trailingMatch) return [];
  const trailingAmountsText = trailingMatch[1];
  const nameBlock = cleanValue(section.slice(0, trailingMatch.index));
  for (const match of trailingAmountsText.matchAll(new RegExp(AMOUNT_WITH_UNIT_PATTERN, "giu"))) {
    const amount = parseAmount(match[0]);
    if (amount) amounts.push(amount);
  }

  if (amounts.length === 0 || amounts.length > 20 || !nameBlock) return [];
  const names = splitInlineIngredientNames(nameBlock, amounts.length);
  if (names.length !== amounts.length) return [];
  return names.map((name, index) => ({
    name,
    amount: amounts[index].amount,
    unit: amounts[index].unit,
    source: "factsText_table",
  }));
}

function compactTransposedNameLines(lines) {
  const names = [];
  for (const line of lines) {
    if (isFootnoteText(line) || isDailyValueText(line)) continue;
    if (/^(?:Supplement|Facts|Yielding:?)$/iu.test(line)) continue;
    if (/^Supplement Facts$/iu.test(line)) continue;
    if (/^Servings?\s+(?:Size|Per\s+Container)\b/iu.test(line)) continue;
    if (parseStandaloneAmount(line) || isBareNumberText(line)) continue;
    if (/^(?:Amount\s+Per|Serving|Value|%?\s*Daily)$/iu.test(line)) continue;
    if (/^(?:\(|\[from\b)/iu.test(line) && names.length > 0) {
      names[names.length - 1] = cleanValue(`${names[names.length - 1]} ${line}`);
      continue;
    }
    const name = cleanIngredientName(line);
    if (name) names.push(name);
  }
  return names;
}

function normalizeTableIngredientName(value) {
  const withoutGuaranteeText = cleanValue(value)
    .replace(/\s*\((?:guaranteed|standardized|providing|supplying)[^)]+\)/giu, "")
    .replace(/\s*\[(?:guaranteed|standardized|providing|supplying)[^\]]+\]/giu, "");
  return cleanIngredientName(withoutGuaranteeText);
}

function splitInlineIngredientNames(value, expectedCount) {
  const normalized = normalizeTableIngredientName(value);
  if (!normalized) return [];
  if (expectedCount === 1) return [normalized];
  const names = cleanValue(value)
    .split(/(?<=\))\s+(?=[A-Z][A-Za-z0-9.'’®™+\-\s]{1,90}\()/u)
    .map(normalizeTableIngredientName)
    .filter(Boolean);
  return names.length === expectedCount ? names : [];
}

function ingredientRowsByAmountPattern(text) {
  const rows = [];
  const normalized = factsPanelText(text).replaceAll("|", " ");
  const pattern = new RegExp(String.raw`([A-Z%][A-Za-z0-9,()\-+.'’/&:®™≥≤\s]{2,}?)\s+(${AMOUNT_VALUE_PATTERN})\s*(${UNIT_PATTERN})\b(?:\s+(?:NE|RAE|DFE))?(?:\s+(\d[\d,]{0,6}%\*?|<\s*\d[\d,]{0,6}%\*?|\*\*|†|‡|\+))?`, "giu");
  for (const match of normalized.matchAll(pattern)) {
    const name = cleanIngredientName(match[1]);
    if (!name) continue;
    rows.push({
      name,
      amount: cleanValue(match[2]),
      unit: cleanParsedUnit(match[3]),
      ...(match[4] ? { dailyValue: cleanDailyValue(match[4]) } : {}),
      source: "factsText_amount_pattern",
    });
  }
  return rows;
}

function ingredientRowsByColonDelimited(text) {
  const rows = [];
  const normalized = factsPanelText(text)
    .replace(/\s+\+\s+Contains\b[^\n]*/giu, "")
    .replace(/\b(?:Nutritional\s+Information|Nutrition\s+Information|Active\s+Ingredients?)\s+(?:Per|Each)\s+[^:]{1,80}:\s*/giu, "")
    .replace(/\b(?:Per|Each)\s+[^:]{1,80}\s+contains:\s*/giu, "")
    .replace(/\b(?:Per|Each)\s+[^:]{1,80}:\s*/giu, "")
    .replace(/\s+/gu, " ");
  if (normalized.includes("|")) return rows;
  const pattern = new RegExp(String.raw`(?:^|\s)([A-Z][A-Za-z0-9,()\-+.'’/&:®™≥≤\s]{2,220}?)\s*:\s*(${AMOUNT_VALUE_PATTERN})\s*(${UNIT_PATTERN})\b(?:\s+(?:NE|RAE|DFE))?\s*(\*{1,2}|†|‡|\+|\d[\d,]{0,6}%\*?)?`, "giu");
  for (const match of normalized.matchAll(pattern)) {
    const name = cleanIngredientName(match[1]);
    if (!name) continue;
    rows.push({
      name,
      amount: cleanValue(match[2]),
      unit: cleanParsedUnit(match[3]),
      ...(match[4] ? { dailyValue: cleanDailyValue(match[4]) } : {}),
      source: "factsText",
    });
  }
  return rows;
}

function ingredientRowsByAmountBeforeNameTable(text) {
  const rows = [];
  const normalized = factsPanelText(text).replace(/\s+/gu, " ");
  const pattern = new RegExp(String.raw`\bAmount\s+Per\s+Serving\s+(${AMOUNT_VALUE_PATTERN})\s*(${UNIT_PATTERN})\b(?:\s+(?:NE|RAE|DFE))?\s+%?\s*Daily\s+Value\s+(?:\*+\s+)?(.+?)(?=\s+\*?\s*Daily\s+Value|\s*$)`, "giu");
  for (const match of normalized.matchAll(pattern)) {
    const rawName = cleanValue(match[3]).replace(/\s+\*+$/u, "");
    if (new RegExp(String.raw`\b${AMOUNT_WITH_UNIT_PATTERN}\b`, "iu").test(rawName)) continue;
    const name = cleanIngredientName(rawName);
    if (!name) continue;
    rows.push({
      name,
      amount: cleanValue(match[1]),
      unit: cleanParsedUnit(match[2]),
      source: "factsText_table",
    });
  }
  return rows;
}

function ingredientRowsByStackedTable(text) {
  const lines = factsPanelText(text, { preserveLeadingTableRows: true })
    .split(/\n+/u)
    .map(cleanValue)
    .filter(Boolean);
  const rows = [];
  let pendingNameLines = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isHeaderText(line) || isFootnoteText(line)) {
      pendingNameLines = [];
      continue;
    }
    if (isBareNumberText(line)) {
      pendingNameLines = [];
      continue;
    }

    const amount = parseStandaloneAmount(line);
    const trailingAmount = amount ? null : parseTrailingAmountLine(line);
    if (!amount && !trailingAmount) {
      if (!isDailyValueText(line)) pendingNameLines.push(line);
      continue;
    }

    if (pendingNameLines.length === 0) continue;
    const nameLines = trailingAmount ? [...pendingNameLines, trailingAmount.nameSuffix] : [...pendingNameLines];
    pendingNameLines = [];
    if (nameLines.join(" ").length > 120) continue;
    let dailyValue = null;
    if (amount?.dailyValue) {
      dailyValue = amount.dailyValue;
    } else if (trailingAmount?.dailyValue) {
      dailyValue = trailingAmount.dailyValue;
    } else {
      let lookahead = index + 1;
      while (isHeaderText(lines[lookahead])) lookahead += 1;
      const nextLine = cleanValue(lines[lookahead]);
      if (isDailyValueText(nextLine)) {
        dailyValue = cleanDailyValue(nextLine);
        index = lookahead;
      }
    }
    while (hasUnbalancedParentheses(nameLines.join(" ")) && index + 1 < lines.length) {
      const continuation = cleanValue(lines[index + 1]);
      if (!continuation || parseStandaloneAmount(continuation) || isDailyValueText(continuation) || isHeaderText(continuation) || isFootnoteText(continuation)) break;
      nameLines.push(continuation);
      index += 1;
    }
    const name = cleanIngredientName(nameLines.join(" "));
    if (!name) continue;
    rows.push({
      name,
      amount: (amount ?? trailingAmount).amount,
      unit: (amount ?? trailingAmount).unit,
      ...(dailyValue ? { dailyValue } : {}),
      source: "factsText_table",
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
  if (/^\(/u.test(name)) return false;
  if (/^(?:\[?\s*(?:as|from)\b|&|\/\d|\W?→)/iu.test(name)) return false;
  if (/[→]/u.test(name)) return false;
  if (hasMismatchedParentheses(name)) return false;
  if (/^(?:as|from|fruiting\s+body|extract)\b/iu.test(name)) return false;
  if (row.source !== "structured_label_field" && /^[a-z]/u.test(name) && !isAllowedLowercaseIngredientName(name)) return false;
  if (name.length > 120) return false;
  if (isKnownNonIngredientName(name)) return false;
  if (/\b(percent daily values?|daily values? are based|amount per serving|servings? per container|serving size|supplement facts|nutrition facts)\b/iu.test(name)) {
    return false;
  }
  if (/\b(not established|based on a|from fat|years of age|children|adults|other ingredients?)\b/iu.test(name)) return false;
  if (/\b(add to cart|buy now|notify me|view full details|copy link|shopify|reviews?|quantity|faq|shipping)\b/iu.test(name)) {
    return false;
  }
  if (/\b(supplement facts panel|facts panel|label showing|panel for|of gummies|detailing|gmo-free|gluten-free|third party tested)\b/iu.test(name)) {
    return false;
  }
  if (/^(?:ingredients?\s+per\s+(?:daily\s+)?dose|nutritional\s+value|active\s+ingredients?|nutrition\s+information|nutritional\s+information)(?:\s*\/\s*|\b)/iu.test(name)) {
    return false;
  }
  if (/^(?:\d+\s*)?kJ\s*\/?$/iu.test(name)) return false;
  if (/\b(provides|deliver|offers|designed|taking|supports?)\b/iu.test(name) && name.length > 40) return false;
  if (/^(?:and|or|for|showing|close|providing|capsules?|tablets?|softgels?|soft chews?|gummies|powder)\b/iu.test(name)) return false;
  if (/\b(natural and artificial flavor|artificial flavor|citric acid|malic acid|tartaric acid|sucralose|silicon dioxide|red 40|blue 2)\b/iu.test(name)) {
    return false;
  }
  if (/\b(daily serving value|per serving\s*\/\s*per|tells you how much a nutrient|less than)\b/iu.test(name)) return false;
  if (/^(?:mg|mcg|g|iu|cfu|ml|kcal|calories?)\b/iu.test(name)) return false;
  if (row.source !== "structured_label_field" && new RegExp(String.raw`\b${AMOUNT_WITH_UNIT_PATTERN}\b`, "iu").test(name)) return false;
  if (/\d[\d,.]*\s*(?:mg|mcg|g|iu|cfu|ml)\s*\d/iu.test(name)) return false;
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
  const match = cleanValue(value).match(new RegExp(String.raw`^(${AMOUNT_VALUE_PATTERN})\s*(${UNIT_PATTERN})\b(?:\s+(?:NE|RAE|DFE))?`, "iu"));
  if (!match) return null;
  return { amount: cleanValue(match[1]), unit: cleanParsedUnit(match[2]) };
}

function isGreekPrefixIngredientName(value) {
  return /^(?:alpha|beta|gamma)[-\s]/iu.test(cleanValue(value));
}

function isAllowedLowercaseIngredientName(value) {
  const name = cleanValue(value);
  return isGreekPrefixIngredientName(name)
    || /^(?:omega-\d|phospholipids?\b|eicosapentaenoic\b|docosahexaenoic\b|medium\s+chain\s+triglycerides?\b|flax\b)/iu.test(name);
}

function parseStandaloneAmount(value) {
  const match = cleanValue(value).match(new RegExp(String.raw`^(${AMOUNT_VALUE_PATTERN})\s*(${UNIT_PATTERN})(?:\s*\([^)]+\))?\s*(\d[\d,]{0,6}%[†‡*+]?|<\s*\d[\d,]{0,6}%[†‡*+]?|\*{1,2}|†|‡|\+)?$`, "iu"));
  if (!match) return null;
  return {
    amount: cleanValue(match[1]),
    unit: cleanParsedUnit(match[2]),
    ...(match[3] ? { dailyValue: cleanDailyValue(match[3]) } : {}),
  };
}

function parseTrailingAmountLine(value) {
  const match = cleanValue(value).match(new RegExp(String.raw`^(.+?)\s+(${AMOUNT_VALUE_PATTERN})\s*(${UNIT_PATTERN})(?:\s+(?:RAE|DFE|NE))?\s*(\d[\d,]{0,6}%[†‡*+]?|<\s*\d[\d,]{0,6}%[†‡*+]?|\*{1,2}|†|‡|\+)?$`, "iu"));
  if (!match) return null;
  const nameSuffix = cleanValue(match[1]);
  if (!nameSuffix || !/^(?:\(.*\)|\[.*\]|as\b)/iu.test(nameSuffix)) return null;
  return {
    nameSuffix,
    amount: cleanValue(match[2]),
    unit: cleanParsedUnit(match[3]),
    ...(match[4] ? { dailyValue: cleanDailyValue(match[4]) } : {}),
  };
}

function isDailyValueText(value) {
  return /^(\d[\d,]{0,6}%[†‡*+]?|<\s*\d[\d,]{0,6}%[†‡*+]?|\*{1,2}|†|‡|\+|-|(?:Daily Value|DV)(?:\s*\([^)]*\))?\s+not\s+established\.?)$/iu.test(cleanValue(value));
}

function cleanParsedUnit(value) {
  const unit = cleanValue(value);
  if (/^(?:µ|μ)g/iu.test(unit)) return unit.replace(/^(?:µ|μ)g/iu, "mcg");
  if (/^mcgt$/iu.test(unit)) return "mcg";
  if (/^mgt$/iu.test(unit)) return "mg";
  if (/^mlt$/iu.test(unit)) return "mL";
  if (/^mca$/iu.test(unit)) return "mcg";
  if (/^gt$/iu.test(unit)) return "g";
  if (/^cfu$/iu.test(unit)) return "CFU";
  if (/^cfus$/iu.test(unit)) return "CFU";
  if (/^billion\s+cfus$/iu.test(unit)) return "billion CFU";
  if (/^million\s+cfus$/iu.test(unit)) return "million CFU";
  return unit;
}

function isHeaderText(text) {
  const value = cleanValue(text);
  if (/^(?:Supplement|Facts|Yielding:?|Amount\s+Per|Serving|%DV|%\s*Daily|Value|One\s+\w+\s+Contains:?|Two\s+\w+\s+Contain:?|\w+\s+Capsules?\s+Contain:?)$/iu.test(value)) {
    return true;
  }
  return /\b(Serving Size|Servings Per Container|Amount Per Serving|Daily Value|Calories|Total Fat|Total Carbohydrate)\b/iu.test(value)
    && !/\b\d[\d,.]*\s*(mcg|mg|g|IU|CFU|ml)\b/iu.test(text);
}

function isIngredientTableHeaderCell(text) {
  return /^(?:nutritional\s+value|active\s+ingredients?|nutrition\s+information|nutritional\s+information)(?:\s*\/\s*|\b|:)/iu.test(cleanValue(text));
}

function isFootnoteText(text) {
  return /(?:percent daily values?|daily values?).*(?:based on|not established)|other ingredients?|suggested use|directions?|warning|caution|rev\s+[a-z0-9-]+$/iu.test(cleanValue(text));
}

function isBareNumberText(text) {
  return /^(?:<\s*)?\d[\d,.]*(?:\.\d+)?%?$/u.test(cleanValue(text));
}

function hasUnbalancedParentheses(text) {
  const value = cleanValue(text);
  return (value.match(/\(/gu) ?? []).length > (value.match(/\)/gu) ?? []).length;
}

function hasMismatchedParentheses(text) {
  const value = cleanValue(text);
  return (value.match(/\(/gu) ?? []).length !== (value.match(/\)/gu) ?? []).length;
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/&nbsp;/giu, " ")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&amp;/giu, "&")
    .replace(/[‹›]/gu, (marker) => (marker === "‹" ? "<" : ">"))
    .replace(/[“”]/gu, "\"")
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

function cleanServingSize(value) {
  return cleanValue(value)
    .replace(/^(?:Adults|Children|Infants|Adolescents|Teenagers|Seniors)\s*;\s*(?:age\s+[^:;]+:\s*)?/iu, "")
    .replace(/^(?:serving\s+size|dosis(?:\s+diaria\s+recomendada)?|diaria\s+recomendada|dose|dávka|davka|pour|dosage\s+pour|par|per|por)\s*[:–-]?\s*/iu, "")
    .replace(/^(?:journali[eè]re|daily)\s*\(\s*/iu, "")
    .replace(/^(?:t[aä]glich|taeglich)\s+/iu, "")
    .replace(/^(\d+(?:[.,]\d+)?)\s*(g|grams?)\s*[–-]\s*(1\s+s[aá]č(?:ek|ky|ků)?).*$/iu, "$3 ($1 $2)")
    .replace(/^(\d+(?:[.,]\d+)?)\s+(?:[\p{L}\d+®™.-]+\s+){1,5}(kapseln?|tabletten?)\b.*$/iu, "$1 $2")
    .replace(/^(\d+(?:[.,]\d+)?)\s+(kapseln?|tabletten?)\b.*$/iu, "$1 $2")
    .replace(/^((?:כמוס(?:ה|ות)|טבלי(?:ה|ות)|קפסול(?:ה|ות))\s+)אחת(?:\s|$)/u, "1 $1")
    .replace(/^(?:un|una)\s+/iu, "1 ")
    .replace(/^dos\s+/iu, "2 ")
    .replace(/^tres\s+/iu, "3 ")
    .replace(/[,"']?\s+"?Servings?\s+Per\s+Container\b.*$/iu, "")
    .replace(/(?<!\bfl)\.(?!\s*\()(?![^()]*\))\s+.*$/iu, "")
    .replace(/\s+Servings?:.*$/iu, "")
    .replace(/\s*:\s*\d+(?:[.,]\d+)?\s*(?:daily|times\s+daily|per\s+day)\b.*$/iu, "")
    .replace(/\s*\/\s*(?:tablets?(?:\(s\))?|capsules?(?:\(s\))?|tbl|caps?)\b/iu, "")
    .replace(/(\([^)]{1,70}\))\s+\d.*$/u, "$1")
    .replace(/\s+(?:\d+\s+)?(?:times|veces|fois)\s+(?:al|a|per|par)\s+(?:día|dia|jour|day)\b.*$/iu, "")
    .replace(/\s+\d+\s+razy\s+dziennie\b.*$/iu, "")
    .replace(/\s+(?:par|en)\s+(?:une?\s+)?prise\b.*$/iu, "")
    .replace(/\s+(?:par|al|por)\s+(?:jour|día|dia|day)\b.*$/iu, "")
    .replace(/\s+(?:ביום|ליום).*$/u, "")
    .replace(/\s+אחרי\s+האוכל.*$/u, "")
    .replace(/\s+dosis\s+por\s+envase\b.*$/iu, "")
    .replace(/\s+(?:rozpu[sś]ci[cć]|wymiesza[cć]|przyjmowa[cć]|stosowa[cć]).*$/iu, "")
    .replace(/\s+(?:am\s+morgen|mit(?:\s+reichlich)?|le\s+matin|au\s+cours|[aà]\s+avaler|avec|de\s+pr[eé]f[eé]rence|preferably|antes|before|after|con|with)\b.*$/iu, "")
    .replace(/\s+per\s+day\b.*$/iu, "")
    .replace(/\s+(?:or\s+as\s+directed|daily\b|as\s+a\s+dietary|of\s+water\b|with\s+\d|your\s+preferred|mix\s+\d|shake\s+or\s+stir|by\s+your\s+health|healthcare\s+professional|third\s+party|non-gmo|gluten-free|warning\b|notice\b).*$/iu, "")
    .replace(/(\([^)]{1,70})$/u, "$1)")
    .trim();
}

function stripServingPrefixFromIngredientName(value) {
  return cleanValue(value)
    .replace(new RegExp(String.raw`^${SERVING_AMOUNT_PATTERN}\s*${SERVING_FORM_PATTERN}(?:\s*/\s*(?:tablets?(?:\(s\))?|capsules?(?:\(s\))?|tbl|caps?))?(?:\s*\([^)]{1,70}\))?\s+`, "iu"), "")
    .trim();
}

function isUsefulServingSize(value) {
  const rawText = servingSizeRawText(value);
  if (!rawText) return false;
  if (hasServingSizeBodyMarkers(rawText)) return false;
  const text = cleanServingSize(rawText);
  if (!text || text.length > 120) return false;
  if (/^(?:serving size|servings per container|amount per serving|supplement facts|nutrition facts)$/iu.test(text)) return false;
  if (/\b(add to cart|buy now|notify me|view full details|copy link|shopify|reviews?|quantity|faq|shipping)\b/iu.test(text)) {
    return false;
  }
  return hasBoundedServingSizeShape(text, value);
}

function servingSizeRawText(value) {
  if (typeof value === "string") return cleanText(value);
  if (!value || typeof value !== "object") return "";
  const text = cleanText(value.text ?? value.servingSize ?? value.description ?? value.value);
  if (text && value.amount !== undefined && value.unit && /^(?:per|par)\s+\S+$/iu.test(text)) {
    return cleanText(`${value.amount} ${value.unit}`);
  }
  if (text) return text;
  if (value.amount !== undefined && value.unit) return cleanText(`${value.amount} ${value.unit}`);
  return "";
}

function hasServingSizeBodyMarkers(value) {
  const text = cleanValue(value);
  if (/\b(supplement facts|nutrition facts|amount per serving|%?\s*daily value|servings? per container|other ingredients?|suggested use|directions?|warning|caution)\b/iu.test(text)) {
    return true;
  }
  if (/\b(?:calories|total fat|cholesterol|sodium|total carbohydrate|protein|vitamin|magnesium|zinc|iron|calcium)\b.{0,30}\b\d[\d,.]*\s*(?:mg|mcg|g|iu|ml|%)\b/iu.test(text)) {
    return true;
  }
  return false;
}

function hasBoundedServingSizeShape(value, originalValue = null) {
  const text = cleanValue(value);
  const servingPattern = new RegExp(String.raw`^${SERVING_AMOUNT_PATTERN}\s*${SERVING_FORM_PATTERN}(?:\s*\([^)]{1,70}\))?$`, "iu");
  if (servingPattern.test(text)) return !isLikelyContainerCountServingSize(text, originalValue);
  return new RegExp(String.raw`^(?:\d+(?:[.,]\d+)?|\d+\s*/\s*\d+)\s*[\p{Script=Han}]{1,4}$`, "u").test(text);
}

function isLikelyContainerCountServingSize(value, originalValue = null) {
  const text = cleanValue(value);
  const match = text.match(/^(\d+(?:[.,]\d+)?)\s*(.+)$/u);
  if (!match) return false;
  const amount = Number.parseFloat(match[1].replace(",", "."));
  const unitText = cleanValue(match[2]);
  if (isOfficialServingColumnServingSize(originalValue) && !/^100\s*(?:g|grams?|mL|ml|milliliters?)$/iu.test(text)) return false;
  if (/\([^)]*(?:scoop|teaspoon|tablespoon|tsp|tbsp|packet|stick\s+pack|capsule|tablet)[^)]*\)/iu.test(text)) {
    return false;
  }
  if (/\([^)]*\b1\s+serving\b[^)]*\)/iu.test(text)) return false;
  if (amount >= 50 && /^(?:g|grams?)$/iu.test(unitText)) return true;
  if (amount >= 100 && /^(?:mL|ml|milliliters?)$/u.test(unitText)) return true;
  if (amount >= 8 && /^(?:fl\.?\s*oz|fluid\s+ounces?)$/iu.test(unitText)) return true;
  return amount >= 10
    && /\b(?:servings?|sv|packets?|stick\s+packs?|capsules?(?:\(s\))?|tablets?|caplets?|softgels?|gummies?|chews?|chewables?|wafers?|lozenges?|kapseln?|tabletten?)\b/iu.test(unitText);
}

function isOfficialServingColumnServingSize(value) {
  return Boolean(value && typeof value === "object" && cleanValue(value.source) === "official_nutrition_table");
}

function cleanIngredientName(value) {
  const name = cleanIngredientEquivalenceNotes(value)
    .replace(/\b(Amount Per \w+|Daily Value|Supplement Facts|Nutrition Facts|%?\s*DV)\b/giu, "")
    .replace(/^(?:Amount\s+Per\s+)?%?\s*Daily\s+Serving\s+Value\*?\s*/iu, "")
    .replace(/^%\s+/u, "")
    .replace(/^%[,.\s]+/u, "")
    .replace(/^["'.:;,\-\s]+/u, "")
    .replace(/["']+$/u, "")
    .replace(/^(?:%?\s*DV|(?:<\s*)?\d[\d,]{0,6}%\*?)\s+/iu, "")
    .replace(/^[†‡*+\s]+(?=\S)/u, "")
    .replace(/^[†‡*+\s]*(?:not established\.?|daily value not established\.?)\s+/iu, "")
    .replace(/\.{2,}/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if ((name.length < 2 && !/\p{Script=Han}/u.test(name)) || name.length > 180) return null;
  if (isKnownNonIngredientName(name)) return null;
  return name;
}

function cleanIngredientEquivalenceNotes(value) {
  return cleanValue(value)
    .replace(/\s*\((?:from|as)\s+[^)]*\b\d[\d,.]*\s*(?:mg|mcg|g|IU|ml)\b[^)]*\)/giu, "")
    .replace(/\s*\(([^)]*\b(?:equivalent|providing|yielding|supplying)[^)]*)\)/giu, (_match, body) => {
      const kept = cleanValue(String(body).split(/\s*,\s*(?=\b(?:equivalent|providing|yielding|supplying)\b)/iu)[0]);
      if (!kept || new RegExp(String.raw`\b${AMOUNT_WITH_UNIT_PATTERN}\b`, "iu").test(kept)) return "";
      return ` (${kept})`;
    });
}

function cleanChineseIngredientName(value) {
  const name = cleanIngredientName(value);
  if (!name) return null;
  if (/^(?:營養標示|成分|每份|每日參考值|其他成分含量|每一份量|本包裝含)$/u.test(name)) return null;
  if (/^每日參考值[：:]/u.test(name)) return null;
  return name;
}

function parseChineseAmount(value) {
  const match = cleanValue(value).match(/^((?:<\s*)?\d+(?:\.\d+)?)\s*(毫克|微克|公克|克|IU)\s*([A-Za-zΑ-ωα-ω-]+)?(?:\([^)]+\))?$/u);
  if (!match) return null;
  const unitMap = new Map([
    ["毫克", "mg"],
    ["微克", "mcg"],
    ["公克", "g"],
    ["克", "g"],
    ["IU", "IU"],
  ]);
  const unit = cleanValue(`${unitMap.get(match[2]) ?? match[2]} ${match[3] ?? ""}`);
  return { amount: cleanValue(match[1]), unit };
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function dedupeIngredientRows(rows) {
  const seen = new Set();
  const deduped = [];
  for (const row of rows) {
    const name = cleanIngredientName(row.name);
    const nameWithoutExtractRatio = cleanTrailingExtractRatioName(name);
    if (name && nameWithoutExtractRatio !== name && rows.some((other) => {
      if (other === row) return false;
      const otherName = cleanIngredientName(other.name);
      return otherName === nameWithoutExtractRatio
        && cleanValue(other.amount) === cleanValue(row.amount)
        && cleanParsedUnit(other.unit) === cleanParsedUnit(row.unit)
        && cleanDailyValue(other.dailyValue) === cleanDailyValue(row.dailyValue);
    })) {
      continue;
    }
    if (name && rows.some((other) => {
      if (other === row) return false;
      const otherName = cleanIngredientName(other.name);
      return otherName
        && otherName.length > name.length
        && otherName.endsWith(name)
        && cleanValue(other.amount) === cleanValue(row.amount)
        && cleanParsedUnit(other.unit) === cleanParsedUnit(row.unit)
        && cleanDailyValue(other.dailyValue) === cleanDailyValue(row.dailyValue);
    })) {
      continue;
    }
    if (row.source === "factsText_amount_pattern" && rows.some((other) => {
      if (other === row || other.source === "factsText_amount_pattern") return false;
      const otherName = cleanIngredientName(other.name);
      return name
        && otherName
        && otherName === name
        && cleanValue(other.amount) === cleanValue(row.amount)
        && cleanParsedUnit(other.unit) === cleanParsedUnit(row.unit);
    })) {
      continue;
    }
    if (!cleanDailyValue(row.dailyValue) && rows.some((other) => {
      if (other === row) return false;
      const otherName = cleanIngredientName(other.name);
      return name
        && otherName === name
        && cleanValue(other.amount) === cleanValue(row.amount)
        && cleanParsedUnit(other.unit) === cleanParsedUnit(row.unit)
        && cleanDailyValue(other.dailyValue);
    })) {
      continue;
    }
    if (rows.some((other) => {
      if (other === row) return false;
      return hasSameBaseIngredientAmount(row, other) && isRicherIngredientRow(other, row);
    })) {
      continue;
    }
    const key = `${cleanIngredientName(row.name) ?? row.name}|${row.amount ?? ""}|${cleanParsedUnit(row.unit) ?? ""}|${cleanDailyValue(row.dailyValue)}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function hasSameBaseIngredientAmount(left, right) {
  const leftBaseName = baseIngredientName(left.name);
  const rightBaseName = baseIngredientName(right.name);
  return Boolean(leftBaseName && rightBaseName)
    && leftBaseName === rightBaseName
    && cleanValue(left.amount) === cleanValue(right.amount)
    && cleanParsedUnit(left.unit) === cleanParsedUnit(right.unit);
}

function baseIngredientName(value) {
  const name = cleanIngredientName(value);
  if (!name) return null;
  return cleanValue(name.replace(/\s*\([^)]*\)/gu, "").replace(/\s*\[[^\]]*\]/gu, "")).toLowerCase();
}

function isRicherIngredientRow(candidate, current) {
  const candidateDailyValue = cleanDailyValue(candidate.dailyValue);
  const currentDailyValue = cleanDailyValue(current.dailyValue);
  if (candidateDailyValue && currentDailyValue && candidateDailyValue !== currentDailyValue) {
    return candidateDailyValue.split(/\s*\/\s*/u).length > currentDailyValue.split(/\s*\/\s*/u).length;
  }
  if (candidateDailyValue && !currentDailyValue) return true;
  const candidateName = cleanIngredientName(candidate.name) ?? "";
  const currentName = cleanIngredientName(current.name) ?? "";
  if (cleanTrailingExtractRatioName(candidateName) === currentName) return false;
  return candidateDailyValue === currentDailyValue && candidateName.length > currentName.length;
}

function removeSourceComponentRows(rows) {
  const parsedNames = new Set(rows.map((row) => cleanIngredientName(row.name)?.toLowerCase()).filter(Boolean));
  const hasMineralParent = ["calcium", "magnesium", "sodium", "potassium"].some((name) => parsedNames.has(name));
  if (!hasMineralParent) return rows;
  return rows.filter((row) => {
    const name = cleanIngredientName(row.name) ?? "";
    if (/^(?:calcium|magnesium|sodium|potassium)$/iu.test(name)) {
      const hasSameNameParentWithDailyValue = !cleanDailyValue(row.dailyValue) && rows.some((other) => {
        if (other === row) return false;
        return cleanIngredientName(other.name) === name
          && cleanParsedUnit(other.unit) === cleanParsedUnit(row.unit)
          && cleanDailyValue(other.dailyValue);
      });
      return !hasSameNameParentWithDailyValue;
    }
    return !/\b(?:bisglycinate|citrate|phosphate|chloride|aquamin|himalayan\s+rock\s+salt|coconut\s+water)\b/iu.test(name);
  });
}

function cleanTrailingExtractRatioName(value) {
  return cleanValue(value).replace(/\s*\([^)]*\b\d+\s*:\s*\d+\s*extract[^)]*\)$/iu, "");
}

const EVIDENCE_RECOVERY_ACTIONS = {
  official_refetch_or_ocr: {
    priority: 10,
    action: "refetch_official_label_or_ocr",
    reason: "Saved row does not contain enough structured facts evidence; fetch official facts HTML, product JSON/media, label image, or PDF.",
  },
  official_refetch_page_body: {
    priority: 20,
    action: "refetch_official_page_body",
    reason: "Saved facts evidence looks like full page/body copy; refetch the official product label and replace with bounded label-only evidence.",
  },
  parser_serving_size_review: {
    priority: 30,
    action: "review_serving_size_parser",
    reason: "Ingredient rows are present but serving size is missing or malformed; inspect official label serving-size evidence before backfill.",
  },
  parser_or_manual_review: {
    priority: 40,
    action: "review_parser_or_manual",
    reason: "Some evidence exists, but parser confidence is not high enough for automated backfill.",
  },
  manual_review_fallback_rows: {
    priority: 50,
    action: "manual_review_fallback_amount_rows",
    reason: "Only broad amount-pattern ingredient rows were recovered; manually verify the label table before writing.",
  },
  not_standalone_supplement_review: {
    priority: 90,
    action: "review_non_standalone_or_delete",
    reason: "Row appears to be food, flavoring, bundle, or another non-standalone supplement candidate.",
  },
};

function evidenceRecoveryAction(hint) {
  return EVIDENCE_RECOVERY_ACTIONS[hint] ?? {
    priority: 80,
    action: "manual_review",
    reason: "Row is not ready for automated backfill and needs manual review.",
  };
}

function buildEvidenceRecoveryQueue(previews) {
  const unreadyRows = previews.filter((row) => !row.automatedBackfillReady);
  const brandVolumes = new Map();
  for (const row of unreadyRows) {
    const source = sourceFromOriginId(row.dataOriginId);
    brandVolumes.set(source, (brandVolumes.get(source) ?? 0) + 1);
  }

  return unreadyRows
    .map((row) => {
      const source = sourceFromOriginId(row.dataOriginId);
      const action = evidenceRecoveryAction(row.evidenceRecoveryHint);
      const parserBlockers = Array.isArray(row.parserBlockers) ? row.parserBlockers : [];
      return {
        priority: action.priority,
        action: action.action,
        evidenceRecoveryHint: row.evidenceRecoveryHint,
        reason: action.reason,
        source,
        sourceId: sourceIdFromOriginId(row.dataOriginId),
        brandUnreadyRows: brandVolumes.get(source) ?? 0,
        id: row.id,
        dataOriginId: row.dataOriginId,
        name: row.name,
        brand: row.brand,
        dataOriginUrl: row.dataOriginUrl,
        parserStatus: row.parserStatus,
        parserBlockers,
        missingIngredientRows: parserBlockers.includes("missing_ingredient_rows"),
        missingServingSizes: parserBlockers.includes("missing_serving_sizes"),
        existingIngredientRows: row.existingIngredientRows,
        parsedIngredientRows: row.parsedIngredientRows,
        existingServingSizes: row.existingServingSizes,
        parsedServingSizes: row.parsedServingSizes,
        oldSearchTextLength: row.oldSearchTextLength,
        proposedSearchTextLength: row.proposedSearchTextLength,
        proposedSearchTextPreview: row.proposedSearchTextPreview,
      };
    })
    .sort((a, b) => (
      a.priority - b.priority
      || b.brandUnreadyRows - a.brandUnreadyRows
      || a.source.localeCompare(b.source)
      || String(a.dataOriginUrl ?? "").localeCompare(String(b.dataOriginUrl ?? ""))
      || String(a.name ?? "").localeCompare(String(b.name ?? ""))
      || String(a.id ?? "").localeCompare(String(b.id ?? ""))
    ));
}

function buildEvidenceRecoveryByBrand(queue) {
  const byBrand = new Map();
  for (const row of queue) {
    const current = byBrand.get(row.source) ?? {
      source: row.source,
      rows: 0,
      sourceUrls: 0,
      actions: {},
      hints: {},
      blockers: {},
      sampleRows: [],
      _sourceUrls: new Set(),
    };
    current.rows += 1;
    current._sourceUrls.add(row.dataOriginUrl);
    current.actions[row.action] = (current.actions[row.action] ?? 0) + 1;
    current.hints[row.evidenceRecoveryHint] = (current.hints[row.evidenceRecoveryHint] ?? 0) + 1;
    for (const blocker of row.parserBlockers) {
      current.blockers[blocker] = (current.blockers[blocker] ?? 0) + 1;
    }
    if (current.sampleRows.length < 8) {
      current.sampleRows.push({
        id: row.id,
        dataOriginId: row.dataOriginId,
        name: row.name,
        action: row.action,
        parserStatus: row.parserStatus,
        parserBlockers: row.parserBlockers,
        dataOriginUrl: row.dataOriginUrl,
      });
    }
    byBrand.set(row.source, current);
  }

  return [...byBrand.values()]
    .map((entry) => {
      const { _sourceUrls, ...publicEntry } = entry;
      return {
        ...publicEntry,
        sourceUrls: _sourceUrls.size,
      };
    })
    .sort((a, b) => b.rows - a.rows || a.source.localeCompare(b.source));
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
    automatedBackfillReady: previews.filter((row) => row.automatedBackfillReady).length,
    structuredReadyWithBlockers: previews.filter((row) => row.parserStatus === "structured_ready" && row.parserBlockers.length > 0).length,
    partialParse: previews.filter((row) => row.parserStatus === "partial_parse").length,
    needsBetterParser: previews.filter((row) => row.parserStatus === "needs_better_parser").length,
    removableFieldCandidateRows: previews.filter((row) => row.removableFieldCandidates.length > 0).length,
  };
  const byBrand = new Map();
  for (const row of previews) {
    const brandSlug = sourceFromOriginId(row.dataOriginId);
    const current = byBrand.get(brandSlug) ?? { rows: 0, structuredReady: 0, automatedBackfillReady: 0, needsBetterParser: 0 };
    current.rows += 1;
    if (row.parserStatus === "structured_ready") current.structuredReady += 1;
    if (row.automatedBackfillReady) current.automatedBackfillReady += 1;
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
  const backfillCandidates = previews
    .map((row) => row.productionCandidate)
    .filter(Boolean);
  const backfillCandidatesPath = join(outputDir, "brand_site_repair_backfill_candidates.json");
  const recoveryQueue = buildEvidenceRecoveryQueue(previews);
  const recoveryByBrand = buildEvidenceRecoveryByBrand(recoveryQueue);
  const recoveryQueuePath = join(outputDir, "brand_site_evidence_recovery_queue.json");
  const recoveryByBrandPath = join(outputDir, "brand_site_evidence_recovery_by_brand.json");
  const recoveryQueueCsvPath = join(outputDir, "brand_site_evidence_recovery_queue.csv");
  writeFileSync(jsonPath, `${JSON.stringify(previews.map(previewForDiagnosticArtifact), null, 2)}\n`);
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(backfillCandidatesPath, `${JSON.stringify(backfillCandidates, null, 2)}\n`);
  writeFileSync(recoveryQueuePath, `${JSON.stringify(recoveryQueue, null, 2)}\n`);
  writeFileSync(recoveryByBrandPath, `${JSON.stringify(recoveryByBrand, null, 2)}\n`);
  const headers = [
    "parserStatus",
    "automatedBackfillReady",
    "evidenceRecoveryHint",
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
    "parserBlockers",
    "parsedIngredientRowSources",
    "removableFieldCandidates",
    "dataOriginUrl",
    "proposedSearchTextPreview",
  ];
  writeFileSync(csvPath, `${headers.join(",")}\n${previews.map((row) => headers.map((header) => csvEscape(row[header])).join(",")).join("\n")}\n`);
  const recoveryHeaders = [
    "priority",
    "action",
    "evidenceRecoveryHint",
    "source",
    "sourceId",
    "brandUnreadyRows",
    "id",
    "dataOriginId",
    "name",
    "brand",
    "dataOriginUrl",
    "parserStatus",
    "parserBlockers",
    "existingIngredientRows",
    "parsedIngredientRows",
    "existingServingSizes",
    "parsedServingSizes",
    "oldSearchTextLength",
    "proposedSearchTextLength",
    "proposedSearchTextPreview",
    "reason",
  ];
  writeFileSync(recoveryQueueCsvPath, `${recoveryHeaders.join(",")}\n${recoveryQueue.map((row) => recoveryHeaders.map((header) => csvEscape(row[header])).join(",")).join("\n")}\n`);
  return {
    jsonPath,
    summaryPath,
    csvPath,
    backfillCandidatesPath,
    recoveryQueuePath,
    recoveryByBrandPath,
    recoveryQueueCsvPath,
  };
}

function previewForDiagnosticArtifact(preview) {
  const { productionCandidate, ...diagnosticPreview } = preview;
  return diagnosticPreview;
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
  buildEvidenceRecoveryByBrand,
  buildEvidenceRecoveryQueue,
  extractIngredientRows,
  extractIngredientRowsFromText,
  extractServingSizes,
  repairPreviewForRow,
  summarize,
};
