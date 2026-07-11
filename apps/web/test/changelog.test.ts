import { describe, expect, it } from "vitest";

import {
  CHANGELOG_CARD_MAX_ITEMS,
  buildChangelogCardPath,
  buildChangelogItemPath,
  buildChangelogPagePath,
  listChangelogEditions,
  listPublishedChangelogItems,
  parseChangelogCardItemSegment,
  queryChangelogItems,
  resolveChangelogCardItems,
  resolveChangelogEditionPage,
  resolveChangelogPage,
} from "../src/lib/changelog";

describe("changelog registry", () => {
  it("keeps item ids unique and stable", () => {
    const ids = listPublishedChangelogItems().map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
  });

  it("applies independent feature and improvement candidate limits", () => {
    const items = queryChangelogItems({
      featureLimit: 1,
      from: "2026-06-01",
      improvementLimit: 2,
      to: "2026-07-01",
    });
    expect(items.filter((item) => item.kind === "feature")).toHaveLength(1);
    expect(items.filter((item) => item.kind === "improvement")).toHaveLength(2);
  });

  it("round-trips deterministic card item paths", () => {
    const ids = listPublishedChangelogItems()
      .slice(0, CHANGELOG_CARD_MAX_ITEMS)
      .map((item) => item.id);
    const path = buildChangelogCardPath(ids);
    const segment = path.split("/").at(-1);
    expect(parseChangelogCardItemSegment(segment)).toEqual(ids);
    expect(resolveChangelogCardItems(ids)?.map((item) => item.id)).toEqual(ids);
  });

  it("fails closed for unknown or duplicate card items", () => {
    expect(parseChangelogCardItemSegment("not-a-real-item.png")).toBeNull();
    const first = listPublishedChangelogItems()[0]?.id;
    expect(first).toBeTruthy();
    expect(parseChangelogCardItemSegment(`${first}~${first}.png`)).toBeNull();
  });

  it("paginates the archive one dated edition at a time", () => {
    const editions = listChangelogEditions();
    const firstPage = resolveChangelogPage(1);
    const secondPage = resolveChangelogPage(2);

    expect(firstPage).toMatchObject({
      currentPage: 1,
      editions: [{ id: editions[0]?.id }],
      totalPages: editions.length,
    });
    expect(secondPage).toMatchObject({
      currentPage: 2,
      editions: [{ id: editions[1]?.id }],
      totalPages: editions.length,
    });
    expect(resolveChangelogPage(0)).toBeNull();
    expect(resolveChangelogPage(editions.length + 1)).toBeNull();
  });

  it("resolves only known canonical edition cursors", () => {
    const editions = listChangelogEditions();

    expect(resolveChangelogEditionPage(undefined)).toBe(1);
    expect(resolveChangelogEditionPage(editions[1]?.id)).toBe(2);
    expect(resolveChangelogEditionPage("2026-7-09")).toBeNull();
    expect(resolveChangelogEditionPage("2099-01-01")).toBeNull();
    expect(resolveChangelogEditionPage(["2026-07-09", "2026-07-08"])).toBeNull();
  });

  it("builds stable page and item links for the paginated archive", () => {
    const editions = listChangelogEditions();
    const newestItem = editions[0]?.items[0];
    const olderItem = editions[1]?.items[0];

    expect(newestItem).toBeTruthy();
    expect(olderItem).toBeTruthy();
    if (!newestItem || !olderItem) {
      throw new Error("Expected the changelog to contain at least two editions.");
    }
    expect(buildChangelogPagePath(1)).toBe("/changelog");
    expect(buildChangelogPagePath(2)).toBe(
      `/changelog?edition=${editions[1]?.id}`,
    );
    expect(buildChangelogItemPath(newestItem.id)).toBe(
      `/changelog?edition=${editions[0]?.id}#${newestItem.id}`,
    );
    expect(buildChangelogItemPath(olderItem.id)).toBe(
      `/changelog?edition=${editions[1]?.id}#${olderItem.id}`,
    );
    expect(() => buildChangelogItemPath("not-a-real-item")).toThrow(
      "does not exist",
    );
  });
});
