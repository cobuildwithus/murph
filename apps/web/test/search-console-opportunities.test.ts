import { generateKeyPairSync } from "node:crypto";
import {
  access,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

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
      row({
        impressions: 130,
        page: "https://www.withmurph.ai/blog/your-wearable-has-the-numbers-what-happens-next",
        query: "what causes high blood pressure",
      }),
      row({
        page: "https://www.withmurph.ai/blog/your-wearable-has-the-numbers-what-happens-next",
        query: "ways to understand recovery score",
      }),
      row({ impressions: 500, query: "murph ai" }),
      row({ impressions: 4, query: "low volume topic" }),
    ]);

    expect(opportunities).toHaveLength(3);
    expect(opportunities[0]).toEqual(
      expect.objectContaining({
        query: "best sleep tracker case studies",
        reason: "query-article-mismatch",
        suggestedFormat: "case-study-candidate",
      }),
    );
    expect(opportunities[1]).toEqual(
      expect.objectContaining({
        query: "what causes high blood pressure",
        reason: "query-article-mismatch",
      }),
    );
    expect(opportunities[2]).toEqual(
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

  it("uses only the read-only scope and paginates the expected Search Analytics request", async () => {
    const fixture = await createServiceAccountFixture();
    const startRows: number[] = [];
    const request = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        const form = new URLSearchParams(String(init?.body));
        const assertion = form.get("assertion");
        expect(assertion).toBeTruthy();
        const [, encodedClaims] = assertion?.split(".") ?? [];
        const claims = JSON.parse(
          Buffer.from(encodedClaims ?? "", "base64url").toString("utf8"),
        ) as { scope?: string };
        expect(claims.scope).toBe(
          "https://www.googleapis.com/auth/webmasters.readonly",
        );
        return Response.json({ access_token: "test-read-only-token" });
      }

      expect(url).toBe(
        "https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Awithmurph.ai/searchAnalytics/query",
      );
      expect(init?.headers).toEqual(
        expect.objectContaining({
          Authorization: "Bearer test-read-only-token",
        }),
      );
      const body = JSON.parse(String(init?.body)) as {
        dataState?: string;
        dimensions?: string[];
        rowLimit?: number;
        searchType?: string;
        startRow?: number;
      };
      expect(body).toEqual(
        expect.objectContaining({
          dataState: "final",
          dimensions: ["query", "page"],
          rowLimit: 2,
          searchType: "web",
        }),
      );
      startRows.push(body.startRow ?? -1);
      const rows = body.startRow === 0
        ? [
          googleRow("first useful question"),
          googleRow("second useful question"),
        ]
        : [googleRow("third useful question")];
      return Response.json({ rows });
    });

    try {
      const result = await runSearchConsoleOpportunityIntake(
        { MURPH_GSC_CREDENTIALS_FILE: fixture.filePath },
        {
          fetch: request,
          maxSearchAnalyticsRows: 4,
          now: new Date("2040-01-10T00:00:00.000Z"),
          searchAnalyticsRowLimit: 2,
        },
      );
      expect(result).toEqual(
        expect.objectContaining({
          opportunityCount: 3,
          rowCount: 3,
          truncated: false,
        }),
      );
      expect(startRows).toEqual([0, 2]);
      expect(await readFile(result.outputPath, "utf8")).toContain(
        "first useful question",
      );
      await rm(result.outputPath, { force: true });
    } finally {
      await fixture.cleanup();
    }
  });

  it("returns a partial status when the bounded final page is full", async () => {
    const fixture = await createServiceAccountFixture();
    const request = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "test-read-only-token" });
      }
      const body = JSON.parse(String(init?.body)) as { startRow?: number };
      return Response.json({
        rows: [
          googleRow(`bounded question ${body.startRow ?? 0}`),
          googleRow(`bounded question ${(body.startRow ?? 0) + 1}`),
        ],
      });
    });

    try {
      const result = await runSearchConsoleOpportunityIntake(
        { MURPH_GSC_CREDENTIALS_FILE: fixture.filePath },
        {
          fetch: request,
          maxSearchAnalyticsRows: 4,
          now: new Date("2042-01-10T00:00:00.000Z"),
          searchAnalyticsRowLimit: 2,
        },
      );
      expect(result).toEqual(
        expect.objectContaining({ rowCount: 4, truncated: true }),
      );
      expect(await readFile(result.outputPath, "utf8")).toContain(
        "bounded question",
      );
      await rm(result.outputPath, { force: true });
    } finally {
      await fixture.cleanup();
    }
  });

  it("fails closed on Google authorization failure without writing output", async () => {
    const fixture = await createServiceAccountFixture();
    const outputPath = path.join(
      process.cwd(),
      ".artifacts/seo/search-console-opportunities-2041-01-07.csv",
    );
    await rm(outputPath, { force: true });
    const request = vi.fn<typeof fetch>(async (input) =>
      String(input) === "https://oauth2.googleapis.com/token"
        ? Response.json({ access_token: "test-read-only-token" })
        : Response.json({ error: { code: 403 } }, { status: 403 })
    );

    try {
      await expect(
        runSearchConsoleOpportunityIntake(
          { MURPH_GSC_CREDENTIALS_FILE: fixture.filePath },
          {
            fetch: request,
            now: new Date("2041-01-10T00:00:00.000Z"),
          },
        ),
      ).rejects.toThrow("Search Console query failed with status 403");
      await expect(access(outputPath)).rejects.toThrow();
    } finally {
      await fixture.cleanup();
    }
  });

  it("cancels an oversized Google response before buffering the remaining chunks", async () => {
    const fixture = await createServiceAccountFixture();
    let cancelled = false;
    let pulls = 0;
    const oversizedBody = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      pull(controller) {
        pulls += 1;
        if (pulls > 4) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(40 * 1024).fill(65));
      },
    });
    const request = vi.fn<typeof fetch>(async () =>
      new Response(oversizedBody, { status: 200 })
    );

    try {
      await expect(
        runSearchConsoleOpportunityIntake(
          { MURPH_GSC_CREDENTIALS_FILE: fixture.filePath },
          { fetch: request },
        ),
      ).rejects.toThrow("response larger than the allowed limit");
      expect(cancelled).toBe(true);
      expect(pulls).toBeLessThan(4);
    } finally {
      await fixture.cleanup();
    }
  });
});

function googleRow(query: string) {
  return {
    clicks: 3,
    ctr: 0.03,
    impressions: 100,
    keys: [query, "https://www.withmurph.ai/"],
    position: 11,
  };
}

async function createServiceAccountFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "murph-gsc-test-"));
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const filePath = path.join(directory, "service-account.json");
  await writeFile(
    filePath,
    JSON.stringify({
      client_email: "search-console-test@example.invalid",
      private_key: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      token_uri: "https://oauth2.googleapis.com/token",
      type: "service_account",
    }),
    "utf8",
  );

  return {
    cleanup: () => rm(directory, { force: true, recursive: true }),
    filePath,
  };
}
