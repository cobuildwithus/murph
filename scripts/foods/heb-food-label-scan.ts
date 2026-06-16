import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HEB_SEARCH_TERMS = [
  "milk",
  "bread",
  "eggs",
  "cheese",
  "yogurt",
  "butter",
  "chicken",
  "beef",
  "pork",
  "turkey",
  "sausage",
  "bacon",
  "shrimp",
  "salmon",
  "tuna",
  "rice",
  "beans",
  "pasta",
  "sauce",
  "soup",
  "cereal",
  "oatmeal",
  "granola",
  "chips",
  "crackers",
  "cookies",
  "salsa",
  "tortillas",
  "hummus",
  "dip",
  "pizza",
  "frozen meal",
  "ice cream",
  "vegetables",
  "fruit",
  "juice",
  "coffee",
  "tea",
  "water",
  "ketchup",
  "mustard",
  "mayo",
  "dressing",
  "peanut butter",
  "flour",
  "sugar",
  "cake mix",
  "snack",
  "salad kit",
  "meal simple",
];

const HEB_ORIGIN = "brand_site";
const HEB_ORIGIN_PRIORITY = 20;
const DEFAULT_LIMIT = 250;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_OUTPUT_DIR = path.join("research-artifacts", "foods", "heb");
const READER_BASE_URL = "https://r.jina.ai/http://";

export interface HebScanOptions {
  limit?: number;
  concurrency?: number;
  outputDir?: string;
  searchTerms?: string[];
  productUrls?: string[];
  fetchMarkdown?: (url: string) => Promise<string>;
  progress?: (message: string) => void;
  now?: Date;
}

export interface HebNutritionNutrient {
  name: string;
  amount?: string;
  dailyValue?: string;
}

export interface HebNutritionPanel {
  servingSize?: string;
  servingsPerContainer?: string;
  calories?: string;
  nutrients: HebNutritionNutrient[];
  rawText: string;
}

export interface HebFoodCandidate {
  id: string;
  canonicalKey: string;
  dataOrigin: string;
  dataOriginId: string;
  dataOriginUrl: string;
  dataOriginPriority: number;
  name: string;
  brand: string | null;
  upc: string | null;
  offMarket: boolean;
  searchText: string;
  label: {
    source: "heb";
    sourceFetchedAt: string;
    productId: string;
    productUrl: string;
    pageTitle?: string;
    size?: string;
    categoryPath: string[];
    description?: string;
    highlights?: string[];
    ingredients?: string;
    allergensAndWarnings?: string;
    nutritionFacts: {
      panels: HebNutritionPanel[];
    };
    rawEvidence: {
      reader: "jina";
      nutritionFactsAndIngredients?: string;
    };
  };
  fdcReleaseDate: string;
  reviewIssues: string[];
}

export interface HebScanSummary {
  requestedLimit: number;
  discoveredProductUrls: number;
  attemptedProducts: number;
  scannedProducts: number;
  discoveryFailedTerms: number;
  fetchFailedProducts: number;
  parseableProducts: number;
  productionReadyCandidates: number;
  withIngredients: number;
  withNutritionFacts: number;
  withServingSize: number;
  withCalories: number;
  withCategoryPath: number;
  withSize: number;
  withUpc: number;
  multiPanelNutritionFacts: number;
  issueCounts: Record<string, number>;
  outputJsonl?: string;
  outputSummary?: string;
  outputFailures?: string;
}

export interface HebScanResult {
  candidates: HebFoodCandidate[];
  failures: HebScanFailure[];
  summary: HebScanSummary;
}

export interface HebScanFailure {
  productUrl: string;
  message: string;
}

interface CliOptions extends HebScanOptions {
  summaryOnly: boolean;
}

interface DiscoveryResult {
  urls: string[];
  failedTerms: Array<{ term: string; error: string }>;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\u2011/g, "-").replace(/\s+/gu, " ").trim();
}

function cleanMarkdownText(value: string): string {
  return normalizeWhitespace(
    value
      .trim()
      .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
      .replace(/!\[([^\]]*)\]\([^)]+\)/gu, "$1")
      .replace(/^[-*]\s*/gu, "")
      .replace(/^#+\s*/gu, "")
      .replace(/\*\*/gu, "")
      .replace(/_/gu, ""),
  );
}

function keyText(value: string): string {
  return normalizeWhitespace(value.toLowerCase().replace(/[^a-z0-9]+/gu, " "));
}

function compactSearchText(parts: Array<string | null | undefined>): string {
  return normalizeWhitespace(parts.filter(Boolean).join(" ")).slice(0, 8000);
}

export function normalizeHebProductUrl(url: string): string | null {
  const match = url.match(/^https:\/\/www\.heb\.com\/product-detail\/[^)\s#?]+\/(\d+)(?:[?#][^\s)]*)?/u);
  if (!match) return null;
  const parsed = new URL(url);
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

export function productIdFromHebUrl(url: string): string | null {
  return normalizeHebProductUrl(url)?.match(/\/(\d+)$/u)?.[1] ?? null;
}

export function extractHebProductUrls(markdown: string): string[] {
  const urls = new Set<string>();
  const regex = /https:\/\/www\.heb\.com\/product-detail\/[^)\s#?]+\/\d+(?:[?#][^\s)]*)?/gu;
  for (const match of markdown.matchAll(regex)) {
    const normalized = normalizeHebProductUrl(match[0]);
    if (normalized) urls.add(normalized);
  }
  return [...urls];
}

function readerUrlFor(targetUrl: string): string {
  return `${READER_BASE_URL}${targetUrl}`;
}

async function fetchReaderMarkdown(targetUrl: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetchReaderMarkdownOnce(targetUrl);
    } catch (error: unknown) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchReaderMarkdownOnce(targetUrl: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(readerUrlFor(targetUrl), {
      signal: controller.signal,
      headers: {
        "user-agent": "Murph H-E-B label feasibility scanner",
      },
    });
    if (!response.ok) {
      throw new Error(`reader fetch failed ${response.status} for ${targetUrl}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function linesOf(markdown: string): string[] {
  return markdown.split(/\r?\n/u).map((line) => line.trimEnd());
}

function firstLineAfter(lines: string[], index: number): string | undefined {
  for (let i = index + 1; i < lines.length; i += 1) {
    const cleaned = cleanMarkdownText(lines[i] ?? "");
    if (cleaned) return cleaned;
  }
  return undefined;
}

function extractPageTitle(lines: string[]): string | undefined {
  const title = lines.find((line) => line.startsWith("Title: "))?.replace(/^Title:\s*/u, "");
  return title ? cleanMarkdownText(title) : undefined;
}

function stripHebTitleSuffix(title: string): string {
  return cleanMarkdownText(title.replace(/\s+-\s+Shop\b.*$/u, ""));
}

function productHeading(lines: string[]): { name: string; index: number } | undefined {
  const headings = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^#\s+\S/u.test(line))
    .map(({ line, index }) => ({
      name: stripHebTitleSuffix(line.replace(/^#\s+/u, "")),
      index,
    }))
    .filter(({ name }) => Boolean(name));
  return headings.at(-1);
}

function extractName(lines: string[]): string | undefined {
  const heading = productHeading(lines);
  if (heading) return heading.name;
  const pageTitle = extractPageTitle(lines);
  return pageTitle ? stripHebTitleSuffix(pageTitle) : undefined;
}

function extractSize(lines: string[], name: string | undefined): string | undefined {
  const headingIndex = productHeading(lines)?.index ?? -1;
  if (headingIndex < 0) return undefined;
  for (let i = headingIndex + 1; i < Math.min(lines.length, headingIndex + 8); i += 1) {
    const value = cleanMarkdownText(lines[i] ?? "");
    if (!value || value === name) continue;
    if (/^\$|^Prices may vary|^Add to cart/iu.test(value)) return undefined;
    if (/^(?:\d+(?:\.\d+)?\s*)?(?:gal|qt|pt|oz|fl oz|lb|g|kg|ml|l|ct|each|pack|piece|pieces|dozen|pint|quart)\b/iu.test(value)) {
      return value;
    }
    if (/^Avg\./iu.test(value)) return value;
  }
  return undefined;
}

function extractCategoryPath(lines: string[]): string[] {
  const path: string[] = [];
  const breadcrumbPattern = /^\d+\.\s+(?:\[[^\]]+\]\([^)]+\)|.+)$/u;
  for (const line of lines) {
    if (!breadcrumbPattern.test(line.trim())) continue;
    const cleaned = cleanMarkdownText(line.replace(/^\d+\.\s*/u, ""));
    if (!cleaned || /^H-E-B$/iu.test(cleaned) || /^Shop$/iu.test(cleaned)) continue;
    if (/^https?:/iu.test(cleaned)) continue;
    path.push(cleaned);
  }
  return [...new Set(path)].slice(0, 6);
}

function extractSection(markdown: string, heading: string, stopHeadings: string[]): string | undefined {
  const lines = linesOf(markdown);
  const start = lines.findIndex((line) => cleanMarkdownText(line).toLowerCase() === heading.toLowerCase());
  if (start < 0) return undefined;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const cleanedHeading = cleanMarkdownText(lines[i] ?? "");
    if (stopHeadings.some((stop) => cleanedHeading.toLowerCase() === stop.toLowerCase())) break;
    if (/^#{1,4}\s+/u.test(lines[i] ?? "") && body.some((line) => cleanMarkdownText(line))) break;
    body.push(lines[i] ?? "");
  }
  const text = body.map(cleanMarkdownText).filter(Boolean).join("\n");
  return text ? text.trim() : undefined;
}

function extractIngredients(markdown: string): string | undefined {
  return extractSection(markdown, "Ingredients", ["Allergens and safety warnings", "More information", "Similar items", "Company"]);
}

function extractAllergens(markdown: string): string | undefined {
  return extractSection(markdown, "Allergens and safety warnings", ["More information", "Similar items", "Company"]);
}

function extractDescription(markdown: string): string | undefined {
  const raw = extractSection(markdown, "Description", ["Nutrition facts and ingredients", "More information"]);
  if (!raw) return undefined;
  return raw
    .split(/\n/u)
    .filter((line) => !/^View all$/iu.test(line))
    .map(cleanMarkdownText)
    .filter(Boolean)
    .join("\n");
}

function extractHighlights(markdown: string): string[] {
  const raw = extractSection(markdown, "Highlights", ["Description", "Nutrition facts and ingredients"]);
  if (!raw) return [];
  return raw
    .split(/\n| {2,}/u)
    .map(cleanMarkdownText)
    .filter(Boolean);
}

function extractNutritionEvidence(markdown: string): string | undefined {
  const start = markdown.indexOf("### Nutrition Facts");
  if (start < 0) return undefined;
  const endCandidates = [
    markdown.indexOf("#### Allergens", start),
    markdown.indexOf("*   ## More information", start),
    markdown.indexOf("## Similar items", start),
    markdown.indexOf("## Company", start),
  ].filter((value) => value > start);
  const end = endCandidates.length > 0 ? Math.min(...endCandidates) : markdown.length;
  return markdown.slice(start, end).trim();
}

function isNutrientName(value: string): boolean {
  if (!value || value.length > 80) return false;
  if (/^(Amount Per Serving|% Daily Value|Calories|The % Daily Value|Serving Size)$/iu.test(value)) return false;
  if (/^\d/u.test(value)) return false;
  return /[A-Za-z]/u.test(value);
}

function isAmount(value: string): boolean {
  return /^\d+(?:\.\d+)?\s*(?:g|mg|mcg|\u00b5g|oz|calories?)$/iu.test(value);
}

function isDailyValue(value: string): boolean {
  return /^\d+(?:\.\d+)?%$/u.test(value);
}

function parseNutritionPanel(rawPanel: string): HebNutritionPanel {
  const lines = rawPanel
    .split(/\r?\n/u)
    .map(cleanMarkdownText)
    .filter(Boolean);

  let servingSize: string | undefined;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const inline = line.match(/^Serving Size\s+(.+)$/iu)?.[1];
    if (inline) {
      servingSize = cleanMarkdownText(inline);
      break;
    }
    if (/^Serving Size$/iu.test(line)) {
      servingSize = firstLineAfter(lines, i);
      break;
    }
  }

  const servingsPerContainer = lines.find((line) => /servings per container/iu.test(line));
  const calories =
    lines
      .join(" ")
      .match(/(?:Amount Per Serving\s*)?Calories(?: from Fat \d+)?\s+(\d+)/iu)?.[1]
    ?? lines.join(" ").match(/\bCalories\s+(\d+)/iu)?.[1];

  const nutrients: HebNutritionNutrient[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const name = lines[i] ?? "";
    if (!isNutrientName(name)) continue;
    const next = lines[i + 1] ?? "";
    const next2 = lines[i + 2] ?? "";
    const nutrient: HebNutritionNutrient = { name };
    if (isAmount(next)) {
      nutrient.amount = next;
      if (isDailyValue(next2)) nutrient.dailyValue = next2;
    } else if (isDailyValue(next)) {
      nutrient.dailyValue = next;
    } else {
      continue;
    }
    nutrients.push(nutrient);
  }

  return {
    servingSize,
    servingsPerContainer,
    calories,
    nutrients,
    rawText: normalizeWhitespace(rawPanel),
  };
}

function parseNutritionPanels(markdown: string): HebNutritionPanel[] {
  const evidence = extractNutritionEvidence(markdown);
  if (!evidence) return [];
  const nutritionOnly = evidence.split(/#### Ingredients/u)[0] ?? evidence;
  return nutritionOnly
    .split(/### Nutrition Facts/gu)
    .slice(1)
    .map((part) => parseNutritionPanel(part))
    .filter((panel) => panel.rawText.length > 0);
}

function inferBrand(name: string): string | null {
  const knownBrands = [
    "Meal Simple by H-E-B",
    "Higher Harvest by H-E-B",
    "H-E-B Sushiya",
    "H-E-B Organics",
    "H-E-B Select Ingredients",
    "Hill Country Fare",
    "Central Market Organics",
    "Central Market",
    "Mi Tienda",
    "H-E-B",
  ];
  const normalizedName = name.replace(/\u2011/g, "-");
  const match = knownBrands.find((brand) => normalizedName.toLowerCase().startsWith(brand.toLowerCase()));
  if (match) return match;
  const firstWords = normalizedName.match(/^([A-Z][A-Za-z'&.-]+(?:\s+[A-Z][A-Za-z'&.-]+){0,2})\b/u)?.[1];
  return firstWords ?? null;
}

function buildReviewIssues(candidate: Omit<HebFoodCandidate, "reviewIssues">): string[] {
  const issues: string[] = [];
  if (!candidate.name) issues.push("missing_name");
  if (!candidate.label.categoryPath.length) issues.push("missing_category_path");
  if (!candidate.label.ingredients) issues.push("missing_ingredients");
  if (candidate.label.nutritionFacts.panels.length === 0) issues.push("missing_nutrition_facts");
  if (!candidate.label.nutritionFacts.panels.some((panel) => panel.servingSize)) issues.push("missing_serving_size");
  if (!candidate.label.nutritionFacts.panels.some((panel) => panel.calories)) issues.push("missing_calories");
  if (!candidate.upc) issues.push("missing_upc");
  return issues;
}

export function parseHebProductMarkdown(markdown: string, productUrl: string, fetchedAt: Date): HebFoodCandidate {
  const normalizedUrl = normalizeHebProductUrl(productUrl);
  if (!normalizedUrl) throw new Error(`not an H-E-B product URL: ${productUrl}`);
  const productId = productIdFromHebUrl(normalizedUrl);
  if (!productId) throw new Error(`missing H-E-B product id: ${productUrl}`);

  const lines = linesOf(markdown);
  const pageTitle = extractPageTitle(lines);
  const name = extractName(lines) ?? stripHebTitleSuffix(pageTitle ?? `H-E-B product ${productId}`);
  const size = extractSize(lines, name);
  const categoryPath = extractCategoryPath(lines);
  const ingredients = extractIngredients(markdown);
  const description = extractDescription(markdown);
  const highlights = extractHighlights(markdown);
  const allergensAndWarnings = extractAllergens(markdown);
  const nutritionPanels = parseNutritionPanels(markdown);
  const nutritionFactsAndIngredients = extractNutritionEvidence(markdown);
  const brand = inferBrand(name);
  const dataOriginId = `heb:${productId}`;
  const canonicalKey = keyText([brand, name, size, dataOriginId].filter(Boolean).join(" "));
  const searchText = compactSearchText([
    name,
    brand,
    size,
    categoryPath.join(" "),
    ingredients,
    description,
    allergensAndWarnings,
  ]);
  const fetchedDate = fetchedAt.toISOString().slice(0, 10);

  const candidateWithoutIssues: Omit<HebFoodCandidate, "reviewIssues"> = {
    id: dataOriginId,
    canonicalKey,
    dataOrigin: HEB_ORIGIN,
    dataOriginId,
    dataOriginUrl: normalizedUrl,
    dataOriginPriority: HEB_ORIGIN_PRIORITY,
    name,
    brand,
    upc: null,
    offMarket: false,
    searchText,
    label: {
      source: "heb",
      sourceFetchedAt: fetchedAt.toISOString(),
      productId,
      productUrl: normalizedUrl,
      pageTitle,
      size,
      categoryPath,
      description,
      highlights,
      ingredients,
      allergensAndWarnings,
      nutritionFacts: {
        panels: nutritionPanels,
      },
      rawEvidence: {
        reader: "jina",
        nutritionFactsAndIngredients,
      },
    },
    fdcReleaseDate: fetchedDate,
  };

  return {
    ...candidateWithoutIssues,
    reviewIssues: buildReviewIssues(candidateWithoutIssues),
  };
}

function summarizeCandidates(
  candidates: HebFoodCandidate[],
  requestedLimit: number,
  discoveredProductUrls: number,
  attemptedProducts: number,
  discoveryFailedTerms: number,
  fetchFailedProducts: number,
): HebScanSummary {
  const issueCounts: Record<string, number> = {};
  for (const candidate of candidates) {
    for (const issue of candidate.reviewIssues) {
      issueCounts[issue] = (issueCounts[issue] ?? 0) + 1;
    }
  }
  return {
    requestedLimit,
    discoveredProductUrls,
    attemptedProducts,
    scannedProducts: candidates.length,
    discoveryFailedTerms,
    fetchFailedProducts,
    parseableProducts: candidates.filter((candidate) => candidate.name && candidate.dataOriginUrl).length,
    productionReadyCandidates: candidates.filter((candidate) => {
      const blocking = new Set(["missing_name", "missing_ingredients", "missing_nutrition_facts", "missing_serving_size", "missing_calories"]);
      return !candidate.reviewIssues.some((issue) => blocking.has(issue));
    }).length,
    withIngredients: candidates.filter((candidate) => candidate.label.ingredients).length,
    withNutritionFacts: candidates.filter((candidate) => candidate.label.nutritionFacts.panels.length > 0).length,
    withServingSize: candidates.filter((candidate) => candidate.label.nutritionFacts.panels.some((panel) => panel.servingSize)).length,
    withCalories: candidates.filter((candidate) => candidate.label.nutritionFacts.panels.some((panel) => panel.calories)).length,
    withCategoryPath: candidates.filter((candidate) => candidate.label.categoryPath.length > 0).length,
    withSize: candidates.filter((candidate) => candidate.label.size).length,
    withUpc: candidates.filter((candidate) => candidate.upc).length,
    multiPanelNutritionFacts: candidates.filter((candidate) => candidate.label.nutritionFacts.panels.length > 1).length,
    issueCounts,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function discoverProductUrls(
  options: Required<Pick<HebScanOptions, "searchTerms" | "fetchMarkdown">> & {
    targetCount: number;
    progress?: (message: string) => void;
  },
): Promise<DiscoveryResult> {
  const urls = new Set<string>();
  const failedTerms: DiscoveryResult["failedTerms"] = [];
  for (const term of options.searchTerms) {
    const searchUrl = `https://www.heb.com/search?q=${encodeURIComponent(term)}`;
    options.progress?.(`discover ${term}`);
    try {
      const markdown = await options.fetchMarkdown(searchUrl);
      for (const url of extractHebProductUrls(markdown)) {
        urls.add(url);
      }
      options.progress?.(`discovered ${urls.size}/${options.targetCount} product URLs`);
      if (urls.size >= options.targetCount) break;
    } catch (error: unknown) {
      failedTerms.push({
        term,
        error: error instanceof Error ? error.message : String(error),
      });
      options.progress?.(`discovery failed for ${term}`);
    }
  }
  return { urls: [...urls], failedTerms };
}

async function writeOutputs(
  outputDir: string,
  candidates: HebFoodCandidate[],
  failures: HebScanFailure[],
  summary: HebScanSummary,
  now: Date,
): Promise<HebScanSummary> {
  await fs.mkdir(outputDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/gu, "-");
  const outputJsonl = path.join(outputDir, `heb-food-label-scan-${stamp}.jsonl`);
  const outputSummary = path.join(outputDir, `heb-food-label-scan-${stamp}.summary.json`);
  const outputFailures = path.join(outputDir, `heb-food-label-scan-${stamp}.failures.json`);
  await fs.writeFile(outputJsonl, `${candidates.map((candidate) => JSON.stringify(candidate)).join("\n")}\n`);
  if (failures.length > 0) {
    await fs.writeFile(outputFailures, `${JSON.stringify(failures, null, 2)}\n`);
  }
  const summaryWithPaths = {
    ...summary,
    outputJsonl,
    outputSummary,
    ...(failures.length > 0 ? { outputFailures } : {}),
  };
  await fs.writeFile(outputSummary, `${JSON.stringify(summaryWithPaths, null, 2)}\n`);
  return summaryWithPaths;
}

export async function scanHebFoods(options: HebScanOptions = {}): Promise<HebScanResult> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const now = options.now ?? new Date();
  const fetchMarkdown = options.fetchMarkdown ?? fetchReaderMarkdown;
  const searchTerms = options.searchTerms ?? HEB_SEARCH_TERMS;
  const progress = options.progress;
  const discoveryTargetCount = limit + Math.max(10, Math.ceil(limit * 0.2));
  const discovery = options.productUrls?.length
    ? {
        urls: [...new Set(options.productUrls.map(normalizeHebProductUrl).filter((url): url is string => Boolean(url)))],
        failedTerms: [],
      }
    : await discoverProductUrls({ searchTerms, fetchMarkdown, targetCount: discoveryTargetCount, progress });
  const discoveredUrls = discovery.urls;
  const productUrls = discoveredUrls.slice(0, limit);
  progress?.(`scanning ${productUrls.length} product pages with concurrency ${concurrency}`);

  let completedProducts = 0;
  const productResultsWithProgress = await mapWithConcurrency(productUrls, concurrency, async (productUrl) => {
    try {
      const markdown = await fetchMarkdown(productUrl);
      return { candidate: parseHebProductMarkdown(markdown, productUrl, now) };
    } catch (error: unknown) {
      return {
        error: {
          productUrl,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    } finally {
      completedProducts += 1;
      if (completedProducts === productUrls.length || completedProducts % 25 === 0) {
        progress?.(`scanned ${completedProducts}/${productUrls.length} product pages`);
      }
    }
  });
  const candidates = productResultsWithProgress
    .map((result) => result.candidate)
    .filter((candidate): candidate is HebFoodCandidate => Boolean(candidate));
  const failures = productResultsWithProgress
    .map((result) => result.error)
    .filter((failure): failure is HebScanFailure => Boolean(failure));
  const fetchFailedProducts = failures.length;

  let summary = summarizeCandidates(
    candidates,
    limit,
    discoveredUrls.length,
    productUrls.length,
    discovery.failedTerms.length,
    fetchFailedProducts,
  );
  if (options.outputDir) {
    summary = await writeOutputs(options.outputDir, candidates, failures, summary, now);
  }
  return { candidates, failures, summary };
}

function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = { summaryOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    const next = argv[i + 1];
    if (arg === "--limit" && next) {
      options.limit = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--concurrency" && next) {
      options.concurrency = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--out" && next) {
      options.outputDir = next;
      i += 1;
    } else if (arg === "--url" && next) {
      options.productUrls = [...(options.productUrls ?? []), next];
      i += 1;
    } else if (arg === "--term" && next) {
      options.searchTerms = [...(options.searchTerms ?? []), next];
      i += 1;
    } else if (arg === "--summary-only") {
      options.summaryOnly = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  options.limit ??= DEFAULT_LIMIT;
  options.concurrency ??= DEFAULT_CONCURRENCY;
  options.outputDir ??= DEFAULT_OUTPUT_DIR;
  return options;
}

function printHelpAndExit(): never {
  console.log(`Usage: pnpm exec tsx scripts/foods/heb-food-label-scan.ts [options]

Options:
  --limit <n>          Number of H-E-B product pages to scan. Default: ${DEFAULT_LIMIT}
  --concurrency <n>    Product-page fetch concurrency. Default: ${DEFAULT_CONCURRENCY}
  --out <dir>          Output directory. Default: ${DEFAULT_OUTPUT_DIR}
  --term <query>       Override/add a search term. Repeatable.
  --url <url>          Scan a known product URL instead of discovery. Repeatable.
  --summary-only       Print only the summary JSON.
`);
  process.exit(0);
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  options.progress = (message) => {
    process.stderr.write(`[heb-food-label-scan] ${message}\n`);
  };
  const result = await scanHebFoods(options);
  if (options.summaryOnly) {
    console.log(JSON.stringify(result.summary, null, 2));
    return;
  }
  console.log(JSON.stringify(result.summary, null, 2));
  for (const candidate of result.candidates.slice(0, 5)) {
    console.log(
      [
        candidate.dataOriginId,
        candidate.name,
        `ingredients=${Boolean(candidate.label.ingredients)}`,
        `nutritionPanels=${candidate.label.nutritionFacts.panels.length}`,
        `issues=${candidate.reviewIssues.join(",") || "none"}`,
      ].join(" | "),
    );
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
