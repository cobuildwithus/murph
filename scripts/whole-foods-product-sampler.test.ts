import assert from "node:assert/strict";

import { afterEach, describe, test, vi } from "vitest";

import {
  buildPreparedFoodCsvRow,
  discoverProductUrlsFromHtml,
  extractWholeFoodsProductFromHtml,
  fetchProductHtml,
  preparedFoodCsvHeader,
} from "./whole-foods-product-sampler.mjs";

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

const PRODUCT_HTML = `<!doctype html>
<html>
  <head>
    <script id="__NEXT_DATA__" type="application/json">
      {
        "props": {
          "pageProps": {
            "aapiData": {
              "brandName": "365 by Whole Foods Market",
              "name": "365 by Whole Foods Market Peanut Butter Cookie Dough Ice Cream, 1 PT",
              "asin": "B08FY734T4",
              "programType": "GROCERY",
              "productImages": ["https://images.example.test/a.jpg", "https://images.example.test/b.jpg"],
              "ingredients": "Cream, sugar, peanut butter",
              "dietTypes": ["gluten_free", "vegetarian"],
              "category": {
                "productType": "DAIRY_BASED_ICE_CREAM",
                "displayName": "Grocery",
                "glProductGroupSymbol": "gl_fresh_perishable"
              },
              "nutritionFacts": {
                "caloriesAmount": "240",
                "servingsPerContainer": "3.0 servings per container",
                "servingSize": "2/3 cup (96g)",
                "macronutrients": [
                  { "name": "Total Fat", "amount": "13g", "percent": "17%", "level": "TOP" },
                  { "name": "Sugars", "amount": "20g", "percent": "", "level": "SUB" }
                ],
                "vitaminsAndMinerals": [
                  { "name": "Calcium", "amount": "120mg", "percent": "10%", "level": "TOP" }
                ]
              }
            }
          }
        }
      }
    </script>
  </head>
  <body></body>
</html>`;

describe("whole foods product sampler", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("discovers and normalizes product URLs from listing HTML", () => {
    const urls = discoverProductUrlsFromHtml(
      `<a href="/product/example-product-b012345678"></a>
       <a href="https://origin-d8.wholefoodsmarket.com/product/other-product-b087654321?x=1"></a>
       <a href="/products/search/cereal"></a>`,
      "https://www.wholefoodsmarket.com/products/search/cereal",
    );

    assert.deepEqual(urls, [
      "https://www.wholefoodsmarket.com/product/example-product-b012345678",
      "https://www.wholefoodsmarket.com/product/other-product-b087654321",
    ]);
  });

  test("extracts compact product facts from Next.js payload", () => {
    const product = extractWholeFoodsProductFromHtml(
      PRODUCT_HTML,
      "https://www.wholefoodsmarket.com/product/365-by-whole-foods-market-peanut-butter-cookie-dough-ice-cream-1-pt-b08fy734t4",
    );

    assert.ok(product);
    assert.equal(product.id, "wfm:b08fy734t4");
    assert.equal(product.dataOrigin, "whole_foods_market");
    assert.equal(product.dataOriginId, "B08FY734T4");
    assert.equal(product.dataOriginPriority, 40);
    assert.equal(product.name, "365 by Whole Foods Market Peanut Butter Cookie Dough Ice Cream, 1 PT");
    assert.equal(product.brand, "365 by Whole Foods Market");
    assert.equal(product.canonicalKey, "365 by whole foods market|365 by whole foods market peanut butter cookie dough ice cream 1 pt");
    assert.equal(product.hasNutritionFacts, true);
    assert.equal(product.hasIngredients, true);
    assert.equal(product.label.productImageCount, 2);
    assert.ok(product.label.nutritionFacts);
    assert.ok(product.label.nutritionFacts.macronutrients);
    assert.equal(product.label.nutritionFacts.caloriesAmount, "240");
    assert.equal(product.label.nutritionFacts.macronutrients[0]?.name, "Total Fat");
    assert.equal(product.label.servingSize, 96);
    assert.equal(product.label.servingSizeUnit, "g");
    assert.equal(product.label.householdServing, "2/3 cup (96g)");
    assert.equal(product.label.servingsPerContainer, 3);
    assert.equal(product.label.calories, 240);
    assert.deepEqual(product.label.nutrientsPerServing?.slice(0, 3), [
      {
        id: 1008,
        number: "208",
        name: "Energy",
        unit: "kcal",
        value: 240,
        sourceName: "Calories",
      },
      {
        id: 1004,
        number: "204",
        name: "Total lipid (fat)",
        value: 13,
        unit: "g",
        sourceName: "Total Fat",
        sourceAmount: "13g",
        percentDailyValue: 17,
      },
      {
        id: 2000,
        number: "269",
        name: "Sugars, total including NLEA",
        value: 20,
        unit: "g",
        sourceName: "Sugars",
        sourceAmount: "20g",
        percentDailyValue: null,
      },
    ]);
    assert.deepEqual(product.label.nutrientsPer100g?.slice(0, 3), [
      {
        id: 1008,
        number: "208",
        name: "Energy",
        value: 250,
        unit: "kcal",
      },
      {
        id: 1004,
        number: "204",
        name: "Total lipid (fat)",
        value: 13.5417,
        unit: "g",
      },
      {
        id: 2000,
        number: "269",
        name: "Sugars, total including NLEA",
        value: 20.8333,
        unit: "g",
      },
    ]);
    assert.deepEqual(product.label.dietTypes, ["gluten_free", "vegetarian"]);
  });

  test("builds prepared CSV rows for the existing foods import shape", () => {
    const product = extractWholeFoodsProductFromHtml(PRODUCT_HTML, "https://www.wholefoodsmarket.com/product/sample-b08fy734t4");
    assert.ok(product);

    const header = preparedFoodCsvHeader();
    const row = buildPreparedFoodCsvRow(product, "2026-06-16");
    const columns = parseCsvLine(header);
    const values = parseCsvLine(row);

    assert.deepEqual(columns, [
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
    ]);
    assert.equal(values.length, 13);
    assert.equal(values[0], "wfm:b08fy734t4");
    assert.equal(values[2], "whole_foods_market");
    assert.equal(values[3], "B08FY734T4");
    assert.equal(values[5], "40");
    assert.equal(values[8], "");
    assert.equal(values[9], "f");
    assert.equal(values[12], "2026-06-16");
    for (const index of [0, 1, 2, 3, 5, 6, 9, 10, 11, 12]) {
      assert.notEqual(values[index], "", `${columns[index]} should be populated`);
    }
    const label = JSON.parse(values[11]);
    assert.equal(label.source, "whole_foods_market");
    assert.equal(label.servingSize, 96);
    assert.equal(label.nutrientsPer100g[0].number, "208");
    assert.match(row, /^"wfm:b08fy734t4","365 by whole foods market\|365 by whole foods market/u);
    assert.match(row, /""Cream, sugar, peanut butter""/u);
  });

  test("uses Context.dev fallback only after direct fetch lacks product JSON", async () => {
    vi.stubEnv("CONTEXT_DEV_API_KEY", "test-context-key");
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.startsWith("https://api.context.dev/")) {
        return new Response(JSON.stringify({ html: PRODUCT_HTML }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }
      assert.equal((init?.headers as Record<string, string>).authorization, undefined);
      return new Response("<html></html>", {
        headers: { "content-type": "text/html" },
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchProductHtml("https://www.wholefoodsmarket.com/product/sample-b08fy734t4", {
      contextDevFallback: true,
      timeoutMs: 1000,
    });

    assert.equal(response.method, "context_dev");
    assert.equal(fetchMock.mock.calls.length, 2);
    assert.equal(String(fetchMock.mock.calls[0]?.[0]), "https://www.wholefoodsmarket.com/product/sample-b08fy734t4");
    assert.equal(
      String(fetchMock.mock.calls[1]?.[0]),
      "https://api.context.dev/v1/web/scrape/html?url=https%3A%2F%2Fwww.wholefoodsmarket.com%2Fproduct%2Fsample-b08fy734t4",
    );
    const fallbackHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    assert.equal(fallbackHeaders.authorization, "Bearer test-context-key");
    assert.ok(extractWholeFoodsProductFromHtml(response.text, response.url));
  });

  test("does not use Context.dev fallback when direct fetch has product JSON", async () => {
    vi.stubEnv("CONTEXT_DEV_API_KEY", "test-context-key");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(PRODUCT_HTML, {
      headers: { "content-type": "text/html" },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchProductHtml("https://www.wholefoodsmarket.com/product/sample-b08fy734t4", {
      contextDevFallback: true,
      timeoutMs: 1000,
    });

    assert.equal(response.method, "direct");
    assert.equal(fetchMock.mock.calls.length, 1);
  });

  test("throws direct fetch errors when Context.dev fallback is disabled", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("blocked", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    await assert.rejects(
      fetchProductHtml("https://www.wholefoodsmarket.com/product/sample-b08fy734t4", {
        contextDevFallback: false,
        timeoutMs: 1000,
      }),
      /HTTP 403/u,
    );
    assert.equal(fetchMock.mock.calls.length, 1);
  });
});
