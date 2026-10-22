import { expect, test } from "@playwright/test";

test("homepage footer opens the privacy policy and its downloadable document", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  const footer = page.locator("#site-footer");
  await footer.scrollIntoViewIfNeeded();
  const logo = footer.getByRole("img", { name: "Murph", exact: true });
  await expect.poll(() => logo.evaluate((image: HTMLImageElement) =>
    image.complete && image.naturalWidth > 0
  )).toBe(true);

  await footer.getByRole("link", { name: "Privacy Policy", exact: true }).click();
  await expect(page).toHaveURL(/\/legal\/privacy$/u);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const documentLink = page.locator('a[href="/legal/privacy.pdf"]').first();
  await expect(documentLink).toBeVisible();
  const pdf = await request.get(await documentLink.getAttribute("href") ?? "");
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  expect(pageErrors).toEqual([]);
});
