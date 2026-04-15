import { describe, expect, it } from "vitest";

import {
  DERIVED_KNOWLEDGE_SEARCH_RESULT_FORMAT,
  knowledgeGetResultSchema,
  knowledgeIndexRebuildResultSchema,
  knowledgeLintResultSchema,
  knowledgeLogTailResultSchema,
  knowledgePageReferenceSchema,
  knowledgeSearchResultSchema,
  knowledgeUpsertResultSchema,
} from "../src/index.ts";

describe("knowledge contracts", () => {
  const reference = {
    compiledAt: null,
    librarySlugs: ["library"],
    pagePath: "derived/knowledge/pages/example.md",
    pageType: "guide",
    relatedSlugs: ["related-example"],
    slug: "example",
    sourcePaths: ["notes/example.md"],
    status: "published",
    summary: "Example summary.",
    title: "Example page",
  };

  it("parses the shared page and search result shapes from the public query entrypoint", () => {
    expect(knowledgePageReferenceSchema.parse(reference)).toEqual(reference);

    const searchResult = knowledgeSearchResultSchema.parse({
      format: DERIVED_KNOWLEDGE_SEARCH_RESULT_FORMAT,
      hits: [
        {
          ...reference,
          matchedTerms: ["example"],
          score: 0.75,
          snippet: "Example snippet.",
        },
      ],
      pageType: "guide",
      query: "example",
      status: "published",
      total: 1,
      vault: "/vault",
    });

    expect(searchResult.hits[0]?.slug).toBe("example");
    expect(searchResult.format).toBe(DERIVED_KNOWLEDGE_SEARCH_RESULT_FORMAT);
  });

  it("parses the shared get, upsert, rebuild, log, and lint result shapes", () => {
    const page = {
      ...reference,
      body: "Example body.",
      markdown: "# Example page\n\nExample body.",
    };

    expect(
      knowledgeGetResultSchema.parse({
        page,
        vault: "/vault",
      }),
    ).toEqual({
      page,
      vault: "/vault",
    });

    expect(
      knowledgeUpsertResultSchema.parse({
        bodyLength: page.body.length,
        indexPath: "derived/knowledge/index.json",
        page: reference,
        savedAt: "2026-04-08T00:00:00.000Z",
        vault: "/vault",
      }).page,
    ).toEqual(reference);

    expect(
      knowledgeIndexRebuildResultSchema.parse({
        indexPath: "derived/knowledge/index.json",
        pageCount: 1,
        pageTypes: ["guide"],
        rebuilt: true,
        vault: "/vault",
      }).rebuilt,
    ).toBe(true);

    expect(
      knowledgeLogTailResultSchema.parse({
        count: 1,
        entries: [
          {
            action: "upsert",
            block: "knowledge",
            occurredAt: "2026-04-08T00:00:00.000Z",
            title: "Example page",
          },
        ],
        limit: 20,
        logPath: "derived/knowledge/knowledge.log",
        vault: "/vault",
      }).entries,
    ).toHaveLength(1);

    expect(
      knowledgeLintResultSchema.parse({
        ok: false,
        pageCount: 1,
        problemCount: 1,
        problems: [
          {
            code: "missing-summary",
            message: "Example summary is missing.",
            pagePath: reference.pagePath,
            severity: "warning",
            slug: reference.slug,
          },
        ],
        vault: "/vault",
      }).problems[0]?.severity,
    ).toBe("warning");
  });
});
