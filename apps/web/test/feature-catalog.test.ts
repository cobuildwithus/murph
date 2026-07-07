import { describe, expect, it } from "vitest";

import {
  FEATURE_CATALOG_ITEMS,
  type FeatureCatalogItem,
  validateFeatureCatalogItems,
} from "../src/lib/feature-catalog";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const BASE_FEATURE_CATALOG_ITEM: FeatureCatalogItem = {
  alreadyUsing: "the user has already used the fixture feature",
  id: "fixture-feature",
  priority: 3,
  relevanceTags: ["fixture"],
  summary: "Murph can help with a fixture feature in chat.",
  title: "Fixture feature",
  tryIt: {
    label: "Try fixture",
    prompt: "Help me try the fixture feature.",
  },
};

function buildDuplicateIdItems(): readonly FeatureCatalogItem[] {
  return [
    BASE_FEATURE_CATALOG_ITEM,
    {
      ...BASE_FEATURE_CATALOG_ITEM,
      title: "Duplicate fixture feature",
    },
  ];
}

function buildUntrimmedTextItems(): readonly FeatureCatalogItem[] {
  return [
    {
      ...BASE_FEATURE_CATALOG_ITEM,
      id: "untrimmed-text",
      title: " Untrimmed fixture feature",
    },
  ];
}

function buildForbiddenHyphenSummaryItems(): readonly FeatureCatalogItem[] {
  return [
    {
      ...BASE_FEATURE_CATALOG_ITEM,
      id: "forbidden-hyphen-summary",
      summary: "Murph can help - but this punctuation is forbidden.",
    },
  ];
}

function buildForbiddenEmDashSummaryItems(): readonly FeatureCatalogItem[] {
  return [
    {
      ...BASE_FEATURE_CATALOG_ITEM,
      id: "forbidden-em-dash-summary",
      summary: "Murph can help \u2014 but this punctuation is forbidden.",
    },
  ];
}

function buildOutOfRangePriorityItems(): readonly FeatureCatalogItem[] {
  return [
    {
      ...BASE_FEATURE_CATALOG_ITEM,
      id: "out-of-range-priority",
      // @ts-expect-error Negative runtime validation fixture.
      priority: 6,
    },
  ];
}

function buildEmptyRelevanceTagItems(): readonly FeatureCatalogItem[] {
  return [
    {
      ...BASE_FEATURE_CATALOG_ITEM,
      id: "empty-relevance-tags",
      relevanceTags: [],
    },
  ];
}

describe("feature catalog registry", () => {
  it("keeps item ids unique and stable", () => {
    const ids = FEATURE_CATALOG_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(25);
    expect(ids.length).toBeLessThanOrEqual(50);
    expect(ids.every((id) => ID_PATTERN.test(id))).toBe(true);
  });

  it("keeps relevance tags valid and priorities editorially bounded", () => {
    for (const item of FEATURE_CATALOG_ITEMS) {
      expect(item.relevanceTags.length).toBeGreaterThan(0);
      expect(item.relevanceTags.every((tag) => TAG_PATTERN.test(tag))).toBe(true);
      expect(item.priority).toBeGreaterThanOrEqual(1);
      expect(item.priority).toBeLessThanOrEqual(5);
    }
  });

  it("makes every item directly tryable and dedupeable from normal context", () => {
    for (const item of FEATURE_CATALOG_ITEMS) {
      expect(item.tryIt.label.trim()).toBe(item.tryIt.label);
      expect(item.tryIt.label).not.toBe("");
      expect(item.tryIt.prompt.trim()).toBe(item.tryIt.prompt);
      expect(item.tryIt.prompt).not.toBe("");
      expect(item.alreadyUsing.trim()).toBe(item.alreadyUsing);
      expect(item.alreadyUsing).not.toBe("");
    }
  });

  it("keeps summary copy out of forbidden punctuation patterns", () => {
    for (const item of FEATURE_CATALOG_ITEMS) {
      expect(item.summary).not.toContain("\u2014");
      expect(item.summary).not.toContain(" - ");
    }
  });

  it.each([
    [
      "duplicate id",
      buildDuplicateIdItems,
      /Invalid or duplicate feature catalog item id/u,
    ],
    [
      "untrimmed text",
      buildUntrimmedTextItems,
      /Feature catalog item title must be trimmed/u,
    ],
    [
      "summary with spaced hyphen",
      buildForbiddenHyphenSummaryItems,
      /Feature catalog item summary contains forbidden copy punctuation/u,
    ],
    [
      "summary with em dash",
      buildForbiddenEmDashSummaryItems,
      /Feature catalog item summary contains forbidden copy punctuation/u,
    ],
    [
      "out-of-range priority",
      buildOutOfRangePriorityItems,
      /Invalid feature catalog item priority/u,
    ],
    [
      "empty relevanceTags",
      buildEmptyRelevanceTagItems,
      /Invalid feature catalog relevance tags/u,
    ],
  ] as const)(
    "rejects invalid catalog fixtures: %s",
    (_name, buildItems, expectedError) => {
      expect(() => validateFeatureCatalogItems(buildItems())).toThrow(expectedError);
    },
  );
});
