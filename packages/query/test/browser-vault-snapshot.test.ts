import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, test } from "vitest";

import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";

import {
  resolveCanonicalRecordClass,
  type CanonicalEntity,
} from "../src/canonical-entities.ts";
import {
  BROWSER_VAULT_SNAPSHOT_SCHEMA,
  createBrowserVaultSnapshot,
  parseBrowserVaultSnapshot,
} from "../src/browser-snapshot.ts";
import { createVaultReadModel } from "../src/model.ts";
import { readVaultTolerant } from "../src/vault-reader.ts";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((vaultRoot) =>
    rm(vaultRoot, { recursive: true, force: true })
  ));
});

test("browser vault snapshots clone dashboard projections before serialization", () => {
  const experiment = createEntity("experiment", "exp_browser_01", {
    body: "# Trial\n\nKeep the sauna protocol lightweight.\n",
    date: "2026-04-17",
    experimentSlug: "sauna-protocol",
    occurredAt: "2026-04-17T08:00:00.000Z",
    status: "active",
    tags: ["browser"],
    title: "Browser experiment",
  });
  const journal = createEntity("journal", "journal_browser_01", {
    body: "# Journal\n\n- Good energy\n",
    date: "2026-04-16",
    occurredAt: "2026-04-16T08:00:00.000Z",
    tags: ["journal"],
    title: "Browser journal",
  });
  const sample = createEntity("sample", "sample_browser_01", {
    attributes: {
      unit: "ms",
      value: 48,
    },
    date: "2026-04-17",
    occurredAt: "2026-04-17T08:30:00.000Z",
    stream: "hrv",
    tags: ["signal"],
    title: "HRV sample",
  });
  const vault = createVaultReadModel({
    entities: [experiment, journal, sample],
    metadata: {
      title: "Browser vault",
    },
    vaultRoot: "browser://vault",
  });

  const snapshot = createBrowserVaultSnapshot({
    generatedAt: "2026-04-17T08:05:00.000Z",
    sourceVersion: "a".repeat(64),
    vault,
  });

  experiment.tags.push("mutated");
  experiment.body = "Mutated protocol body";
  journal.tags.push("mutated");
  sample.attributes = {
    unit: "ms",
    value: 90,
  };

  assert.deepEqual(snapshot.overview.trackedExperiments[0], {
    id: "exp_browser_01",
    slug: "sauna-protocol",
    startedOn: "2026-04-17",
    status: "active",
    summary: "Keep the sauna protocol lightweight.",
    tags: ["browser"],
    title: "Browser experiment",
  });
  assert.deepEqual(snapshot.overview.recentJournals[0], {
    date: "2026-04-16",
    id: "journal_browser_01",
    summary: "Good energy",
    tags: ["journal"],
    title: "Browser journal",
  });
  assert.equal(snapshot.history.timeline[0]?.id, "sample-summary:2026-04-17:hrv:ms");
  assert.deepEqual(snapshot.history.timeline[0]?.tags, ["sample_summary", "hrv"]);
  assert.equal(snapshot.overview.weeklySampleSummaries[0]?.averageValue, 48);
});

test("browser vault snapshots parse dashboard projections and validate schema", () => {
  const snapshot = createBrowserVaultSnapshot({
    generatedAt: "2026-04-17T08:05:00.000Z",
    sourceVersion: "b".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEntity("experiment", "exp_browser_parse", {
          body: "Track the protocol.",
          date: "2026-04-17",
          occurredAt: "2026-04-17T08:00:00.000Z",
          status: "active",
          title: "Parse experiment",
        }),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });
  const parsed = parseBrowserVaultSnapshot(
    JSON.parse(JSON.stringify(snapshot)) as unknown,
  );

  assert.equal(parsed.schema, BROWSER_VAULT_SNAPSHOT_SCHEMA);
  assert.equal(parsed.overview.trackedExperiments[0]?.id, "exp_browser_parse");
  assert.equal(parsed.overview.trackedExperiments[0]?.title, "Parse experiment");
  assert.deepEqual(parsed.history.timeline, snapshot.history.timeline);

  assert.throws(
    () =>
      parseBrowserVaultSnapshot({
        ...snapshot,
        generatedAt: "2026-04-17T08:05:00.000Z",
        schema: "murph.browser-vault-dashboard-snapshot.wrong",
      }),
    /Browser vault snapshot\.schema must be murph\.browser-vault-dashboard-snapshot\.v1\./,
  );

  assert.throws(
    () =>
      parseBrowserVaultSnapshot({
        ...snapshot,
        history: {
          timeline: {},
        },
      }),
    /Browser vault snapshot\.history\.timeline must be an array\./,
  );

  assert.throws(
    () => parseBrowserVaultSnapshot(null),
    /Browser vault snapshot must be an object\./,
  );

  assert.throws(
    () =>
      parseBrowserVaultSnapshot({
        ...snapshot,
        overview: {},
      }),
    /Browser vault snapshot\.overview\.metrics must be an array\./,
  );
});

test("readVaultTolerant materializes a read model from canonical vault files without the projection store", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-browser-tolerant-"));
  tempRoots.push(vaultRoot);

  await mkdir(path.join(vaultRoot, "bank/goals"), { recursive: true });
  await writeFile(
    path.join(vaultRoot, "vault.json"),
    JSON.stringify({
      createdAt: "2026-04-17T00:00:00.000Z",
      formatVersion: CURRENT_VAULT_FORMAT_VERSION,
      timezone: "UTC",
      title: "Browser tolerant vault",
      vaultId: "vault_01K72NVW6Z4QK8VYAVX7GT7S4B",
    }),
    "utf8",
  );
  await writeFile(
    path.join(vaultRoot, "bank/goals/morning-light.md"),
    `---
title: Morning light
status: active
tags:
  - recovery
---

Get outside after waking.
`,
    "utf8",
  );

  const vault = await readVaultTolerant(vaultRoot);

  assert.equal(vault.vaultRoot, vaultRoot);
  assert.equal(vault.metadata?.title, "Browser tolerant vault");
  assert.ok(Array.isArray(vault.entities));
});

function createEntity(
  family: CanonicalEntity["family"],
  entityId: string,
  overrides: Partial<CanonicalEntity> = {},
): CanonicalEntity {
  return {
    attributes: {},
    body: null,
    date: null,
    entityId,
    experimentSlug: null,
    family,
    frontmatter: null,
    kind: family,
    links: [],
    lookupIds: [entityId],
    occurredAt: null,
    path: `${family}/${entityId}.md`,
    primaryLookupId: entityId,
    recordClass: resolveCanonicalRecordClass(family),
    relatedIds: [],
    status: null,
    stream: null,
    tags: [],
    title: entityId,
    ...overrides,
  };
}
