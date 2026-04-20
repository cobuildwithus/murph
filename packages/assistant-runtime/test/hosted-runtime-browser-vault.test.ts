import assert from "node:assert/strict";

import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createBrowserVaultSnapshot: vi.fn(),
  createVaultReadModel: vi.fn(),
  readVaultTolerant: vi.fn(),
}));

vi.mock("@murphai/query", () => ({
  createBrowserVaultSnapshot: mocks.createBrowserVaultSnapshot,
  createVaultReadModel: mocks.createVaultReadModel,
  readVaultTolerant: mocks.readVaultTolerant,
}));

import { exportHostedBrowserVaultSnapshot } from "../src/hosted-runtime/browser-vault.ts";

beforeEach(() => {
  vi.clearAllMocks();
});

test("exports a hosted browser vault snapshot from the tolerant vault read", async () => {
  const snapshot = {
    generatedAt: "2026-04-08T00:00:00.000Z",
    history: {
      timeline: [],
    },
    overview: {
      metrics: [],
      recentJournals: [],
      trackedExperiments: [],
      weeklySampleSummaries: [],
    },
    schema: "murph.browser-vault-dashboard-snapshot.v1",
    signals: {
      activity: [],
      assistantSummary: {
        activity: null,
        bodyState: null,
        date: null,
        from: null,
        highlights: [],
        latestDate: null,
        providers: [],
        recovery: null,
        sleep: null,
        sourceHealth: [],
        to: null,
      },
      bodyState: [],
      recovery: [],
      sleep: [],
      sourceHealth: [],
    },
    sourceVersion: "source_123",
  };
  const sourceEntities = [
    {
      entityId: "journal_123",
      family: "journal",
    },
  ];
  const vault = {
    entities: sourceEntities,
    generatedAt: "2026-04-08T00:00:00.000Z",
    metadata: { title: "Murph" },
    vaultRoot: "/tmp/hosted-vault",
  };
  mocks.readVaultTolerant.mockResolvedValue({
    entities: sourceEntities,
    metadata: vault.metadata,
  });
  mocks.createVaultReadModel.mockReturnValue(vault);
  mocks.createBrowserVaultSnapshot.mockReturnValue(snapshot);

  const result = await exportHostedBrowserVaultSnapshot({
    sourceVersion: "source_123",
    vaultRoot: "/tmp/hosted-vault",
  });

  expect(mocks.readVaultTolerant).toHaveBeenCalledWith("/tmp/hosted-vault");
  expect(mocks.createVaultReadModel).toHaveBeenCalledWith({
    entities: sourceEntities,
    metadata: vault.metadata,
    vaultRoot: "/tmp/hosted-vault",
  });
  expect(mocks.createBrowserVaultSnapshot).toHaveBeenCalledWith({
    sourceVersion: "source_123",
    vault,
  });
  expect(mocks.createBrowserVaultSnapshot).toHaveBeenCalledTimes(1);
  assert.deepEqual(result, snapshot);
});
