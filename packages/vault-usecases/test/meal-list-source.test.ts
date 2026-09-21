import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { addMeal, initializeVault } from "@murphai/core";
import { listCanonicalEntities } from "@murphai/query";
import { toOwnedEventCommandShowEntity } from "../src/commands/query-record-command-helpers.js";
import { toListEntity } from "../src/usecases/shared.js";
import { deleteMealRecord, editMealRecord, listMealRecords } from "../src/usecases/document-meal-read.js";

test("meal listing preserves canonical ordering and date/limit semantics without a query projection", async () => {
  const vault = await mkdtemp(path.join(tmpdir(), "meal-list-source-"));
  try {
    await initializeVault({ vaultRoot: vault, timezone: "America/Los_Angeles" });
    for (const occurredAt of ["2026-04-10T22:00:00Z", "2026-04-11T02:00:00Z", "2026-04-12T18:00:00Z"]) {
      await addMeal({ vaultRoot: vault, occurredAt, note: "Synthetic meal" });
    }
    const filters = { vault, from: "2026-04-10", to: "2026-04-10", limit: 1 };
    const actual = await listMealRecords(filters);
    assert.equal(actual.count, 1);
    await assert.rejects(stat(path.join(vault, ".runtime/projections/query.sqlite")), { code: "ENOENT" });
    const baseline = await listCanonicalEntities(vault, {
      family: "event", kinds: ["meal"], from: filters.from, to: filters.to, limit: null,
    });
    assert.deepEqual(actual.items, baseline.slice(0, 1).map((item) => toListEntity(toOwnedEventCommandShowEntity(item, []))));
  } finally { await rm(vault, { recursive: true, force: true }); }
});

test("meal listing ignores broken unrelated canonical families and keeps event-source errors visible", async () => {
  const vault = await mkdtemp(path.join(tmpdir(), "meal-list-independent-"));
  try {
    await initializeVault({ vaultRoot: vault });
    const meal = await addMeal({ vaultRoot: vault, occurredAt: "2026-04-10T12:00:00Z", note: "Synthetic meal" });
    await mkdir(path.join(vault, "bank/goals"), { recursive: true });
    await writeFile(path.join(vault, "bank/goals/broken.md"), "---\ninvalid: [\n---\n");
    assert.deepEqual((await listMealRecords({ vault })).items.map((item) => item.id), [meal.mealId]);
    await mkdir(path.join(vault, "ledger/events/2026"), { recursive: true });
    await writeFile(path.join(vault, "ledger/events/2026/2026-05.jsonl"), "{invalid\n");
    await assert.rejects(listMealRecords({ vault }));
  } finally { await rm(vault, { recursive: true, force: true }); }
});


test("meal listing applies date corrections and tombstones before filtering", async () => {
  const vault = await mkdtemp(path.join(tmpdir(), "meal-list-revisions-"));
  try {
    await initializeVault({ vaultRoot: vault, timezone: "UTC" });
    const moved = await addMeal({ vaultRoot: vault, occurredAt: "2026-04-10T12:00:00Z", note: "Synthetic moved meal" });
    const removed = await addMeal({ vaultRoot: vault, occurredAt: "2026-04-10T18:00:00Z", note: "Synthetic removed meal" });
    await editMealRecord({ vault, lookup: moved.mealId, set: ["occurredAt=2026-04-11T12:00:00Z"], dayKeyPolicy: "recompute" });
    await deleteMealRecord({ vault, lookup: removed.mealId });
    assert.equal((await listMealRecords({ vault, from: "2026-04-10", to: "2026-04-10" })).count, 0);
    assert.deepEqual((await listMealRecords({ vault, from: "2026-04-11", to: "2026-04-11" })).items.map((item) => item.id), [moved.mealId]);
  } finally { await rm(vault, { recursive: true, force: true }); }
});
