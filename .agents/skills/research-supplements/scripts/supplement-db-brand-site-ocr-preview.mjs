#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { normalizeItem } from "./supplement-db-brand-site-labels.mjs";
import {
  extractIngredientRows,
  extractServingSizes,
} from "./supplement-db-brand-site-repair-preview.mjs";

const DEFAULT_INPUT_PATH = "/tmp/murph-supplement-audit/brand_site_refetch_preview_candidates.json";
const DEFAULT_OUTPUT_DIR = "/tmp/murph-supplement-audit";
const DEFAULT_MODEL = "gpt-5-mini";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

function parseArgs(argv) {
  const options = {
    input: DEFAULT_INPUT_PATH,
    outputDir: DEFAULT_OUTPUT_DIR,
    source: null,
    limit: 25,
    model: process.env.OPENAI_SUPPLEMENT_OCR_MODEL || DEFAULT_MODEL,
    timeoutMs: 60_000,
    delayMs: 250,
    retries: 2,
    concurrency: 1,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") {
      options.input = requireArg(argv, index, arg);
      index += 1;
    } else if (arg === "--output-dir") {
      options.outputDir = requireArg(argv, index, arg);
      index += 1;
    } else if (arg === "--source") {
      options.source = requireArg(argv, index, arg);
      index += 1;
    } else if (arg === "--limit") {
      options.limit = parseIntegerOption(argv, index, arg, 1);
      index += 1;
    } else if (arg === "--model") {
      options.model = requireArg(argv, index, arg);
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
    } else if (arg === "--concurrency") {
      options.concurrency = parseIntegerOption(argv, index, arg, 1);
      index += 1;
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
  console.log(`Usage: node .agents/skills/research-supplements/scripts/supplement-db-brand-site-ocr-preview.mjs [options]

Options:
  --input <file>             Refetch preview candidates JSON.
                             Default: /tmp/murph-supplement-audit/brand_site_refetch_preview_candidates.json
  --source <slug>            Optional source slug filter.
  --limit <n>                Maximum image rows to process. Default: 25.
  --output-dir <dir>         Directory for preview artifacts. Default: /tmp/murph-supplement-audit
  --model <model>            OpenAI vision model. Default: ${DEFAULT_MODEL} or OPENAI_SUPPLEMENT_OCR_MODEL.
  --timeout-ms <n>           Per-request timeout. Default: 60000.
  --delay-ms <n>             Delay between image OCR requests. Default: 250.
  --retries <n>              Retries for temporary HTTP failures. Default: 2.
  --concurrency <n>          Maximum concurrent OCR requests. Default: 1.

This helper is read-only. It sends official facts image URLs from a refetch
preview artifact for OCR, writes local preview artifacts only, and never writes
the supplement database.
`);
}

function findEnvFiles() {
  let current = process.cwd();
  const files = [];
  while (true) {
    for (const name of [".env.local", ".env"]) {
      const candidate = join(current, name);
      if (existsSync(candidate)) files.push(candidate);
    }
    const parent = dirname(current);
    if (parent === current) return files;
    current = parent;
  }
}

function parseEnvValue(line, key) {
  const match = line.match(new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.*)$`, "u"));
  if (!match) return null;
  let value = match[1].trim();
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return value;
}

function getOpenAiApiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const envFiles = findEnvFiles();
  for (const envFile of envFiles) {
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/u)) {
      const value = parseEnvValue(line, "OPENAI_API_KEY");
      if (value) return value;
    }
  }
  throw new Error("OPENAI_API_KEY is missing from the environment and local env files.");
}

async function buildOcrPreview(options) {
  const inputRows = readJsonArray(options.input);
  const candidates = selectOcrInputRows(inputRows, options);
  const apiKey = getOpenAiApiKey();
  const { output, failures } = await processOcrCandidates({ candidates, apiKey, options });

  const summary = summarizeOcrPreview({
    inputRows: inputRows.length,
    eligibleRows: candidates.length,
    candidates: output,
    failures,
    model: options.model,
  });
  const artifacts = writeArtifacts(options.outputDir, { summary, candidates: output, failures });
  return { ...summary, artifacts };
}

async function processOcrCandidates({ candidates, apiKey, options }) {
  const output = [];
  const failures = [];
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      const index = cursor;
      cursor += 1;
      if (index > 0 && options.delayMs > 0) await sleep(options.delayMs);
      const candidate = candidates[index];
      const imageUrl = candidate.label?.factsImageUrls?.[0];
      if (!imageUrl) continue;
      try {
        const ocr = await callOpenAiFactsOcr({ apiKey, model: options.model, imageUrl, candidate, timeoutMs: options.timeoutMs, retries: options.retries });
        output.push(buildOcrCandidate(candidate, ocr, imageUrl, new Date().toISOString()));
      } catch (error) {
        failures.push({
          id: candidate.id,
          dataOriginId: candidate.dataOriginId,
          source: candidate.source,
          name: candidate.name,
          imageUrl,
          reason: "ocr_request_failed",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const workerCount = Math.min(options.concurrency, candidates.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  output.sort((left, right) => String(left.dataOriginId).localeCompare(String(right.dataOriginId)));
  failures.sort((left, right) => String(left.dataOriginId).localeCompare(String(right.dataOriginId)));
  return { output, failures };
}

function readJsonArray(file) {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`Expected ${file} to contain a JSON array.`);
  return parsed;
}

function selectOcrInputRows(rows, options) {
  const selected = [];
  for (const row of rows) {
    if (options.source && row.source !== options.source) continue;
    if (!Array.isArray(row.label?.factsImageUrls) || row.label.factsImageUrls.length === 0) continue;
    if (row.refetchPreview?.dsldUpcHydrated === true) continue;
    selected.push(row);
    if (selected.length >= options.limit) break;
  }
  return selected;
}

async function callOpenAiFactsOcr({ apiKey, model, imageUrl, candidate, timeoutMs, retries }) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await callOpenAiFactsOcrOnce({ apiKey, model, imageUrl, candidate, timeoutMs });
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isRetryableError(error)) break;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastError;
}

async function callOpenAiFactsOcrOnce({ apiKey, model, imageUrl, candidate, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildOpenAiOcrRequest({ model, imageUrl, candidate })),
    });
    const text = await response.text();
    if (!response.ok) {
      const status = response.status;
      const detail = safeJsonMessage(text) ?? `OpenAI OCR request failed with HTTP ${status}`;
      const error = new Error(detail);
      error.status = status;
      throw error;
    }
    return parseOpenAiOcrResponse(JSON.parse(text));
  } finally {
    clearTimeout(timeout);
  }
}

function buildOpenAiOcrRequest({ model, imageUrl, candidate }) {
  return {
    model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "Extract only the visible Supplement Facts or Nutrition Facts panel from this official product label image.",
              "Return JSON only. Do not infer missing ingredients, serving sizes, amounts, or daily values.",
              "If the image does not contain a facts panel, return imageContainsFactsPanel=false and factsText=null.",
              `Product: ${candidate.name ?? ""}`,
              `Variant: ${candidate.label?.variant?.title ?? ""}`,
              "JSON keys: imageContainsFactsPanel, confidence, factsText, servingSize, servingsPerContainer, otherIngredients, warnings.",
            ].join("\n"),
          },
          {
            type: "input_image",
            image_url: imageUrl,
            detail: "high",
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "supplement_facts_ocr",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["imageContainsFactsPanel", "confidence", "factsText", "servingSize", "servingsPerContainer", "otherIngredients", "warnings"],
          properties: {
            imageContainsFactsPanel: { type: "boolean" },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            factsText: { type: ["string", "null"] },
            servingSize: { type: ["string", "null"] },
            servingsPerContainer: { type: ["string", "null"] },
            otherIngredients: { type: ["string", "null"] },
            warnings: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
      },
    },
  };
}

function parseOpenAiOcrResponse(response) {
  const text = extractResponseText(response);
  if (!text) throw new Error("OpenAI OCR response did not include output text.");
  return parseOcrJson(text);
}

function extractResponseText(response) {
  if (typeof response?.output_text === "string") return response.output_text;
  const output = Array.isArray(response?.output) ? response.output : [];
  const parts = [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const entry of content) {
      if (typeof entry?.text === "string") parts.push(entry.text);
    }
  }
  return parts.join("\n").trim();
}

function parseOcrJson(text) {
  const trimmed = String(text).trim();
  const jsonText = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim()
    : trimmed;
  const parsed = JSON.parse(jsonText);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("OCR JSON must be an object.");
  return {
    imageContainsFactsPanel: parsed.imageContainsFactsPanel === true,
    confidence: typeof parsed.confidence === "string" ? parsed.confidence : "low",
    factsText: typeof parsed.factsText === "string" && parsed.factsText.trim() ? parsed.factsText.trim() : null,
    servingSize: typeof parsed.servingSize === "string" && parsed.servingSize.trim() ? parsed.servingSize.trim() : null,
    servingsPerContainer: typeof parsed.servingsPerContainer === "string" && parsed.servingsPerContainer.trim() ? parsed.servingsPerContainer.trim() : null,
    otherIngredients: typeof parsed.otherIngredients === "string" && parsed.otherIngredients.trim() ? parsed.otherIngredients.trim() : null,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((warning) => typeof warning === "string" && warning.trim()).map((warning) => warning.trim()) : [],
  };
}

function buildOcrCandidate(candidate, ocr, imageUrl, fetchedAt = new Date().toISOString()) {
  const factsText = ocr.imageContainsFactsPanel && ocr.factsText ? ocr.factsText : null;
  const labelForParsing = factsText ? { factsText } : {};
  const ingredientRows = factsText ? extractIngredientRows(labelForParsing) : [];
  const servingSizes = factsText ? extractServingSizes(labelForParsing, {
    productName: candidate.name,
    ingredientRows,
  }) : [];
  const needsManualReview = (
    !factsText
    || ocr.confidence === "low"
    || ingredientRows.length === 0
    || servingSizes.length === 0
  );
  const label = {
    ...candidate.label,
    source: "official_facts_image_ocr_preview",
    sourceFetchedAt: fetchedAt,
    evidenceStatus: needsManualReview ? "needs_structured_facts_from_ocr" : "structured_facts_from_official_facts_image_ocr",
    needsManualReview,
    ocrSource: {
      imageUrl,
      confidence: ocr.confidence,
      warnings: ocr.warnings,
    },
    ...(factsText ? { factsText } : {}),
    ...(ingredientRows.length > 0 ? { ingredientRows } : {}),
    ...(servingSizes.length > 0 ? { servingSizes } : {}),
    ...(ocr.servingSize ? { ocrServingSizeText: ocr.servingSize } : {}),
    ...(ocr.servingsPerContainer ? { servingsPerContainer: ocr.servingsPerContainer } : {}),
    ...(ocr.otherIngredients ? { otherIngredients: ocr.otherIngredients } : {}),
  };
  const normalized = normalizeItem({
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
    ...normalized,
    ocrPreview: {
      imageUrl,
      confidence: ocr.confidence,
      imageContainsFactsPanel: ocr.imageContainsFactsPanel,
      warnings: ocr.warnings,
      parsedIngredientRows: ingredientRows.length,
      parsedServingSizes: servingSizes.length,
      promoted: normalized.reviewIssues.length === 0,
    },
  };
}

function summarizeOcrPreview({ inputRows, eligibleRows, candidates, failures, model }) {
  return {
    schemaVersion: 1,
    model,
    inputRows,
    eligibleImageRows: eligibleRows,
    candidates: candidates.length,
    productionReadyCandidates: candidates.filter((candidate) => candidate.reviewIssues.length === 0).length,
    needsManualReviewCandidates: candidates.filter((candidate) => candidate.label?.needsManualReview === true).length,
    imageContainsFactsPanel: candidates.filter((candidate) => candidate.ocrPreview?.imageContainsFactsPanel === true).length,
    highConfidenceOcr: candidates.filter((candidate) => candidate.ocrPreview?.confidence === "high").length,
    failures: failures.length,
    failureReasons: countBy(failures.map((failure) => failure.reason)),
  };
}

function countBy(values) {
  const output = {};
  for (const value of values) output[value] = (output[value] ?? 0) + 1;
  return output;
}

function writeArtifacts(outputDir, { summary, candidates, failures }) {
  mkdirSync(outputDir, { recursive: true });
  const summaryPath = join(outputDir, "brand_site_ocr_preview_summary.json");
  const candidatesPath = join(outputDir, "brand_site_ocr_preview_candidates.json");
  const failuresPath = join(outputDir, "brand_site_ocr_preview_failures.json");
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(candidatesPath, `${JSON.stringify(candidates, null, 2)}\n`);
  writeFileSync(failuresPath, `${JSON.stringify(failures, null, 2)}\n`);
  return { summaryPath, candidatesPath, failuresPath };
}

function safeJsonMessage(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed?.error?.message ?? parsed?.message ?? null;
  } catch {
    return null;
  }
}

function isRetryableError(error) {
  const status = error?.status;
  return status === 408 || status === 409 || status === 429 || (typeof status === "number" && status >= 500);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await buildOcrPreview(options);
  console.log(JSON.stringify(result, null, 2));
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
  buildOcrCandidate,
  buildOpenAiOcrRequest,
  buildOcrPreview,
  parseOcrJson,
  selectOcrInputRows,
  summarizeOcrPreview,
};
