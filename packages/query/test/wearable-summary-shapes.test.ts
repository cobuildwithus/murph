import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { withImmediateTransaction } from "@murphai/runtime-state/node";
import { test, vi } from "vitest";
import { addMeal, initializeVault } from "@murphai/core";
import { rebuildQueryProjection } from "../src/query-projection.ts";
import { currentQueryProjectionLocation, openQueryProjectionDatabase } from "../src/projection/schema.ts";
import { insertWearableSummaryRows, readWearableSummaryRows, type QueryWearableSummaryRow } from "../src/projection/wearable-summary-store.ts";
import { decodeWearableSummaryJson, readWearableSummaryShapes } from "../src/projection/wearable-summary-shapes.ts";
import * as shapeStore from "../src/projection/wearable-summary-shapes.ts";
import * as searchStore from "../src/projection/search-store.ts";

function summary(index: number): QueryWearableSummaryRow {
  return {
    id: `synthetic:${index}`, providerScopeJson: '["oura"]', providerScopeKey: "providers:oura",
    sortRank: index, summaryDate: "2026-09-01", summaryKind: "activity",
    summaryJson: JSON.stringify({
      date: "2026-09-01", steps: { selection: { value: index }, confidence: null },
      activityEvidence: { candidates: [{ durationMinutes: index, notes: [null, true, false, "Ω", [0, 1]] }] },
      oddKeys: JSON.parse('{"__proto__":{"polluted":true},"constructor":[],"":{},"1":"one"}'),
    }),
  };
}

test("shared field dictionaries preserve exact summary JSON, filtered reads and copied-cache restore", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "murph-query-shapes-"));
  const location = currentQueryProjectionLocation(root);
  const rows = Array.from({ length: 1000 }, (_, index) => summary(index));
  try {
    const database = openQueryProjectionDatabase(location);
    try {
      withImmediateTransaction(database, () => insertWearableSummaryRows(database, rows));
      // Separate insertion calls share existing shapes without overwriting IDs.
      withImmediateTransaction(database, () => insertWearableSummaryRows(database, [summary(1000)]));
      rows.push(summary(1000));
      const shapes = readWearableSummaryShapes(database);
      assert.ok(shapes.size < 20);
      const packed = database.prepare("SELECT sum(length(summary_json)) AS bytes FROM query_wearable_summaries").get();
      assert.ok(Number(packed?.bytes) < rows.reduce((sum, row) => sum + row.summaryJson.length, 0) * 0.65);
      assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
      assert.throws(() => decodeWearableSummaryJson('[0,999999]', shapes), /Invalid wearable summary/u);
      assert.throws(() => decodeWearableSummaryJson('{}', shapes), /Invalid wearable summary/u);
    } finally {
      database.close();
    }
    assert.deepEqual(readWearableSummaryRows(location).rows, rows);
    assert.deepEqual(readWearableSummaryRows(location, { providers: ["oura"], from: "2026-09-01", to: "2026-09-01" }).rows, rows);
    assert.deepEqual(readWearableSummaryRows(location, { providers: ["garmin"] }).rows, []);
    assert.deepEqual(readWearableSummaryRows(location, { from: "2026-09-02" }).rows, []);
    const restored = currentQueryProjectionLocation(path.join(root, "restored"));
    await mkdir(path.dirname(restored.absolutePath), { recursive: true });
    await copyFile(location.absolutePath, restored.absolutePath);
    assert.deepEqual(readWearableSummaryRows(restored).rows, rows);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("full publication rolls back and retires summary dictionaries with their rows, then repacks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "murph-query-shapes-replace-"));
  const location = currentQueryProjectionLocation(root);
  try {
    await initializeVault({ vaultRoot: root });
    await rebuildQueryProjection(root);
    const database = openQueryProjectionDatabase(location);
    let beforeShapes;
    try {
      withImmediateTransaction(database, () => insertWearableSummaryRows(database,
        Array.from({ length: 1000 }, (_, index) => summary(index))));
      beforeShapes = readWearableSummaryShapes(database);
    } finally {
      database.close();
    }
    const beforeRows = readWearableSummaryRows(location).rows;
    const beforeBytes = (await readFile(location.absolutePath)).length;
    await addMeal({ vaultRoot: root, occurredAt: "2026-09-01T12:00:00Z", note: "Synthetic replacement" });
    const fail = vi.spyOn(searchStore, "insertSearchDocuments").mockImplementationOnce(() => {
      throw new Error("synthetic failure after wearable replacement");
    });
    try {
      await assert.rejects(rebuildQueryProjection(root), /synthetic failure/u);
    } finally {
      fail.mockRestore();
    }
    assert.deepEqual(readWearableSummaryRows(location).rows, beforeRows);
    const failed = openQueryProjectionDatabase(location, { readOnly: true });
    try {
      assert.deepEqual(readWearableSummaryShapes(failed), beforeShapes);
    } finally {
      failed.close();
    }
    await rebuildQueryProjection(root);
    assert.deepEqual(readWearableSummaryRows(location).rows, []);
    const after = openQueryProjectionDatabase(location, { readOnly: true });
    try {
      assert.equal(readWearableSummaryShapes(after).size, 0);
      assert.equal(after.prepare("PRAGMA freelist_count").get()?.freelist_count, 0);
      assert.equal(after.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
    } finally {
      after.close();
    }
    assert.ok((await readFile(location.absolutePath)).length < beforeBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repacking preserves sparse search rowids and external-content FTS results", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "murph-query-repack-search-"));
  const location = currentQueryProjectionLocation(root);
  try {
    await initializeVault({ vaultRoot: root });
    await addMeal({ vaultRoot: root, occurredAt: "2026-09-01T12:00:00Z", note: "Synthetic spinach meal" });
    await addMeal({ vaultRoot: root, occurredAt: "2026-09-02T12:00:00Z", note: "Synthetic lentil meal" });
    await rebuildQueryProjection(root);
    const database = openQueryProjectionDatabase(location);
    try {
      database.exec(`
        UPDATE query_search_document SET rowid = rowid + 100;
        INSERT INTO query_search_fts(query_search_fts) VALUES ('rebuild');
      `);
      const beforeIds = database.prepare("SELECT rowid, record_id FROM query_search_document ORDER BY rowid").all();
      const before = searchStore.searchQueryProjection(location, "spinach", {});
      assert.equal(before.hits.length, 1);
      database.exec("VACUUM");
      assert.deepEqual(database.prepare("SELECT rowid, record_id FROM query_search_document ORDER BY rowid").all(), beforeIds);
      database.exec("INSERT INTO query_search_fts(query_search_fts, rank) VALUES ('integrity-check', 1)");
      assert.deepEqual(searchStore.searchQueryProjection(location, "spinach", {}), before);
    } finally {
      database.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a concurrent publication cannot mix dictionary and row generations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "murph-query-shapes-snapshot-"));
  const location = currentQueryProjectionLocation(root);
  const writer = openQueryProjectionDatabase(location);
  const first = summary(0);
  const second = { ...summary(1), summaryJson: '{"differentShape":[1,2,3]}' };
  try {
    withImmediateTransaction(writer, () => insertWearableSummaryRows(writer, [first]));
    const original = shapeStore.readWearableSummaryShapes;
    const interleave = vi.spyOn(shapeStore, "readWearableSummaryShapes").mockImplementationOnce((reader) => {
      const shapes = original(reader);
      withImmediateTransaction(writer, () => {
        writer.exec("DELETE FROM query_wearable_summaries; DELETE FROM query_wearable_summary_shapes;");
        insertWearableSummaryRows(writer, [second]);
      });
      return shapes;
    });
    try {
      assert.deepEqual(readWearableSummaryRows(location).rows, [first]);
      assert.deepEqual(readWearableSummaryRows(location).rows, [second]);
    } finally {
      interleave.mockRestore();
    }
  } finally {
    writer.close();
    await rm(root, { recursive: true, force: true });
  }
});
