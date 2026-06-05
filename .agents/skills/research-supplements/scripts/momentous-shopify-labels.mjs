#!/usr/bin/env node

const DEFAULT_FEED_URL = "https://www.livemomentous.com/products.json?limit=250";
const DEFAULT_BASE_URL = "https://www.livemomentous.com";

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    delayMs: 300,
    feedUrl: DEFAULT_FEED_URL,
    handles: new Set(),
    includeStacks: false,
    limit: null,
    requireFacts: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--include-stacks") {
      options.includeStacks = true;
    } else if (arg === "--require-facts") {
      options.requireFacts = true;
    } else if (arg === "--handle") {
      const value = argv[index + 1];
      if (!value) throw new Error("--handle requires a value");
      options.handles.add(value);
      index += 1;
    } else if (arg === "--limit") {
      const value = Number.parseInt(argv[index + 1] ?? "", 10);
      if (!Number.isInteger(value) || value < 1) throw new Error("--limit requires a positive integer");
      options.limit = value;
      index += 1;
    } else if (arg === "--feed-url") {
      const value = argv[index + 1];
      if (!value) throw new Error("--feed-url requires a value");
      options.feedUrl = value;
      index += 1;
    } else if (arg === "--base-url") {
      const value = argv[index + 1];
      if (!value) throw new Error("--base-url requires a value");
      options.baseUrl = value.replace(/\/+$/u, "");
      index += 1;
    } else if (arg === "--delay-ms") {
      const value = Number.parseInt(argv[index + 1] ?? "", 10);
      if (!Number.isInteger(value) || value < 0) throw new Error("--delay-ms requires a nonnegative integer");
      options.delayMs = value;
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

function printHelp() {
  console.log(`Usage: node scripts/momentous-shopify-labels.mjs [options]

Fetch current Momentous product data and emit Murph brand_site supplement JSON.

Options:
  --handle <handle>       Restrict to one Shopify product handle. Repeatable.
  --limit <n>             Limit product count after filtering.
  --include-stacks        Include stacks/bundles. Default: standalone formulas only.
  --require-facts         Emit only rows with official facts text found on the product page.
  --feed-url <url>        Override the Shopify products.json URL.
  --base-url <url>        Override the store base URL.
  --delay-ms <n>          Delay between product-page fetches. Default: 300.
`);
}

function decodeHtml(value) {
  return String(value)
    .replace(/&quot;/gu, "\"")
    .replace(/&#39;/gu, "'")
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&")
    .replace(/&nbsp;/gu, " ")
    .replace(/&ndash;|&mdash;/gu, "-")
    .replace(/&reg;/gu, "(R)")
    .replace(/&trade;/gu, "(TM)")
    .replace(/&#x([0-9a-f]+);/giu, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/gu, (_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/\s+/gu, " ")
    .trim();
}

function stripHtml(value) {
  return decodeHtml(String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<style[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " "));
}

function slugify(value) {
  const slug = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug || "default";
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeUpc(value) {
  const digits = String(value ?? "").replace(/\D/gu, "");
  return digits.length >= 8 && digits.length <= 14 ? digits : null;
}

function classifyProduct(product) {
  const haystack = [
    product.handle,
    product.title,
    product.product_type,
    ...(product.tags ?? []),
  ].join(" ").toLowerCase();

  if (
    /\b(merch|shirt|tee|tank|hat|bottle|shaker|pill case|travel case|gwp)\b/u.test(haystack)
    || /dont buy|test product|pr-lotion|lotion/u.test(haystack)
  ) {
    return "skip";
  }

  if (
    /stack|bundle|the momentous three|women.?s three|ultimate stack|essential stack/u.test(haystack)
    || /sleep (5-|30-)?pack|2x-tongkat|brain drive \+ elite sleep/u.test(haystack)
  ) {
    return "stack";
  }

  return "formula";
}

function extractFactsText(html) {
  const altFacts = [...html.matchAll(/alt="([^"]*(?:Supplement Facts|Nutrition Facts)[^"]*)"/giu)]
    .map((match) => decodeHtml(match[1]));

  const listFacts = [...html.matchAll(/<ul[^>]*>(?=[\s\S]{0,2200}(?:Supplement Facts|Nutrition Facts|Other Ingredients|Amount Per Serving))([\s\S]{0,2600}?)<\/ul>/giu)]
    .map((match) => stripHtml(match[1]))
    .filter((text) => /Supplement Facts|Nutrition Facts|Other Ingredients|Amount Per Serving/iu.test(text));

  return uniq([...altFacts, ...listFacts]);
}

function extractIngredientText(factsText, bodyText) {
  const texts = [];
  for (const text of [...factsText, bodyText]) {
    const match = text.match(/(?:Other Ingredients?|Ingredients?)\s*:?\s*.+/iu);
    if (match) texts.push(match[0].slice(0, 2000).trim());
  }
  return uniq(texts);
}

function normalizeVariant(variant) {
  return {
    id: variant.id,
    title: variant.title,
    sku: variant.sku || null,
    barcode: variant.barcode || null,
    available: Boolean(variant.available),
    price: variant.price ?? null,
    grams: variant.grams ?? null,
  };
}

function factsForVariant(factsText, variant, variants) {
  if (variants.length <= 1 || variant.title === "Default Title") return factsText;
  const tokens = slugify(variant.title).split("-").filter((token) => token.length >= 3);
  if (tokens.length === 0) return factsText;
  const matches = factsText.filter((text) => {
    const normalized = text.toLowerCase();
    return tokens.every((token) => normalized.includes(token));
  });
  if (matches.length > 0) return matches;
  const looseMatches = factsText.filter((text) => {
    const normalized = text.toLowerCase();
    return tokens.some((token) => normalized.includes(token));
  });
  return looseMatches.length > 0 ? looseMatches : factsText;
}

function labelSourceId(product, variant, variants) {
  if (variants.length <= 1 || variant.title === "Default Title") {
    return product.handle;
  }
  return `${product.handle}--${slugify(variant.title)}`;
}

function labelName(product, variant, variants) {
  if (variants.length <= 1 || variant.title === "Default Title") {
    return product.title;
  }
  return `${product.title} - ${variant.title}`;
}

function buildSearchText(item) {
  return uniq([
    item.name,
    item.brand,
    item.upc,
    item.label.title,
    item.label.handle,
    item.label.bodyText,
    ...item.label.factsText,
    ...(item.label.tags ?? []),
  ]).join(" ").replace(/\s+/gu, " ").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url, attempt = 1) {
  const response = await fetch(url, {
    headers: {
      "accept": "text/html,application/json",
      "user-agent": "Murph supplement research skill (+https://www.livemomentous.com)",
    },
  });
  if (response.ok) return response.text();

  if ((response.status === 429 || response.status >= 500) && attempt < 4) {
    const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
    const backoffMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : attempt * attempt * 2000;
    await sleep(backoffMs);
    return fetchText(url, attempt + 1);
  }

  throw new Error(`Fetch failed ${response.status} for ${url}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const fetchedAt = new Date().toISOString();
  const feed = JSON.parse(await fetchText(options.feedUrl));
  const products = [];

  for (const product of feed.products ?? []) {
    if (options.handles.size > 0 && !options.handles.has(product.handle)) continue;
    const classification = classifyProduct(product);
    if (classification === "skip") continue;
    if (classification === "stack" && !options.includeStacks) continue;
    products.push({ ...product, classification });
    if (options.limit && products.length >= options.limit) break;
  }

  const items = [];
  const warnings = [];

  for (const product of products) {
    const sourceUrl = `${options.baseUrl}/products/${product.handle}`;
    let html = "";
    try {
      if (options.delayMs > 0) await sleep(options.delayMs);
      html = await fetchText(sourceUrl);
    } catch (error) {
      warnings.push({ handle: product.handle, warning: error instanceof Error ? error.message : String(error) });
    }

    const factsText = extractFactsText(html);
    if (options.requireFacts && factsText.length === 0) {
      warnings.push({ handle: product.handle, warning: "Skipped because no facts text was found." });
      continue;
    }

    const variants = (product.variants ?? []).map(normalizeVariant);
    const bodyText = stripHtml(product.body_html).slice(0, 6000);

    for (const variant of variants.length > 0 ? variants : [normalizeVariant({ title: "Default Title" })]) {
      const sourceId = labelSourceId(product, variant, variants);
      const dataOriginId = `momentous:${sourceId}`;
      const name = labelName(product, variant, variants);
      const upc = normalizeUpc(variant.barcode) ?? normalizeUpc(variant.sku);
      const variantFactsText = factsForVariant(factsText, variant, variants);
      const ingredientText = extractIngredientText(variantFactsText, bodyText);
      const label = {
        schemaVersion: "murph.supplement.brand-site-label.v1",
        source: "momentous",
        sourceId,
        sourceFetchedAt: fetchedAt,
        sourceUrl,
        handle: product.handle,
        productId: product.id,
        title: product.title,
        name,
        brand: "Momentous",
        productType: product.product_type || null,
        classification: product.classification,
        tags: product.tags ?? [],
        bodyText,
        factsText: variantFactsText,
        ingredientText,
        allProductFactsText: factsText,
        factsTextEvidence: variantFactsText.length > 0 ? "official_product_page_alt_or_text" : "missing",
        needsManualReview: variantFactsText.length === 0 || product.classification === "stack",
        variant,
        variants,
      };
      const item = {
        id: dataOriginId,
        dataOrigin: "brand_site",
        dataOriginId,
        dataOriginUrl: sourceUrl,
        source: "momentous",
        sourceId,
        name,
        brand: "Momentous",
        upc,
        offMarket: variant.available === false,
        sourceUrl,
        label,
      };
      item.searchText = buildSearchText(item);
      items.push(item);
    }
  }

  console.log(JSON.stringify({
    schemaVersion: "murph.supplement-research.batch.v1",
    source: "momentous",
    brand: "Momentous",
    fetchedAt,
    sourceFeedUrl: options.feedUrl,
    itemCount: items.length,
    warnings,
    items,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
