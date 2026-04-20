import assert from "node:assert/strict";

import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createBrowserVaultSnapshot: vi.fn(),
  readVaultTolerant: vi.fn(),
}));

vi.mock("@murphai/query", () => ({
  createBrowserVaultSnapshot: mocks.createBrowserVaultSnapshot,
  readVaultTolerant: mocks.readVaultTolerant,
}));

import { exportHostedBrowserVaultSnapshot } from "../src/hosted-runtime/browser-vault.ts";

beforeEach(() => {
  vi.clearAllMocks();
});

test("exports a hosted browser vault snapshot from the tolerant vault read", async () => {
  const snapshot = {
    entities: [{ id: "entity_123" }],
    generatedAt: "2026-04-08T00:00:00.000Z",
    metadata: { title: "Murph" },
    schema: "murph.browser-vault-snapshot.v1",
    sourceVersion: "source_123",
  };
  mocks.readVaultTolerant.mockResolvedValue({
    entities: snapshot.entities,
    metadata: snapshot.metadata,
  });
  mocks.createBrowserVaultSnapshot.mockReturnValue(snapshot);

  const result = await exportHostedBrowserVaultSnapshot({
    sourceVersion: "source_123",
    vaultRoot: "/tmp/hosted-vault",
  });

  expect(mocks.readVaultTolerant).toHaveBeenCalledWith("/tmp/hosted-vault");
  expect(mocks.createBrowserVaultSnapshot).toHaveBeenCalledWith({
    entities: snapshot.entities,
    metadata: snapshot.metadata,
    sourceVersion: "source_123",
  });
  assert.deepEqual(result, snapshot);
});
