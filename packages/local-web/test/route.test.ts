import assert from "node:assert/strict";

import { beforeEach, test as baseTest, vi } from "vitest";

const test = baseTest.sequential;

vi.mock("../src/lib/overview", () => {
  return {
    DEFAULT_SAMPLE_LIMIT: 6,
    DEFAULT_TIMELINE_LIMIT: 8,
    loadVaultOverviewFromEnv: vi.fn(),
    normalizeOverviewQuery(value: string | string[] | null | undefined): string {
      if (Array.isArray(value)) {
        return typeof value[0] === "string" ? value[0].trim() : "";
      }

      return typeof value === "string" ? value.trim() : "";
    },
    overviewResultToHttpStatus(result: { status: "ready" | "missing-config" | "error" }): number {
      if (result.status === "ready") {
        return 200;
      }

      return result.status === "missing-config" ? 503 : 500;
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

test("overview route returns ready JSON with no-store caching", async () => {
  const { GET } = await import("../app/api/overview/route");
  const { loadVaultOverviewFromEnv } = await import("../src/lib/overview");
  const mockedLoadVaultOverviewFromEnv = vi.mocked(loadVaultOverviewFromEnv);

  mockedLoadVaultOverviewFromEnv.mockResolvedValue({
    currentProfile: null,
    experiments: [],
    generatedAt: "2026-03-12T15:00:00Z",
    metrics: [],
    recentJournals: [],
    sampleSummaries: [],
    search: null,
    status: "ready",
    timeZone: "Australia/Melbourne",
    timeline: [],
    weeklyStats: [],
  });

  const response = await GET(new Request("http://localhost/api/overview?q=%20sleep%20"));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(mockedLoadVaultOverviewFromEnv.mock.calls[0]?.[0], {
    query: "sleep",
    sampleLimit: 6,
    timelineLimit: 8,
  });
});

test("overview route maps missing config to 503", async () => {
  const { GET } = await import("../app/api/overview/route");
  const { loadVaultOverviewFromEnv } = await import("../src/lib/overview");
  const mockedLoadVaultOverviewFromEnv = vi.mocked(loadVaultOverviewFromEnv);

  mockedLoadVaultOverviewFromEnv.mockResolvedValue({
    envVar: "VAULT",
    exampleVaultPath: "fixtures/demo-web-vault",
    status: "missing-config",
    suggestedCommand: "VAULT=fixtures/demo-web-vault pnpm local-web:dev",
  });

  const response = await GET(new Request("http://localhost/api/overview"));

  assert.equal(response.status, 503);
});

test("overview route maps unreadable vaults to 500", async () => {
  const { GET } = await import("../app/api/overview/route");
  const { loadVaultOverviewFromEnv } = await import("../src/lib/overview");
  const mockedLoadVaultOverviewFromEnv = vi.mocked(loadVaultOverviewFromEnv);

  mockedLoadVaultOverviewFromEnv.mockResolvedValue({
    envVar: "VAULT",
    hint: "Confirm the configured vault path points at a Murph vault root, then restart the local app.",
    message: "The configured vault could not be read.",
    recoveryCommand: "VAULT=fixtures/demo-web-vault pnpm local-web:dev",
    status: "error",
  });

  const response = await GET(new Request("http://localhost/api/overview?q=  sleep  "));

  assert.equal(response.status, 500);
  assert.deepEqual(mockedLoadVaultOverviewFromEnv.mock.calls[0]?.[0], {
    query: "sleep",
    sampleLimit: 6,
    timelineLimit: 8,
  });
});
