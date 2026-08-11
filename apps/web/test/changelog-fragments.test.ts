import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadChangelogFragmentEditions } from "../src/lib/changelog-fragments";
import { listChangelogEditions } from "../src/lib/changelog";
import { generateChangelogFragments } from "../scripts/generate-changelog-fragments";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("changelog entry fragments", () => {
  it("publishes every authored fragment without a hand-maintained inventory", () => {
    const entriesRoot = path.resolve(process.cwd(), "apps/web/changelog/entries");
    const expectedByDate = new Map(
      readdirSync(entriesRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((dateEntry) => [
          dateEntry.name,
          readdirSync(path.join(entriesRoot, dateEntry.name))
            .filter((fileName) => fileName.endsWith(".json"))
            .map((fileName) => fileName.slice(0, -".json".length))
            .sort(),
        ]),
    );
    const publishedByDate = new Map(
      listChangelogEditions().map((edition) => [
        edition.publishedOn,
        edition.items.map((item) => item.id).sort(),
      ]),
    );

    expect(expectedByDate.size).toBeGreaterThan(0);
    for (const [publishedOn, itemIds] of expectedByDate) {
      expect(publishedByDate.get(publishedOn)).toEqual(itemIds);
    }
  });

  it("groups dates and sorts independent entries deterministically", () => {
    const root = createContentRoot();
    writeEntry(root, "2026-08-12", "later-alpha", 100);
    writeEntry(root, "2026-08-12", "later-beta", 100);
    writeEntry(root, "2026-08-12", "later-priority", 200);
    writeEntry(root, "2026-08-11", "older-entry", 900);

    expect(loadChangelogFragmentEditions(root)).toMatchObject([
      {
        id: "2026-08-12",
        items: [
          { id: "later-priority" },
          { id: "later-alpha" },
          { id: "later-beta" },
        ],
        publishedOn: "2026-08-12",
        summary: "3 updates shipped in this edition.",
        title: "What's new in Murph",
      },
      {
        id: "2026-08-11",
        items: [{ id: "older-entry" }],
      },
    ]);
  });

  it("uses optional edition metadata without coupling item files", () => {
    const root = createContentRoot();
    writeEntry(root, "2026-08-12", "new-capability", 100);
    mkdirSync(path.join(root, "editions"), { recursive: true });
    writeJson(path.join(root, "editions/2026-08-12.json"), {
      publishedOn: "2026-08-12",
      summary: "One editorial summary for independently authored entries.",
      title: "An editorial edition heading",
    });

    expect(loadChangelogFragmentEditions(root)[0]).toMatchObject({
      summary: "One editorial summary for independently authored entries.",
      title: "An editorial edition heading",
    });
  });

  it("generates a stable ignored TypeScript module for the web bundle", () => {
    const root = createContentRoot();
    const outputFile = path.join(root, "changelog-fragments.generated.ts");
    writeEntry(root, "2026-08-12", "generated-entry", 100);

    expect(generateChangelogFragments({ contentRoot: root, outputFile })).toBe(true);
    expect(generateChangelogFragments({ contentRoot: root, outputFile })).toBe(false);
    expect(readFileSync(outputFile, "utf8")).toContain(
      '"id": "generated-entry"',
    );
  });

  it("fails closed when a fragment path disagrees with its content", () => {
    const root = createContentRoot();
    writeEntry(root, "2026-08-12", "path-item", 100, {
      publishedOn: "2026-08-11",
    });

    expect(() => loadChangelogFragmentEditions(root)).toThrow(
      "must use its directory date",
    );
  });

  it("fails closed when different dates reuse an item ID", () => {
    const root = createContentRoot();
    writeEntry(root, "2026-08-12", "duplicate-item", 100);
    writeEntry(root, "2026-08-11", "duplicate-item", 100);

    expect(() => loadChangelogFragmentEditions(root)).toThrow(
      "Duplicate changelog fragment item ID: duplicate-item",
    );
  });

  it("fails closed on unexpected fragment fields", () => {
    const root = createContentRoot();
    writeEntry(root, "2026-08-12", "unexpected-field", 100, {
      extra: true,
    });

    expect(() => loadChangelogFragmentEditions(root)).toThrow(
      "contains an unknown field: extra",
    );
  });
});

function createContentRoot(): string {
  const testTempRoot = process.env.MURPH_VITEST_TEMP_ROOT;
  if (!testTempRoot) {
    throw new TypeError("MURPH_VITEST_TEMP_ROOT is required.");
  }
  const root = mkdtempSync(path.join(testTempRoot, "changelog-fragments-"));
  mkdirSync(path.join(root, "entries"), { recursive: true });
  temporaryRoots.push(root);
  return root;
}

function writeEntry(
  root: string,
  publishedOn: string,
  itemId: string,
  order: number,
  overrides: Record<string, unknown> = {},
): void {
  const dateRoot = path.join(root, "entries", publishedOn);
  mkdirSync(dateRoot, { recursive: true });
  writeJson(path.join(dateRoot, `${itemId}.json`), {
    publishedOn,
    order,
    item: {
      id: itemId,
      kind: "feature",
      priority: 3,
      relevanceTags: ["test"],
      sourcePullRequests: [1],
      summary: "A concrete member-visible test outcome.",
      title: "A test changelog item",
    },
    ...overrides,
  });
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
