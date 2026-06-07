#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { getDbUrl, normalizeItem, runPsql } from "./supplement-db-brand-site-labels.mjs";
import {
  extractIngredientRows,
  extractServingSizes,
} from "./supplement-db-brand-site-repair-preview.mjs";

const DEFAULT_QUEUE_PATH = "/tmp/murph-supplement-audit/brand_site_evidence_recovery_queue.json";
const DEFAULT_OUTPUT_DIR = "/tmp/murph-supplement-audit";
const USER_AGENT = "Murph supplement-label-refetch-preview/1.0";
const FACTS_TEXT_MAX_LENGTH = 6000;

function parseArgs(argv) {
  const options = {
    queue: DEFAULT_QUEUE_PATH,
    outputDir: DEFAULT_OUTPUT_DIR,
    source: null,
    action: null,
    limit: 25,
    timeoutMs: 20_000,
    delayMs: 250,
    retries: 2,
    hydrateDsldUpc: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--queue") {
      options.queue = requireArg(argv, index, arg);
      index += 1;
    } else if (arg === "--output-dir") {
      options.outputDir = requireArg(argv, index, arg);
      index += 1;
    } else if (arg === "--source") {
      options.source = requireArg(argv, index, arg);
      index += 1;
    } else if (arg === "--action") {
      options.action = requireArg(argv, index, arg);
      index += 1;
    } else if (arg === "--limit") {
      options.limit = parseIntegerOption(argv, index, arg, 1);
      index += 1;
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = parseIntegerOption(argv, index, arg, 1000);
      index += 1;
    } else if (arg === "--delay-ms") {
      options.delayMs = parseIntegerOption(argv, index, arg, 0);
      index += 1;
    } else if (arg === "--retries") {
      options.retries = parseIntegerOption(argv, index, arg, 0);
      index += 1;
    } else if (arg === "--hydrate-dsld-upc") {
      options.hydrateDsldUpc = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function parseIntegerOption(argv, index, name, min) {
  const value = Number.parseInt(requireArg(argv, index, name), 10);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} requires an integer >= ${min}`);
  }
  return value;
}

function requireArg(argv, index, name) {
  const value = argv[index + 1];
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function printHelp() {
  console.log(`Usage: node .agents/skills/research-supplements/scripts/supplement-db-brand-site-refetch-preview.mjs [options]

Options:
  --queue <file>             Recovery queue JSON from repair preview.
                             Default: /tmp/murph-supplement-audit/brand_site_evidence_recovery_queue.json
  --source <slug>            Optional source slug filter.
  --action <action>          Optional recovery action filter.
  --limit <n>                Maximum queue rows to process. Default: 25.
  --output-dir <dir>         Directory for preview artifacts. Default: /tmp/murph-supplement-audit
  --timeout-ms <n>           Per-request timeout. Default: 20000.
  --delay-ms <n>             Delay between unique product JSON fetches. Default: 250.
  --retries <n>              Retries for temporary HTTP failures. Default: 2.
  --hydrate-dsld-upc         Read-only DB lookup: copy structured DSLD facts into
                             candidates when the current official variant has an exact UPC match.

This helper is read-only. It fetches official source evidence and writes local
preview artifacts only; it never writes the supplement database.
`);
}

function readQueue(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("Recovery queue JSON must be an array.");
  return parsed;
}

function selectQueueRows(queue, options) {
  return queue
    .filter((row) => !options.source || row.source === options.source)
    .filter((row) => !options.action || row.action === options.action)
    .filter((row) => typeof row.dataOriginUrl === "string" && row.dataOriginUrl.trim() !== "")
    .slice(0, options.limit);
}

function shopifyJsonUrlForProductUrl(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const match = url.pathname.match(/^(.*\/products\/[^/.?#/]+)(?:\/)?$/u);
  if (!match) return null;
  url.pathname = `${match[1]}.js`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json,text/javascript;q=0.9,*/*;q=0.1",
        "user-agent": USER_AGENT,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonWithRetry(url, options) {
  let lastError = null;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      return await fetchJson(url, options.timeoutMs);
    } catch (error) {
      lastError = error;
      if (!isRetryableFetchError(error) || attempt >= options.retries) break;
      await sleep(Math.max(1000, options.delayMs * 4) * (attempt + 1));
    }
  }
  throw lastError;
}

function isRetryableFetchError(error) {
  const status = typeof error?.status === "number" ? error.status : null;
  return status === 429 || (status !== null && status >= 500);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function buildRefetchPreview(options) {
  const queue = readQueue(options.queue);
  const rows = selectQueueRows(queue, options);
  const productCache = new Map();
  const candidates = [];
  const failures = [];
  let nextFetchAt = 0;

  for (const row of rows) {
    const jsonUrl = shopifyJsonUrlForProductUrl(row.dataOriginUrl);
    if (!jsonUrl) {
      failures.push(failureForRow(row, "unsupported_url", "Only Shopify product URLs are supported by this preview helper today."));
      continue;
    }

    let productResult = productCache.get(jsonUrl);
    if (!productResult) {
      try {
        const waitMs = nextFetchAt - Date.now();
        if (waitMs > 0) await sleep(waitMs);
        productResult = { ok: true, product: await fetchJsonWithRetry(jsonUrl, options) };
      } catch (error) {
        productResult = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        nextFetchAt = Date.now() + options.delayMs;
      }
      productCache.set(jsonUrl, productResult);
    }

    if (!productResult.ok) {
      failures.push(failureForRow(row, "fetch_failed", productResult.error));
      continue;
    }

    const candidate = buildShopifyEvidenceCandidate(row, productResult.product);
    if (candidate) {
      candidates.push(candidate);
    } else {
      failures.push(failureForRow(row, "variant_match_failed", "Could not match the queue row to a Shopify variant."));
    }
  }

  const hydratedCandidates = options.hydrateDsldUpc
    ? hydrateCandidatesFromDsldByUpc(candidates, getDbUrl())
    : candidates;
  const summary = summarizePreview({
    rowsReviewed: rows.length,
    productUrlsFetched: [...productCache.values()].filter((entry) => entry.ok).length,
    productFetchFailures: [...productCache.values()].filter((entry) => !entry.ok).length,
    candidates: hydratedCandidates,
    failures,
    dsldUpcHydrationEnabled: options.hydrateDsldUpc,
  });
  const artifacts = writeArtifacts(options.outputDir, { summary, candidates: hydratedCandidates, failures });
  return { ...summary, artifacts };
}

function failureForRow(row, reason, detail) {
  return {
    source: row.source ?? null,
    sourceId: row.sourceId ?? null,
    id: row.id ?? null,
    dataOriginId: row.dataOriginId ?? null,
    name: row.name ?? null,
    dataOriginUrl: row.dataOriginUrl ?? null,
    reason,
    detail,
  };
}

function buildShopifyEvidenceCandidate(queueRow, product, fetchedAt = new Date().toISOString()) {
  const variant = matchShopifyVariantForQueueRow(queueRow, product);
  if (!variant) return null;

  const factsText = extractFactsTextFromShopifyProduct(product);
  const productFactsPromotionBlockedReason = productFactsPromotionBlockedReasonForProduct(product, factsText);
  const canParseProductFacts = factsText && !productFactsPromotionBlockedReason;
  const labelForParsing = canParseProductFacts ? { factsText } : {};
  const ingredientRows = canParseProductFacts ? extractIngredientRows(labelForParsing) : [];
  const servingSizes = canParseProductFacts ? extractServingSizes(labelForParsing, {
    productName: queueRow.name,
    ingredientRows,
  }) : [];
  const factsMedia = selectShopifyFactsMedia(product, variant);
  const needsManualReview = Boolean(productFactsPromotionBlockedReason) || ingredientRows.length === 0 || servingSizes.length === 0;
  const source = requireQueueString(queueRow.source, "source");
  const sourceId = requireQueueString(queueRow.sourceId, "sourceId");
  const dataOriginId = requireQueueString(queueRow.dataOriginId ?? queueRow.id ?? `${source}:${sourceId}`, "dataOriginId");
  const item = normalizeItem({
    id: dataOriginId,
    dataOrigin: "brand_site",
    dataOriginId,
    dataOriginUrl: queueRow.dataOriginUrl,
    source,
    sourceId,
    name: queueRow.name || variant.name || product.title,
    brand: queueRow.brand || product.vendor || null,
    upc: variant.barcode,
    label: {
      schemaVersion: 1,
      source: "official_refetch_preview",
      sourceId,
      sourceUrl: queueRow.dataOriginUrl,
      sourceFetchedAt: fetchedAt,
      evidenceStatus: needsManualReview ? "needs_structured_facts" : "structured_facts_from_official_page",
      needsManualReview,
      productType: product.type || null,
      netContents: variant.public_title || variant.title || null,
      variant: shopifyVariantSummary(variant),
      ...(factsText && !factsTextContaminationReason(factsText) ? { factsText } : {}),
      ...(ingredientRows.length > 0 ? { ingredientRows } : {}),
      ...(servingSizes.length > 0 ? { servingSizes } : {}),
      ...(factsMedia.length > 0 ? { factsImageUrls: factsMedia.map((media) => media.url), factsImages: factsMedia } : {}),
    },
  });

  return {
    ...item,
    refetchPreview: {
      inputAction: queueRow.action ?? null,
      inputEvidenceRecoveryHint: queueRow.evidenceRecoveryHint ?? null,
      inputParserBlockers: Array.isArray(queueRow.parserBlockers) ? queueRow.parserBlockers : [],
      productJsonUrl: shopifyJsonUrlForProductUrl(queueRow.dataOriginUrl),
      factsMediaCount: factsMedia.length,
      productFactsPromotionBlockedReason,
    },
  };
}

function hydrateCandidatesFromDsldByUpc(candidates, dbUrl) {
  const upcs = uniqueStrings(candidates.map((candidate) => candidate.upc).filter(Boolean));
  if (upcs.length === 0) return candidates;
  const output = runPsql(dbUrl, buildDsldStructuredFactsByUpcSql(upcs));
  const factsByUpc = parsePsqlJsonObject(output, "dsld_facts");
  return hydrateCandidatesWithDsldFacts(candidates, factsByUpc);
}

function buildDsldStructuredFactsByUpcSql(upcs) {
  if (!Array.isArray(upcs) || upcs.length === 0) {
    return "select '{}'::jsonb::text as dsld_facts;";
  }
  const values = uniqueStrings(upcs).map((upc) => `('${sqlString(upc)}')`).join(",\n    ");
  return `with input(upc) as (
    values
    ${values}
  ), matched as (
    select distinct on (i.upc)
      i.upc,
      jsonb_build_object(
        'id', s.id,
        'canonicalKey', s.canonical_key,
        'name', s.name,
        'brand', s.brand,
        'upc', s.upc,
        'label', s.label
      ) as payload
    from input i
    join supplements s on s.data_origin = 'dsld'
      and s.upc = i.upc
    where jsonb_typeof(s.label->'ingredientRows') = 'array'
      and jsonb_array_length(s.label->'ingredientRows') > 0
      and jsonb_typeof(s.label->'servingSizes') = 'array'
      and jsonb_array_length(s.label->'servingSizes') > 0
    order by i.upc, s.imported_at desc, s.id
  )
  select coalesce(jsonb_object_agg(upc, payload), '{}'::jsonb)::text as dsld_facts
  from matched;`;
}

function hydrateCandidatesWithDsldFacts(candidates, factsByUpc) {
  if (!factsByUpc || typeof factsByUpc !== "object" || Array.isArray(factsByUpc)) return candidates;
  return candidates.map((candidate) => {
    const facts = candidate.upc ? factsByUpc[candidate.upc] : null;
    return applyDsldStructuredFacts(candidate, facts);
  });
}

function applyDsldStructuredFacts(candidate, facts) {
  if (!isHydratableDsldFacts(facts)) return candidate;
  const dsldLabel = facts.label;
  const otherIngredients = dsldLabel.otherIngredients ?? dsldLabel.otheringredients;
  const label = {
    ...candidate.label,
    evidenceStatus: "structured_facts_from_exact_dsld_upc_match",
    needsManualReview: false,
    ingredientRows: dsldLabel.ingredientRows,
    servingSizes: dsldLabel.servingSizes,
    ...(otherIngredients !== undefined ? { otherIngredients } : {}),
    ...(dsldLabel.servingsPerContainer !== undefined ? { servingsPerContainer: dsldLabel.servingsPerContainer } : {}),
    ...(dsldLabel.percentDvFootnote !== undefined ? { percentDvFootnote: dsldLabel.percentDvFootnote } : {}),
    ...(dsldLabel.netContents !== undefined ? { dsldNetContents: dsldLabel.netContents } : {}),
    structuredFactsSource: {
      dataOrigin: "dsld",
      id: String(facts.id),
      canonicalKey: facts.canonicalKey ?? null,
      upc: facts.upc ?? candidate.upc ?? null,
      matchedBy: "exact_upc",
    },
  };
  const hydrated = normalizeItem({
    id: candidate.id,
    dataOrigin: candidate.dataOrigin,
    dataOriginId: candidate.dataOriginId,
    dataOriginUrl: candidate.dataOriginUrl,
    source: candidate.source,
    sourceId: candidate.sourceId,
    name: candidate.name,
    brand: candidate.brand,
    upc: candidate.upc,
    offMarket: candidate.offMarket,
    label,
  });
  return {
    ...hydrated,
    refetchPreview: {
      ...candidate.refetchPreview,
      dsldUpcHydrated: true,
      dsldStructuredFactsSource: label.structuredFactsSource,
    },
  };
}

function isHydratableDsldFacts(value) {
  const label = value?.label;
  return Boolean(
    value
      && typeof value === "object"
      && !Array.isArray(value)
      && label
      && typeof label === "object"
      && !Array.isArray(label)
      && Array.isArray(label.ingredientRows)
      && label.ingredientRows.length > 0
      && Array.isArray(label.servingSizes)
      && label.servingSizes.length > 0,
  );
}

function parsePsqlJsonObject(output, columnName) {
  const lines = String(output).split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const columnIndex = lines.indexOf(columnName);
  const value = columnIndex >= 0 ? lines[columnIndex + 1] : lines.find((line) => line.startsWith("{"));
  if (!value) throw new Error(`psql output did not include ${columnName}`);
  return JSON.parse(value);
}

function sqlString(value) {
  return String(value).replace(/'/gu, "''");
}

function requireQueueString(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Queue row is missing ${field}`);
  return value.trim();
}

function shopifyVariantSummary(variant) {
  return {
    id: variant.id ?? null,
    title: variant.title ?? null,
    publicTitle: variant.public_title ?? null,
    sku: variant.sku ?? null,
    barcode: variant.barcode ?? null,
    available: typeof variant.available === "boolean" ? variant.available : null,
    options: Array.isArray(variant.options) ? variant.options : [],
  };
}

function matchShopifyVariantForQueueRow(queueRow, product) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  if (variants.length === 0) return null;

  const candidates = variantCandidateTexts(queueRow);
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeMatchText(candidate);
    if (!normalizedCandidate) continue;
    const exact = variants.find((variant) => variantTexts(variant).some((text) => normalizeMatchText(text) === normalizedCandidate));
    if (exact) return exact;
  }

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeMatchText(candidate);
    if (!normalizedCandidate) continue;
    const fuzzy = variants.find((variant) => variantTexts(variant).some((text) => {
      const normalizedText = normalizeMatchText(text);
      return normalizedText && (normalizedText.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedText));
    }));
    if (fuzzy) return fuzzy;
  }

  if (variants.length === 1 && candidates.length === 0) return variants[0];
  return null;
}

function variantCandidateTexts(queueRow) {
  const candidates = [];
  const sourceId = typeof queueRow.sourceId === "string" ? queueRow.sourceId : "";
  const split = sourceId.split("--").filter(Boolean);
  if (split.length > 1) candidates.push(split.at(-1).replace(/-/gu, " "));
  const name = typeof queueRow.name === "string" ? queueRow.name : "";
  const dashMatch = name.match(/\s[-–]\s(.+)$/u);
  if (dashMatch) candidates.push(dashMatch[1]);
  const countMatch = name.match(/\b(\d+(?:\.\d+)?)\s*(count|ct|capsules?|tablets?|softgels?|veggie capsules?|vegetable capsules?|gummies?|servings?)\b/iu);
  if (countMatch) candidates.push(`${countMatch[1]} ${countMatch[2]}`);
  return uniqueStrings(candidates);
}

function variantTexts(variant) {
  return uniqueStrings([
    variant?.title,
    variant?.public_title,
    variant?.option1,
    variant?.option2,
    variant?.option3,
    ...(Array.isArray(variant?.options) ? variant.options : []),
  ]);
}

function uniqueStrings(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    output.push(trimmed);
  }
  return output;
}

function normalizeMatchText(value) {
  if (typeof value !== "string") return "";
  return value
    .toLowerCase()
    .replace(/&nbsp;/gu, " ")
    .replace(/\bct\b/gu, "count")
    .replace(/\bveggie\b/gu, "vegetable")
    .replace(/[^a-z0-9.]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function selectShopifyFactsMedia(product, variant) {
  const media = Array.isArray(product?.media) ? product.media : [];
  const variantTextsForMatch = variantTexts(variant).map(normalizeMatchText).filter(Boolean);
  const requiresVariantMatch = Array.isArray(product?.variants) && product.variants.length > 1 && variantTextsForMatch.length > 0;
  const scored = [];
  for (const entry of media) {
    const url = mediaUrl(entry);
    if (!url) continue;
    const haystack = normalizeMatchText([
      entry.alt,
      url,
      entry.preview_image?.src,
    ].filter(Boolean).join(" "));
    const rawHaystack = [
      entry.alt,
      url,
      entry.preview_image?.src,
    ].filter(Boolean).join(" ").toLowerCase();
    let score = 0;
    const hasSupplementFactsSignal = /\bsupp(?:lement)?[\s_-]*facts?\b/u.test(rawHaystack) || /[_-]supp[_-]/u.test(rawHaystack);
    const hasFactsPanelSignal = /\bfacts?\s*panel\b/u.test(rawHaystack);
    const hasNutritionFactsSignal = /\bnutrition[\s_-]*facts?\b/u.test(rawHaystack);
    const hasSfpFilenameSignal = /(?:^|[\s_/-])sfp(?:[\s_./-]|$)/u.test(rawHaystack);
    const hasFactsSignal = hasSupplementFactsSignal || hasFactsPanelSignal || hasNutritionFactsSignal || hasSfpFilenameSignal;
    const variantMatched = variantTextsForMatch.length === 0 || variantTextsForMatch.some((text) => haystack.includes(text));
    if (!hasFactsSignal || (requiresVariantMatch && !variantMatched)) continue;
    if (hasSupplementFactsSignal) score += 8;
    if (hasFactsPanelSignal) score += 5;
    if (hasNutritionFactsSignal) score += 4;
    if (hasSfpFilenameSignal) score += 7;
    if (variantMatched) score += 3;
    if (entry.media_type && entry.media_type !== "image") score -= 10;
    if (score > 0) {
      scored.push({
        url,
        alt: typeof entry.alt === "string" ? entry.alt : null,
        position: Number.isFinite(entry.position) ? entry.position : null,
        width: Number.isFinite(entry.width) ? entry.width : entry.preview_image?.width ?? null,
        height: Number.isFinite(entry.height) ? entry.height : entry.preview_image?.height ?? null,
        score,
      });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || (a.position ?? 9999) - (b.position ?? 9999))
    .filter((entry, index, entries) => index === 0 || entry.score === entries[0].score)
    .slice(0, 3);
}

function mediaUrl(entry) {
  const value = entry?.src ?? entry?.preview_image?.src;
  if (typeof value !== "string" || value.trim() === "") return null;
  if (value.startsWith("//")) return `https:${value}`;
  return value;
}

function extractFactsTextFromShopifyProduct(product) {
  const text = htmlToText(product?.description ?? "");
  const factsStart = text.search(/\b(?:supplement|nutrition)\s+facts\b/iu);
  if (factsStart === -1) return null;
  const bounded = text.slice(Math.max(0, factsStart), factsStart + FACTS_TEXT_MAX_LENGTH).trim();
  return bounded || null;
}

function productFactsPromotionBlockedReasonForProduct(product, factsText) {
  if (!factsText) return "missing_product_facts_text";
  const contaminationReason = factsTextContaminationReason(factsText);
  if (contaminationReason) return contaminationReason;
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  if (variants.length > 1) return "shared_product_facts_for_multiple_variants";
  return null;
}

function factsTextContaminationReason(text) {
  if (typeof text !== "string" || text.trim() === "") return "missing_product_facts_text";
  if (text.length > 3000) return "facts_text_too_long_for_automatic_promotion";
  if (/\b(?:add to cart|buy now|reviews?|customers also|you may also like|related products|recently viewed|shipping|returns?|faq|subscribe and save|complete your stack|shopify|quantity)\b/iu.test(text)) {
    return "facts_text_page_body_marker";
  }
  return null;
}

function htmlToText(value) {
  if (typeof value !== "string" || value.trim() === "") return "";
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, "\"")
    .replace(/&#39;/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

function summarizePreview({ rowsReviewed, productUrlsFetched, productFetchFailures, candidates, failures, dsldUpcHydrationEnabled = false }) {
  const productionReadyCandidates = candidates.filter((candidate) => candidate.reviewIssues.length === 0).length;
  const needsManualReviewCandidates = candidates.filter((candidate) => candidate.label?.needsManualReview === true).length;
  const factsImageCandidates = candidates.filter((candidate) => Array.isArray(candidate.label?.factsImageUrls) && candidate.label.factsImageUrls.length > 0).length;
  const dsldUpcHydratedCandidates = candidates.filter((candidate) => candidate.refetchPreview?.dsldUpcHydrated === true).length;
  const byReason = {};
  for (const failure of failures) {
    byReason[failure.reason] = (byReason[failure.reason] ?? 0) + 1;
  }
  return {
    schemaVersion: 1,
    rowsReviewed,
    productUrlsFetched,
    productFetchFailures,
    candidates: candidates.length,
    productionReadyCandidates,
    needsManualReviewCandidates,
    factsImageCandidates,
    dsldUpcHydrationEnabled,
    dsldUpcHydratedCandidates,
    failures: failures.length,
    failureReasons: byReason,
  };
}

function writeArtifacts(outputDir, { summary, candidates, failures }) {
  mkdirSync(outputDir, { recursive: true });
  const summaryPath = join(outputDir, "brand_site_refetch_preview_summary.json");
  const candidatesPath = join(outputDir, "brand_site_refetch_preview_candidates.json");
  const failuresPath = join(outputDir, "brand_site_refetch_preview_failures.json");
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(candidatesPath, `${JSON.stringify(candidates, null, 2)}\n`);
  writeFileSync(failuresPath, `${JSON.stringify(failures, null, 2)}\n`);
  return { summaryPath, candidatesPath, failuresPath };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const summary = await buildRefetchPreview(options);
  console.log(JSON.stringify(summary, null, 2));
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
  buildRefetchPreview,
  buildShopifyEvidenceCandidate,
  buildDsldStructuredFactsByUpcSql,
  extractFactsTextFromShopifyProduct,
  factsTextContaminationReason,
  hydrateCandidatesWithDsldFacts,
  matchShopifyVariantForQueueRow,
  productFactsPromotionBlockedReasonForProduct,
  selectQueueRows,
  selectShopifyFactsMedia,
  shopifyJsonUrlForProductUrl,
  variantCandidateTexts,
};
