import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { addMeal, initializeVault } from "@murphai/core";
import { test } from "vitest";

import { listStoredCanonicalEntities } from "../src/projection/entity-store.ts";
import { currentQueryProjectionLocation, openQueryProjectionDatabase } from "../src/projection/schema.ts";
import { searchQueryProjection } from "../src/projection/search-store.ts";
import { rebuildQueryProjection } from "../src/query-projection.ts";

const unusedIndexes = [
  ["query_entities", "date"], ["query_entities", "occurred_at"],
  ["query_search_document", "date"], ["query_search_document", "occurred_at"],
] as const;

test("date-filtered entity and FTS reads retain results without standalone date indexes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "murph-query-date-index-"));
  const location = currentQueryProjectionLocation(root);
  try {
    await initializeVault({ vaultRoot: root });
    for (const day of ["01", "02", "03", "04"]) {
      await addMeal({ vaultRoot: root, occurredAt: `2026-09-${day}T12:00:00Z`, note: `Synthetic noodles ${day}` });
    }
    await rebuildQueryProjection(root);
    const database = openQueryProjectionDatabase(location);
    try {
      for (const [table, column] of unusedIndexes) {
        database.exec(`CREATE INDEX ${table}_${column}_idx ON ${table}(${column})`);
      }
      // Include occurred_at fallback independently of canonical day materialization.
      database.exec("UPDATE query_entities SET date = NULL WHERE date = '2026-09-02'");
      database.exec("UPDATE query_search_document SET date = NULL WHERE date = '2026-09-02'");
    } finally {
      database.close();
    }
    const ranges = [{}, { from: "2026-09-02" }, { to: "2026-09-03" },
      { from: "2026-09-02", to: "2026-09-03" }];
    const read = () => ranges.map(range => ({
      entities: listStoredCanonicalEntities(location, { ...range, kinds: ["meal"], limit: null }),
      search: searchQueryProjection(location, "noodles", { ...range, kinds: ["meal"] }),
    }));
    const withIndexes = read();
    assert.deepEqual(withIndexes.map(result => result.entities.length), [4, 3, 3, 2]);
    assert.deepEqual(withIndexes.map(result => result.search.hits.length), [4, 3, 3, 2]);
    const candidate = openQueryProjectionDatabase(location);
    try {
      const plans = [
        "SELECT entity_json FROM query_entities WHERE COALESCE(date, substr(occurred_at, 1, 10)) >= '2026-09-02' ORDER BY COALESCE(date, substr(occurred_at, 1, 10)) DESC, occurred_at DESC, sort_rank ASC",
        "SELECT query_search_document.record_id FROM query_search_fts JOIN query_search_document ON query_search_document.rowid = query_search_fts.rowid WHERE query_search_fts MATCH 'noodles' AND substr(COALESCE(query_search_document.date, query_search_document.occurred_at), 1, 10) >= '2026-09-02' ORDER BY bm25(query_search_fts), query_search_document.record_id",
      ];
      for (const sql of plans) {
        const details = candidate.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map(row => String(row.detail)).join("\n");
        for (const [table, column] of unusedIndexes) assert.ok(!details.includes(`${table}_${column}_idx`));
      }
      for (const [table, column] of unusedIndexes) candidate.exec(`DROP INDEX ${table}_${column}_idx`);
    } finally {
      candidate.close();
    }
    assert.deepEqual(read(), withIndexes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
