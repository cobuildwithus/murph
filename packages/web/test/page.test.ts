import assert from "node:assert/strict";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

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

test("HomePage renders the ready state", async () => {
  const { default: HomePage } = await import("../app/page");
  const { loadVaultOverviewFromEnv } = await import("../src/lib/overview");
  const mockedLoadVaultOverviewFromEnv = vi.mocked(loadVaultOverviewFromEnv);

  mockedLoadVaultOverviewFromEnv.mockResolvedValue({
    currentProfile: {
      id: "profile_01",
      recordedAt: "2026-03-12T14:00:00Z",
      summary: "Sleep steadier and energy improving.",
      title: "Current Profile",
      topGoals: [
        {
          id: "goal_sleep_01",
          title: "Protect sleep consistency",
        },
      ],
    },
    experiments: [],
    generatedAt: "2026-03-12T15:00:00Z",
    metrics: [
      {
        label: "records",
        note: "Canonical read model rows",
        value: 10,
      },
    ],
    recentJournals: [
      {
        date: "2026-03-12",
        id: "journal:2026-03-12",
        summary: "Sleep felt steadier after a lighter dinner.",
        tags: ["recovery"],
        title: "March 12",
      },
    ],
    sampleSummaries: [
      {
        averageValue: 97.5,
        date: "2026-03-12",
        sampleCount: 2,
        stream: "glucose",
        unit: "mg_dL",
      },
    ],
    search: {
      hits: [
        {
          date: "2026-03-12",
          kind: "encounter",
          recordId: "evt_web_01",
          recordType: "event",
          snippet: "Sleep consult follow-up",
          title: "Sleep consult follow-up",
        },
      ],
      query: "sleep",
      total: 1,
    },
    status: "ready",
    timeline: [
      {
        entryType: "event",
        id: "evt_web_01",
        kind: "encounter",
        occurredAt: "2026-03-12T09:30:00Z",
        stream: null,
        title: "Sleep consult follow-up",
      },
    ],
    weeklyStats: [],
  });

  const markup = renderToStaticMarkup(await HomePage());

  assert.equal(mockedLoadVaultOverviewFromEnv.mock.calls.length, 1);
  assert.deepEqual(mockedLoadVaultOverviewFromEnv.mock.calls[0]?.[0], {
    sampleLimit: 6,
    timelineLimit: 8,
  });
  assert.match(markup, /Healthy Bob/);
  assert.match(markup, /Protect sleep consistency/);
  assert.doesNotMatch(markup, /localhost only/);
  assert.doesNotMatch(markup, /safe fields only/);
});

test("HomePage renders the setup state when no vault is configured", async () => {
  const { default: HomePage } = await import("../app/page");
  const { loadVaultOverviewFromEnv } = await import("../src/lib/overview");
  const mockedLoadVaultOverviewFromEnv = vi.mocked(loadVaultOverviewFromEnv);

  mockedLoadVaultOverviewFromEnv.mockResolvedValue({
    envVar: "HEALTHYBOB_VAULT",
    exampleVaultPath: "fixtures/demo-web-vault",
    status: "missing-config",
    suggestedCommand: "HEALTHYBOB_VAULT=fixtures/demo-web-vault pnpm web:dev",
  });

  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /No vault configured/);
  assert.match(markup, /HEALTHYBOB_VAULT/);
});

test("HomePage renders the unreadable-vault error state", async () => {
  const { default: HomePage } = await import("../app/page");
  const { loadVaultOverviewFromEnv } = await import("../src/lib/overview");
  const mockedLoadVaultOverviewFromEnv = vi.mocked(loadVaultOverviewFromEnv);

  mockedLoadVaultOverviewFromEnv.mockResolvedValue({
    envVar: "HEALTHYBOB_VAULT",
    hint: "Confirm the configured vault path points at a Healthy Bob vault root, then restart the local app.",
    message: "The configured vault could not be read.",
    recoveryCommand: "HEALTHYBOB_VAULT=fixtures/demo-web-vault pnpm web:dev",
    status: "error",
  });

  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /The configured vault could not be read\./);
  assert.match(markup, /Confirm the configured vault path points at a Healthy Bob vault root/);
});
