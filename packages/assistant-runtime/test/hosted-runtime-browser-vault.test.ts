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
    entities: [
      {
        attributes: { source: "journal" },
        body: `${"A".repeat(320)} trailing text`,
        date: "2026-04-08",
        entityId: "journal_123",
        experimentSlug: null,
        family: "journal",
        frontmatter: { mood: "steady" },
        kind: "journal_day",
        links: [],
        lookupIds: ["journal_123"],
        occurredAt: "2026-04-08T00:00:00.000Z",
        path: "journal/2026-04-08.md",
        primaryLookupId: "journal_123",
        recordClass: "ledger",
        relatedIds: [],
        status: null,
        stream: null,
        tags: ["journal"],
        title: "Daily note",
      },
      {
        attributes: { metric: "sleep" },
        body: null,
        date: "2026-04-08",
        entityId: "sample_123",
        experimentSlug: null,
        family: "sample",
        frontmatter: null,
        kind: "measurement",
        links: [],
        lookupIds: ["sample_123"],
        occurredAt: "2026-04-08T00:00:00.000Z",
        path: "samples/2026-04-08.jsonl",
        primaryLookupId: "sample_123",
        recordClass: "sample",
        relatedIds: [],
        status: null,
        stream: "sleep_minutes",
        tags: ["sample"],
        title: "Sleep minutes",
      },
      {
        attributes: { city: "Sensitive City" },
        body: "should be removed",
        date: null,
        entityId: "family_123",
        experimentSlug: null,
        family: "family",
        frontmatter: { private: true },
        kind: "family_member",
        links: [],
        lookupIds: ["family_123"],
        occurredAt: null,
        path: "family/member.md",
        primaryLookupId: "family_123",
        recordClass: "bank",
        relatedIds: [],
        status: null,
        stream: null,
        tags: ["family"],
        title: "Sibling",
      },
      {
        attributes: { calories: 500 },
        body: "food details",
        date: null,
        entityId: "food_123",
        experimentSlug: null,
        family: "food",
        frontmatter: null,
        kind: "food",
        links: [],
        lookupIds: ["food_123"],
        occurredAt: null,
        path: "food/item.md",
        primaryLookupId: "food_123",
        recordClass: "bank",
        relatedIds: [],
        status: null,
        stream: null,
        tags: ["food"],
        title: "Meal",
      },
    ],
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
    entities: [
      expect.objectContaining({
        entityId: "journal_123",
        family: "journal",
      }),
      expect.objectContaining({
        attributes: { metric: "sleep" },
        entityId: "sample_123",
        family: "sample",
      }),
      expect.objectContaining({
        attributes: {},
        body: null,
        entityId: "family_123",
        family: "family",
        frontmatter: null,
      }),
    ],
    metadata: snapshot.metadata,
    sourceVersion: "source_123",
  });
  expect(mocks.createBrowserVaultSnapshot).toHaveBeenCalledTimes(1);
  const projected = mocks.createBrowserVaultSnapshot.mock.calls[0]?.[0]?.entities;
  expect(projected).toHaveLength(3);
  expect(projected?.some((entity: { entityId: string }) => entity.entityId === "food_123")).toBe(false);
  expect(projected?.[0]?.body).toHaveLength(280);
  expect(projected?.[0]?.body.endsWith("...")).toBe(true);
  assert.deepEqual(result, snapshot);
});
