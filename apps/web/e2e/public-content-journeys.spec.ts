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

for (const route of ["/clubs", "/security", "/refer", "/compare"]) {
  test(`${route} serves a usable public page and its published share image`, async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page).not.toHaveTitle("");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `https://www.withmurph.ai${route}`,
    );
    const imageUrl = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(imageUrl).toBeTruthy();
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute("content", imageUrl!);

    // Request the candidate server's image, even when metadata uses the production origin.
    const imagePath = new URL(imageUrl!, page.url());
    const image = await request.get(`${imagePath.pathname}${imagePath.search}`);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toContain("image/png");
    const bytes = await image.body();
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(630);
  });
}

test("changelog archive navigates to older editions and back", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/changelog");
  const editions = page.locator('[id^="edition-"]');
  const currentEditionIds = await editions.evaluateAll((elements) => elements.map((element) => element.id));
  expect(currentEditionIds.length).toBeGreaterThan(0);
  const pagination = page.getByRole("navigation", { name: "Changelog pages" });
  const older = pagination.getByRole("link", { name: "Older", exact: true });
  const olderHref = await older.getAttribute("href");
  expect(olderHref).toBeTruthy();
  const olderUrl = new URL(olderHref!, page.url()).toString();
  await older.click();
  await expect(page).toHaveURL(olderUrl);
  await expect(pagination.getByRole("link", { name: "Page 2", exact: true })).toHaveAttribute("aria-current", "page");
  const olderEditionIds = await editions.evaluateAll((elements) => elements.map((element) => element.id));
  expect(olderEditionIds.length).toBeGreaterThan(0);
  expect(olderEditionIds.every((id) => !currentEditionIds.includes(id))).toBe(true);
  await pagination.getByRole("link", { name: "Newer", exact: true }).click();
  await expect(page).toHaveURL(/\/changelog$/u);
  await expect.poll(() => editions.evaluateAll((elements) => elements.map((element) => element.id))).toEqual(currentEditionIds);
});
