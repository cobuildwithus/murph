import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test } from "vitest";

import { wearableProviderRowKey } from "../src/projection/provider-scope.ts";
import {
  currentQueryProjectionLocation,
  expectString,
  publishQueryProjectionSection,
  openQueryProjectionSection,
} from "../src/projection/schema.ts";
import {
  insertWearableSummaryRows,
  readWearableSummaryRows,
  type QueryWearableSummaryKind,
} from "../src/projection/wearable-summary-store.ts";

test("bounded sleep reads decode only sleep rows in range while retaining source health", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-wearable-summary-store-"));
  const location = currentQueryProjectionLocation(vaultRoot);

  try {
    publishQueryProjectionSection(location, "wearables", "[]", database => {
      const provider = "oura";
      const providerScopeKey = wearableProviderRowKey(provider);
      const row = (
        id: string,
        summaryKind: QueryWearableSummaryKind,
        summaryDate: string | null,
      ) => ({
        id,
        providerScopeJson: JSON.stringify([provider]),
        providerScopeKey,
        sortRank: 0,
        summaryDate,
        summaryJson: "{}",
        summaryKind,
      });

      insertWearableSummaryRows(database, [
        row("activity-in-range", "activity", "2026-07-02"),
        row("sleep-before-range", "sleep", "2026-06-01"),
        row("sleep-in-range", "sleep", "2026-07-02"),
        row("sleep-after-range", "sleep", "2026-08-01"),
        row("source-health-stale", "source_health", "2026-05-01"),
      ]);
    });

    const result = readWearableSummaryRows(location, {
      from: "2026-07-01",
      summaryKinds: ["sleep", "source_health"],
      to: "2026-07-03",
    });

    assert.deepEqual(result.rows.map((row) => row.id).sort(), [
      "sleep-in-range",
      "source-health-stale",
    ]);

    const readOnlyDatabase = openQueryProjectionSection(location, "wearables");
    try {
      const indexNames = readOnlyDatabase
        .prepare("PRAGMA index_list(query_wearable_summaries)")
        .all()
        .map((row) => expectString(row.name, "query_wearable_summaries index name"));
      assert.ok(indexNames.includes("query_wearable_summaries_kind_date_idx"));
    } finally {
      readOnlyDatabase.close();
    }
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});
