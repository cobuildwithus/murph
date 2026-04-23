import assert from "node:assert/strict";

import { test } from "vitest";

import {
  BROWSER_VAULT_REPLICA_SCHEMA,
  createBrowserVaultQueryClient,
  createBrowserVaultReplica,
  createVaultReadModel,
  parseBrowserVaultReplica,
  selectBrowserVaultHistory,
  selectBrowserVaultOverview,
  selectBrowserVaultSignals,
  selectBrowserVaultTrackedExperiments,
} from "../src/browser.ts";

type BrowserVaultEntity = Parameters<typeof createVaultReadModel>[0]["entities"][number];

test("browser vault replicas round-trip and expose the query-client selectors", async () => {
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-04-20T12:00:00.000Z",
    sourceBundleHash: "a".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEntity("experiment", "exp_1", {
          body: "# Trial\n\nShort walks are helping with afternoon energy.\n",
          date: "2026-04-18",
          experimentSlug: "light-morning-walk",
          occurredAt: "2026-04-18T08:00:00.000Z",
          status: "active",
          tags: ["movement"],
          title: "Morning walk",
        }),
        createEntity("journal", "journal_1", {
          body: "# Note\n\nFelt steadier after a full night of sleep.\n",
          date: "2026-04-20",
          occurredAt: "2026-04-20T07:30:00.000Z",
          tags: ["sleep", "travel"],
          title: "Travel recovery note",
        }),
        createEntity("sample", "sample_1", {
          attributes: {
            unit: "min",
            value: 430,
          },
          date: "2026-04-20",
          occurredAt: "2026-04-20T08:30:00.000Z",
          stream: "sleep_duration_minutes",
          title: "Sleep duration",
        }),
        createEntity("sample", "sample_2", {
          attributes: {
            unit: "min",
            value: 400,
          },
          date: "2026-04-13",
          occurredAt: "2026-04-13T08:30:00.000Z",
          stream: "sleep_duration_minutes",
          title: "Sleep duration",
        }),
      ],
      metadata: {
        title: "Browser vault fixture",
      },
      vaultRoot: "browser://vault",
    }),
  });

  assert.equal(replica.schema, BROWSER_VAULT_REPLICA_SCHEMA);
  assert.equal(replica.source.sourceBundleHash, "a".repeat(64));
  assert.match(replica.source.dataVersion, /^[0-9a-f]{64}$/u);

  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));
  const overview = selectBrowserVaultOverview(client);
  const history = selectBrowserVaultHistory(client);
  const signals = selectBrowserVaultSignals(client);

  assert.equal(selectBrowserVaultTrackedExperiments(client)[0]?.title, "Morning walk");
  assert.equal(overview.recentJournals[0]?.title, "Travel recovery note");
  assert.ok(history.timeline.some((entry) => entry.title === "Travel recovery note"));
  assert.equal(signals.assistantSummary.latestDate, null);
  assert.equal(client.entities.get("exp_1")?.title, "Morning walk");
  assert.ok(client.search("steadier").some((row) => row.entityId === "journal_1"));
});

test("browser vault replica dataVersion stays stable when only generatedAt changes", async () => {
  const vault = createVaultReadModel({
    entities: [
      createEntity("journal", "journal_1", {
        body: "Kept the baseline ordinary.",
        title: "Baseline note",
      }),
    ],
    metadata: null,
    vaultRoot: "browser://vault",
  });

  const first = await createBrowserVaultReplica({
    generatedAt: "2026-04-20T12:00:00.000Z",
    sourceBundleHash: "b".repeat(64),
    vault,
  });
  const second = await createBrowserVaultReplica({
    generatedAt: "2026-04-21T12:00:00.000Z",
    sourceBundleHash: "b".repeat(64),
    vault,
  });

  assert.equal(first.source.dataVersion, second.source.dataVersion);
});

test("browser vault replica dataVersion changes when only sourceBundleHash changes", async () => {
  const vault = createVaultReadModel({
    entities: [
      createEntity("journal", "journal_1", {
        body: "Kept the baseline ordinary.",
        title: "Baseline note",
      }),
    ],
    metadata: null,
    vaultRoot: "browser://vault",
  });

  const first = await createBrowserVaultReplica({
    generatedAt: "2026-04-20T12:00:00.000Z",
    sourceBundleHash: "b".repeat(64),
    vault,
  });
  const second = await createBrowserVaultReplica({
    generatedAt: "2026-04-20T12:00:00.000Z",
    sourceBundleHash: "c".repeat(64),
    vault,
  });

  assert.notEqual(first.source.dataVersion, second.source.dataVersion);
});

test("browser vault replicas validate schema", () => {
  assert.throws(
    () => parseBrowserVaultReplica({
      schema: "murph.browser-vault-replica.wrong",
    }),
    /Browser vault replica\.schema must be murph\.browser-vault-replica\.v1\./u,
  );
});

function createEntity(
  family: BrowserVaultEntity["family"],
  entityId: string,
  overrides: Partial<BrowserVaultEntity> = {},
): BrowserVaultEntity {
  const title = overrides.title ?? entityId;
  const kind = overrides.kind ?? `${family}_entry`;
  const stream = overrides.stream ?? null;
  const lookupId = overrides.primaryLookupId ?? entityId;

  return {
    attributes: overrides.attributes ?? {},
    body: overrides.body ?? null,
    date: overrides.date ?? "2026-04-20",
    entityId,
    experimentSlug: overrides.experimentSlug ?? null,
    family,
    frontmatter: overrides.frontmatter ?? null,
    kind,
    links: overrides.links ?? [],
    lookupIds: overrides.lookupIds ?? [lookupId],
    occurredAt: overrides.occurredAt ?? "2026-04-20T00:00:00.000Z",
    path: overrides.path ?? `history/${family}/${entityId}.md`,
    primaryLookupId: lookupId,
    recordClass: overrides.recordClass ?? resolveRecordClass(family),
    relatedIds: overrides.relatedIds ?? [],
    status: overrides.status ?? null,
    stream,
    tags: overrides.tags ?? [],
    title,
  };
}

function resolveRecordClass(family: BrowserVaultEntity["family"]): BrowserVaultEntity["recordClass"] {
  switch (family) {
    case "experiment":
      return "bank";
    case "journal":
      return "ledger";
    case "sample":
      return "sample";
    default:
      throw new Error(`Unsupported browser-vault test family: ${family}`);
  }
}
