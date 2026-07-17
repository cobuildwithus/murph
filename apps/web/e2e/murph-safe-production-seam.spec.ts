import { publicProductDetailResponseSchema } from "@murphai/contracts";
import { expect, test } from "@playwright/test";

const productRef = process.env.MURPH_SAFE_E2E_PRODUCT_REF?.trim() ?? "";
const productName = process.env.MURPH_SAFE_E2E_PRODUCT_NAME?.trim() ?? "";
const query = process.env.MURPH_SAFE_E2E_QUERY?.trim() ?? "";
const expectedTestId = process.env.MURPH_SAFE_E2E_EXPECTED_TEST_ID?.trim() ?? "";
const excludedTestId = process.env.MURPH_SAFE_E2E_EXCLUDED_TEST_ID?.trim() ?? "";

test.describe("Murph Safe live product seam", () => {
  test.skip(
    !productRef || !productName || !query || !expectedTestId,
    "Requires an explicitly seeded local labels database fixture.",
  );

  for (const viewport of [
    { label: "phone", width: 390, height: 844 },
    { label: "desktop", width: 1280, height: 900 },
  ] as const) {
    test(`uses the real search API and server detail on ${viewport.label}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto("/search");

      const searchResponse = page.waitForResponse((response) =>
        response.request().method() === "POST"
        && response.url().endsWith("/api/public/v1/products/search"));
      await page.getByLabel("Search products").fill(query);
      await page.getByRole("button", { name: "Check product" }).click();

      expect((await searchResponse).status()).toBe(200);
      const detailLink = page.getByRole("link", { name: new RegExp(productName, "u") });
      await expect(detailLink).toHaveAttribute(
        "href",
        `/search/products/${productRef}`,
      );
      await expect(page).toHaveURL(/\/search$/u);

      const apiResponse = await page.request.get(
        `/api/public/v1/products/${productRef}`,
      );
      expect(apiResponse.status()).toBe(200);
      const detail = publicProductDetailResponseSchema.parse(
        await apiResponse.json(),
      );
      expect(detail.product.productTests.observations.map(({ id }) => id)).toContain(
        expectedTestId,
      );
      if (excludedTestId) {
        expect(detail.product.productTests.observations.map(({ id }) => id)).not.toContain(
          excludedTestId,
        );
      }

      await detailLink.click();
      await expect(page).toHaveURL(`/search/products/${productRef}`);
      await expect(page.getByRole("heading", { name: productName })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Product tests" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Supplement facts" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "What we do not know" })).toBeVisible();

      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});
