import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, test } from "vitest";

import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";

import type { CanonicalEntity } from "../src/canonical-entities.ts";
import {
  BROWSER_VAULT_SNAPSHOT_SCHEMA,
  createBrowserVaultSnapshot,
  parseBrowserVaultSnapshot,
} from "../src/browser-snapshot.ts";
import { readVaultTolerant } from "../src/vault-reader.ts";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((vaultRoot) =>
    rm(vaultRoot, { recursive: true, force: true })
  ));
});

test("browser vault snapshots clone entities and metadata before serialization", () => {
  const entity: CanonicalEntity = {
    attributes: {
      nested: {
        state: "active",
      },
    },
    body: "Body copy",
    date: "2026-04-17",
    entityId: "goal_browser_01",
    experimentSlug: null,
    family: "goal",
    frontmatter: {
      title: "Browser goal",
    },
    kind: "goal",
    links: [{ targetId: "cond_browser_01", type: "addresses_condition" }],
    lookupIds: ["goal_browser_01"],
    occurredAt: "2026-04-17T08:00:00.000Z",
    path: "bank/goals/browser.md",
    primaryLookupId: "goal_browser_01",
    recordClass: "bank",
    relatedIds: ["cond_browser_01"],
    status: "active",
    stream: null,
    tags: ["browser"],
    title: "Browser goal",
  };
  const metadata = {
    nested: {
      enabled: true,
    },
  };

  const snapshot = createBrowserVaultSnapshot({
    entities: [entity],
    generatedAt: "2026-04-17T08:05:00.000Z",
    metadata,
    sourceVersion: "a".repeat(64),
  });

  entity.attributes.nested = { state: "mutated" };
  entity.frontmatter = { title: "Mutated" };
  entity.links[0]!.targetId = "mutated";
  entity.lookupIds.push("goal_browser_02");
  entity.relatedIds.push("cond_browser_02");
  entity.tags.push("mutated");
  metadata.nested.enabled = false;

  assert.deepEqual(snapshot.entities[0], {
    attributes: {
      nested: {
        state: "active",
      },
    },
    body: "Body copy",
    date: "2026-04-17",
    entityId: "goal_browser_01",
    experimentSlug: null,
    family: "goal",
    frontmatter: {
      title: "Browser goal",
    },
    kind: "goal",
    links: [{ targetId: "cond_browser_01", type: "addresses_condition" }],
    lookupIds: ["goal_browser_01"],
    occurredAt: "2026-04-17T08:00:00.000Z",
    path: "bank/goals/browser.md",
    primaryLookupId: "goal_browser_01",
    recordClass: "bank",
    relatedIds: ["cond_browser_01"],
    status: "active",
    stream: null,
    tags: ["browser"],
    title: "Browser goal",
  });
  assert.deepEqual(snapshot.metadata, {
    nested: {
      enabled: true,
    },
  });
});

test("browser vault snapshots parse canonical entities and validate schema", () => {
  const parsed = parseBrowserVaultSnapshot({
    entities: [{
      attributes: {
        score: 5,
      },
      body: null,
      date: null,
      entityId: "journal_browser_01",
      experimentSlug: null,
      family: "journal",
      frontmatter: null,
      kind: "journal_day",
      links: [],
      lookupIds: ["journal_browser_01"],
      occurredAt: null,
      path: "history/journal/2026-04-17.md",
      primaryLookupId: "journal_browser_01",
      recordClass: "history",
      relatedIds: [],
      status: null,
      stream: null,
      tags: [],
      title: null,
    }],
    generatedAt: "2026-04-17T08:05:00.000Z",
    metadata: null,
    schema: BROWSER_VAULT_SNAPSHOT_SCHEMA,
    sourceVersion: "b".repeat(64),
  });

  assert.equal(parsed.schema, BROWSER_VAULT_SNAPSHOT_SCHEMA);
  assert.equal(parsed.entities[0]?.entityId, "journal_browser_01");
  assert.equal(parsed.entities[0]?.title, null);
  assert.equal(parsed.metadata, null);

  assert.throws(
    () =>
      parseBrowserVaultSnapshot({
        entities: [],
        generatedAt: "2026-04-17T08:05:00.000Z",
        metadata: null,
        schema: "murph.browser-vault-snapshot.wrong",
        sourceVersion: "b".repeat(64),
      }),
    /Browser vault snapshot\.schema must be murph\.browser-vault-snapshot\.v1\./,
  );

  assert.throws(
    () =>
      parseBrowserVaultSnapshot({
        entities: [{
          lookupIds: [],
        }],
        generatedAt: "2026-04-17T08:05:00.000Z",
        metadata: null,
        schema: BROWSER_VAULT_SNAPSHOT_SCHEMA,
        sourceVersion: "b".repeat(64),
      }),
    /Browser vault snapshot\.entities\[0\]\.entityId must be a non-empty string\./,
  );

  assert.throws(
    () => parseBrowserVaultSnapshot(null),
    /Browser vault snapshot must be an object\./,
  );

  assert.throws(
    () =>
      parseBrowserVaultSnapshot({
        entities: {},
        generatedAt: "2026-04-17T08:05:00.000Z",
        metadata: null,
        schema: BROWSER_VAULT_SNAPSHOT_SCHEMA,
        sourceVersion: "b".repeat(64),
      }),
    /Browser vault snapshot\.entities must be an array\./,
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
