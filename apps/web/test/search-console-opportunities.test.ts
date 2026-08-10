import { describe, expect, it } from "vitest";

import {
  buildSearchConsoleOpportunitiesCsv,
  rankSearchConsoleOpportunities,
  resolveSearchConsoleDateRange,
  runSearchConsoleOpportunityIntake,
  type SearchConsoleRow,
} from "../scripts/search-console-opportunities";

function row(overrides: Partial<SearchConsoleRow> = {}): SearchConsoleRow {
  return {
    clicks: 3,
    ctr: 0.03,
    impressions: 100,
    page: "https://www.withmurph.ai/",
    position: 11,
    query: "how to understand recovery score",
    ...overrides,
  };
}

describe("Search Console opportunity intake", () => {
  it("uses a final-data window ending three days ago", () => {
    expect(
      resolveSearchConsoleDateRange(new Date("2026-08-10T16:00:00.000Z")),
    ).toEqual({
      endDate: "2026-08-07",
      startDate: "2025-08-07",
    });
  });

  it("ranks non-blog and mismatched landing pages while excluding covered and branded queries", () => {
    const opportunities = rankSearchConsoleOpportunities([
      row(),
      row({
        page: "https://www.withmurph.ai/blog/your-wearable-has-the-numbers-what-happens-next",
        query: "what to do with wearable data",
      }),
      row({
        impressions: 140,
        page: "https://www.withmurph.ai/blog/how-to-run-a-useful-health-experiment",
        query: "best sleep tracker case studies",
      }),
      row({ impressions: 500, query: "murph ai" }),
      row({ impressions: 4, query: "low volume topic" }),
    ]);

    expect(opportunities).toHaveLength(2);
    expect(opportunities[0]).toEqual(
      expect.objectContaining({
        query: "best sleep tracker case studies",
        reason: "query-article-mismatch",
        suggestedFormat: "case-study-candidate",
      }),
    );
    expect(opportunities[1]).toEqual(
      expect.objectContaining({
        query: "how to understand recovery score",
        reason: "ranking-without-dedicated-article",
        suggestedFormat: "guide",
      }),
    );
  });

  it("keeps the strongest landing page per query", () => {
    const opportunities = rankSearchConsoleOpportunities([
      row({ impressions: 40, page: "https://www.withmurph.ai/security" }),
      row({ impressions: 120, page: "https://www.withmurph.ai/knowledge" }),
    ]);

    expect(opportunities).toHaveLength(1);
    expect(opportunities[0].page).toBe("https://www.withmurph.ai/knowledge");
  });

  it("writes spreadsheet-safe CSV without exposing opportunities in console output", () => {
    const [opportunity] = rankSearchConsoleOpportunities([
      row({ query: "=IMPORTXML health results" }),
    ]);
    const csv = buildSearchConsoleOpportunitiesCsv([opportunity]);

    expect(csv).toContain('"\'=importxml health results"');
    expect(csv).toContain('"ranking-without-dedicated-article"');
  });

  it("fails closed before network access when credentials are missing", async () => {
    await expect(runSearchConsoleOpportunityIntake({})).rejects.toThrow(
      "MURPH_GSC_CREDENTIALS_FILE is required",
    );
  });

  it("rejects credential files stored inside the repository", async () => {
    await expect(
      runSearchConsoleOpportunityIntake({
        MURPH_GSC_CREDENTIALS_FILE: "apps/web/package.json",
      }),
    ).rejects.toThrow("must stay outside the repository");
  });
});
