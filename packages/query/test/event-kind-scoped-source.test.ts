import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "vitest";
import * as core from "@murphai/core";
import { readCanonicalEntityFamilySource } from "../src/vault-source.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const row = (id: string, kind: string, extra: Record<string, unknown> = {}) => ({
  schemaVersion: "murph.event.v1", id, kind, source: "manual", title: `Synthetic ${kind}`,
  occurredAt: "2026-03-04T08:00:00Z", recordedAt: "2026-03-04T09:00:00Z",
  lifecycle: { revision: 1 }, ...extra,
});

async function fixture(shards: Record<string, readonly Record<string, unknown>[]>) {
  const root = await mkdtemp(path.join(tmpdir(), "murph-event-kind-scoped-"));
  roots.push(root);
  await core.initializeVault({ vaultRoot: root, timezone: "UTC", createdAt: "2026-03-01T00:00:00Z" });
  await core.withCanonicalWriteLock(root, async () => {
    for (const [shard, rows] of Object.entries(shards)) {
      await mkdir(path.dirname(path.join(root, shard)), { recursive: true });
      await writeFile(path.join(root, shard), rows.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    }
  });
  return root;
}

const KIND_SELECTIONS = [["meal"], ["note"], ["test"], ["meal", "test"], ["observation"], ["absent"], []];

test("a kind-scoped event read equals the full event read filtered by kind", async () => {
  const root = await fixture({
    "ledger/events/2026/2026-02.jsonl": [
      row("evt_early_meal", "meal", { occurredAt: "2026-02-10T08:00:00Z" }),
      row("evt_cross_shard", "meal", { occurredAt: "2026-02-11T08:00:00Z" }),
      // Legacy keys the reader strips, and a display identity taken from the payload.
      row("evt_legacy", "meal", { occurredAt: "2026-02-12T08:00:00Z", meal_id: "meal_legacy", mealId: "meal_display", related_ids: ["x"], tags: ["b", "a", "b"] }),
    ],
    "ledger/events/2026/2026-03.jsonl": [
      row("evt_meal", "meal"),
      row("evt_note", "note"),
      row("evt_test", "test", { testCategory: "blood" }),
      row("evt_observation", "observation"),
      // Revised within its kind; the later revision wins.
      row("evt_revised", "meal", { title: "First" }),
      row("evt_revised", "meal", { title: "Second", lifecycle: { revision: 2 } }),
      // Deleted: must stay hidden from its own kind.
      row("evt_deleted", "meal"),
      row("evt_deleted", "meal", { lifecycle: { revision: 2, state: "deleted" } }),
      // Latest revision carries another kind: the stale meal must not come back.
      row("evt_rekinded", "meal", { title: "Was a meal" }),
      row("evt_rekinded", "note", { title: "Now a note", lifecycle: { revision: 2 } }),
      // Deleted, then the id reused by another kind.
      row("evt_reused", "note"),
      row("evt_reused", "note", { lifecycle: { revision: 2, state: "deleted" } }),
      row("evt_reused", "meal", { lifecycle: { revision: 3 } }),
      // Equal-priority duplicates: the same one must win in both reads.
      row("evt_duplicate", "meal", { title: "Duplicate A" }),
      row("evt_duplicate", "meal", { title: "Duplicate B" }),
      // Newer revision of an event whose first row sits in the earlier shard.
      row("evt_cross_shard", "note", { occurredAt: "2026-02-11T08:00:00Z", lifecycle: { revision: 2 } }),
      // Invalid lifecycle rows are ignored by both reads.
      row("evt_bad_lifecycle", "meal", { lifecycle: { revision: 0 } }),
    ],
  });

  const full = await readCanonicalEntityFamilySource(root, "event");
  assert.ok(full.length > 0);
  for (const eventKinds of KIND_SELECTIONS) {
    const scoped = await readCanonicalEntityFamilySource(root, "event", { eventKinds });
    assert.deepEqual(scoped, full.filter((entity) => entity.kind !== null && eventKinds.includes(entity.kind)), eventKinds.join(","));
  }

  const meals = await readCanonicalEntityFamilySource(root, "event", { eventKinds: ["meal"] });
  const titles = meals.map((entity) => entity.title);
  assert.ok(titles.includes("Second") && !titles.includes("First"));
  assert.ok(!titles.includes("Was a meal"));
  assert.ok(!meals.some((entity) => entity.primaryLookupId === "evt_deleted"));
  assert.ok(meals.some((entity) => entity.primaryLookupId === "evt_reused"));
});

test("a kind-scoped event read still rejects a malformed row of another kind", async () => {
  const root = await fixture({
    "ledger/events/2026/2026-03.jsonl": [
      row("evt_meal", "meal"),
      { ...row("evt_broken", "note"), occurredAt: "" },
    ],
  });

  const fullError = await readCanonicalEntityFamilySource(root, "event").then(() => null, (error: unknown) => error);
  const scopedError = await readCanonicalEntityFamilySource(root, "event", { eventKinds: ["meal"] }).then(() => null, (error: unknown) => error);
  assert.ok(fullError instanceof Error);
  assert.ok(scopedError instanceof Error);
  assert.equal(scopedError.message, fullError.message);
  assert.equal(scopedError.constructor, fullError.constructor);
});
