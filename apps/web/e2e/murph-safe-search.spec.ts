import { expect, test } from "@playwright/test";

test("Murph Safe submits a private POST and renders grouped product matches", async ({
  context,
  page,
}) => {
  await context.addCookies([
    {
      domain: "127.0.0.1",
      name: "murph_safe_test_cookie",
      path: "/",
      value: "must-not-be-sent",
    },
  ]);

  let searchRequest: {
    cookie: string | undefined;
    method: string;
    payload: unknown;
    referer: string | undefined;
    url: string;
  } | null = null;

  await page.route("**/api/public/v1/products/search", async (route) => {
    const request = route.request();
    searchRequest = {
      cookie: request.headers().cookie,
      method: request.method(),
      payload: request.postDataJSON(),
      referer: request.headers().referer,
      url: request.url(),
    };
    await route.fulfill({
      body: JSON.stringify(makeSearchResponse()),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/search");
  await page.getByLabel("Search products").fill("creatine monohydrate");
  await page.getByRole("button", { name: "Check product" }).click();

  await expect(page.getByRole("heading", { name: "Search results" })).toBeFocused();
  await expect(page.getByRole("heading", { name: "Supplements" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Branded foods" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Example Creatine/ })).toHaveAttribute(
    "href",
    "/search/products/supplement_c3VwcGxlbWVudC0x",
  );
  await expect(page).toHaveURL(/\/search$/u);

  expect(searchRequest).toEqual({
    cookie: undefined,
    method: "POST",
    payload: {
      kinds: ["supplement", "food"],
      limitPerKind: 6,
      query: "creatine monohydrate",
    },
    referer: undefined,
    url: expect.stringMatching(/\/api\/public\/v1\/products\/search$/u),
  });
});

test("Murph Safe gives a specific recovery message when rate limited", async ({
  page,
}) => {
  await page.route("**/api/public/v1/products/search", (route) =>
    route.fulfill({
      body: "Too many requests",
      contentType: "text/plain",
      status: 429,
    }),
  );

  await page.goto("/search");
  await page.getByLabel("Search products").fill("protein bar");
  await page.getByRole("button", { name: "Check product" }).click();

  await expect(page.locator("#murph-safe-search-error")).toHaveText(
    "Too many searches. Please wait a minute before trying again.",
  );
  await expect(page).toHaveURL(/\/search$/u);
});

function makeSearchResponse() {
  return {
    schema: "murph.public-products.v1",
    results: {
      foods: [
        {
          brand: "Example Foods",
          kind: "food",
          name: "Example Protein Bar",
          productRef: "food_Zm9vZC0x",
          productTests: {
            status: "no_known_product_tests",
            total: 0,
          },
          source: {
            key: "usda_branded",
            name: "USDA FoodData Central",
          },
          upc: "123456789012",
        },
      ],
      supplements: [
        {
          brand: "Example Labs",
          kind: "supplement",
          name: "Example Creatine",
          productRef: "supplement_c3VwcGxlbWVudC0x",
          productTests: {
            status: "known_product_tests",
            total: 2,
          },
          source: {
            key: "dsld",
            name: "Dietary Supplement Label Database",
          },
          upc: null,
        },
      ],
    },
  };
}
