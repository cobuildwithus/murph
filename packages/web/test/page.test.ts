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

vi.mock("../src/lib/device-sync", () => {
  return {
    loadDeviceSyncOverviewFromEnv: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

test("HomePage renders the ready state", async () => {
  const { default: HomePage } = await import("../app/page");
  const { loadVaultOverviewFromEnv } = await import("../src/lib/overview");
  const { loadDeviceSyncOverviewFromEnv } = await import("../src/lib/device-sync");
  const mockedLoadVaultOverviewFromEnv = vi.mocked(loadVaultOverviewFromEnv);
  const mockedLoadDeviceSyncOverviewFromEnv = vi.mocked(loadDeviceSyncOverviewFromEnv);

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
    experiments: [
      {
        id: "exp_sleep_reset_01",
        slug: "sleep-reset",
        startedOn: "2026-03-08",
        status: "active",
        summary: "Keep the last meal earlier and hold the rest steady.",
        tags: ["sleep", "recovery"],
        title: "Sleep Reset",
      },
    ],
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
  mockedLoadDeviceSyncOverviewFromEnv.mockResolvedValue({
    status: "ready",
    baseUrl: "http://127.0.0.1:8788",
    providers: [
      {
        provider: "whoop",
        callbackPath: "/oauth/whoop/callback",
        callbackUrl: "http://127.0.0.1:8788/oauth/whoop/callback",
        webhookPath: "/webhooks/whoop",
        webhookUrl: "http://127.0.0.1:8788/webhooks/whoop",
        supportsWebhooks: true,
        defaultScopes: ["offline", "read:profile", "read:sleep"],
      },
    ],
    accounts: [],
  });

  const markup = renderToStaticMarkup(await HomePage());

  assert.equal(mockedLoadVaultOverviewFromEnv.mock.calls.length, 1);
  assert.equal(mockedLoadDeviceSyncOverviewFromEnv.mock.calls.length, 1);
  assert.deepEqual(mockedLoadVaultOverviewFromEnv.mock.calls[0]?.[0], {
    sampleLimit: 6,
    timelineLimit: 8,
  });
  assert.match(markup, /Healthy Bob/);
  assert.match(markup, /Weekly compass/);
  assert.match(markup, /What changed, what stayed steady, and what can stay simple/);
  assert.match(markup, /Not enough prior-week data yet to call a meaningful shift\./);
  assert.match(markup, /Current investigations/);
  assert.match(markup, /Keep the current investigation simple long enough to learn something from it\./);
  assert.match(markup, /Sleep Reset/);
  assert.match(markup, /Protect sleep consistency/);
  assert.match(markup, /Wearable connections/);
  assert.match(markup, /Connect/);
  assert.ok(markup.indexOf("Weekly compass") < markup.indexOf("Current investigations"));
  assert.ok(markup.indexOf("Current investigations") < markup.indexOf("Wearable connections"));
  assert.doesNotMatch(markup, /localhost only/);
  assert.doesNotMatch(markup, /safe fields only/);
});

test("HomePage keeps additional weekly stat rows when the same stream has multiple units", async () => {
  const { default: HomePage } = await import("../app/page");
  const { loadVaultOverviewFromEnv } = await import("../src/lib/overview");
  const { loadDeviceSyncOverviewFromEnv } = await import("../src/lib/device-sync");
  const mockedLoadVaultOverviewFromEnv = vi.mocked(loadVaultOverviewFromEnv);
  const mockedLoadDeviceSyncOverviewFromEnv = vi.mocked(loadDeviceSyncOverviewFromEnv);

  mockedLoadVaultOverviewFromEnv.mockResolvedValue({
    currentProfile: null,
    experiments: [],
    generatedAt: "2026-03-24T15:00:00Z",
    metrics: [],
    recentJournals: [],
    sampleSummaries: [],
    search: null,
    status: "ready",
    timeline: [],
    weeklyStats: [
      {
        currentWeekAvg: 7.5,
        deltaPercent: 5,
        previousWeekAvg: 7.1,
        stream: "sleep",
        unit: "hrs",
      },
      {
        currentWeekAvg: 450,
        deltaPercent: 7,
        previousWeekAvg: 420,
        stream: "sleep",
        unit: "min",
      },
    ],
  });
  mockedLoadDeviceSyncOverviewFromEnv.mockResolvedValue({
    status: "ready",
    baseUrl: "http://127.0.0.1:8788",
    providers: [],
    accounts: [],
  });

  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, />7.5</);
  assert.match(markup, />450</);
  assert.match(markup, />hrs</);
  assert.match(markup, />min</);
});

test("HomePage keeps the current investigations section scoped to active experiments", async () => {
  const { default: HomePage } = await import("../app/page");
  const { loadVaultOverviewFromEnv } = await import("../src/lib/overview");
  const { loadDeviceSyncOverviewFromEnv } = await import("../src/lib/device-sync");
  const mockedLoadVaultOverviewFromEnv = vi.mocked(loadVaultOverviewFromEnv);
  const mockedLoadDeviceSyncOverviewFromEnv = vi.mocked(loadDeviceSyncOverviewFromEnv);

  mockedLoadVaultOverviewFromEnv.mockResolvedValue({
    currentProfile: null,
    experiments: [
      {
        id: "exp_done_01",
        slug: "sleep-reset",
        startedOn: "2026-03-08",
        status: "completed",
        summary: "Completed already.",
        tags: ["sleep"],
        title: "Sleep Reset",
      },
    ],
    generatedAt: "2026-03-24T15:00:00Z",
    metrics: [],
    recentJournals: [],
    sampleSummaries: [],
    search: null,
    status: "ready",
    timeline: [],
    weeklyStats: [],
  });
  mockedLoadDeviceSyncOverviewFromEnv.mockResolvedValue({
    status: "ready",
    baseUrl: "http://127.0.0.1:8788",
    providers: [],
    accounts: [],
  });

  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /Current investigations/);
  assert.match(markup, /No active investigations right now\./);
  assert.doesNotMatch(markup, /Sleep Reset/);
});

test("HomePage renders the setup state when no vault is configured", async () => {
  const { default: HomePage } = await import("../app/page");
  const { loadVaultOverviewFromEnv } = await import("../src/lib/overview");
  const { loadDeviceSyncOverviewFromEnv } = await import("../src/lib/device-sync");
  const mockedLoadVaultOverviewFromEnv = vi.mocked(loadVaultOverviewFromEnv);
  const mockedLoadDeviceSyncOverviewFromEnv = vi.mocked(loadDeviceSyncOverviewFromEnv);

  mockedLoadVaultOverviewFromEnv.mockResolvedValue({
    envVar: "VAULT",
    exampleVaultPath: "fixtures/demo-web-vault",
    status: "missing-config",
    suggestedCommand: "VAULT=fixtures/demo-web-vault pnpm web:dev",
  });
  mockedLoadDeviceSyncOverviewFromEnv.mockResolvedValue({
    status: "unavailable",
    baseUrl: "http://127.0.0.1:8788",
    message: "Device sync is offline.",
    hint: "Start the Healthy Bob-managed local device sync daemon, then refresh this page to connect or inspect wearable accounts.",
    suggestedCommand: "healthybob device daemon start --vault <your-vault>",
  });

  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /No vault configured/);
  assert.match(markup, /VAULT/);
  assert.match(markup, /save a default Healthy Bob vault first/);
});

test("HomePage renders the unreadable-vault error state", async () => {
  const { default: HomePage } = await import("../app/page");
  const { loadVaultOverviewFromEnv } = await import("../src/lib/overview");
  const { loadDeviceSyncOverviewFromEnv } = await import("../src/lib/device-sync");
  const mockedLoadVaultOverviewFromEnv = vi.mocked(loadVaultOverviewFromEnv);
  const mockedLoadDeviceSyncOverviewFromEnv = vi.mocked(loadDeviceSyncOverviewFromEnv);

  mockedLoadVaultOverviewFromEnv.mockResolvedValue({
    envVar: "VAULT",
    hint: "Confirm the configured vault path points at a Healthy Bob vault root, then restart the local app.",
    message: "The configured vault could not be read.",
    recoveryCommand: "VAULT=fixtures/demo-web-vault pnpm web:dev",
    status: "error",
  });
  mockedLoadDeviceSyncOverviewFromEnv.mockResolvedValue({
    status: "unavailable",
    baseUrl: "http://127.0.0.1:8788",
    message: "Device sync is offline.",
    hint: "Start the Healthy Bob-managed local device sync daemon, then refresh this page to connect or inspect wearable accounts.",
    suggestedCommand: "healthybob device daemon start --vault <your-vault>",
  });

  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /The configured vault could not be read\./);
  assert.match(markup, /Confirm the configured vault path points at a Healthy Bob vault root/);
});
