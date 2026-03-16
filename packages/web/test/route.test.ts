import assert from "node:assert/strict";

import { beforeEach, test, vi } from "vitest";

vi.mock("../src/lib/overview", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/overview")>(
    "../src/lib/overview",
  );

  return {
    ...actual,
    loadVaultOverviewFromEnv: vi.fn(),
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
    generatedAt: "2026-03-12T15:00:00Z",
    metrics: [],
    sampleSummaries: [],
    search: null,
    status: "ready",
    timeline: [],
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
    envVar: "HEALTHYBOB_VAULT",
    exampleVaultPath: "../../fixtures/minimal-vault",
    status: "missing-config",
    suggestedCommand: "HEALTHYBOB_VAULT=../../fixtures/minimal-vault pnpm dev",
  });

  const response = await GET(new Request("http://localhost/api/overview"));

  assert.equal(response.status, 503);
});

test("overview route maps unreadable vaults to 500", async () => {
  const { GET } = await import("../app/api/overview/route");
  const { loadVaultOverviewFromEnv } = await import("../src/lib/overview");
  const mockedLoadVaultOverviewFromEnv = vi.mocked(loadVaultOverviewFromEnv);

  mockedLoadVaultOverviewFromEnv.mockResolvedValue({
    envVar: "HEALTHYBOB_VAULT",
    hint: "Confirm the configured vault path points at a Healthy Bob vault root, then restart the local app.",
    message: "The configured vault could not be read.",
    recoveryCommand: "HEALTHYBOB_VAULT=../../fixtures/minimal-vault pnpm dev",
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
