import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as core from "@murphai/core";
import * as query from "@murphai/query";
import * as timing from "@murphai/runtime-state/node/cli-timing";
import { QUERY_DB_RELATIVE_PATH } from "@murphai/runtime-state/node";
import { createIntegratedVaultServices } from "@murphai/vault-usecases/vault-services";
import { test, vi } from "vitest";
import { ordinaryReaders, readOrdinary } from "../bench/global-projection.ts";
import { fingerprint, readSleepProof, reviseSleepFixture, seedSleepFixture, sleepDate, sleepNow, traceSleepRead } from "../bench/wearable-sleep-fixture.ts";

const services = createIntegratedVaultServices();
const days = 9;
async function reviseOrdinaryFixture(vault: string, deleted = false) {
  await reviseSleepFixture(core, vault, days, deleted);
  // Exercise a relevant edit for activity/body/recovery too, not only sleep.
  const shard = path.join(vault, "ledger/events/2026/2026-01.jsonl");
  await core.withCanonicalWriteLock(vault, async () => {
    const records: Record<string, unknown>[] = (await readFile(shard, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    const revisions = ["steps", "weightKg", "hrv"].map(metric => {
      const original = records.find(row => row.id === `evt_synthetic_oura_${days - 1}_${metric}`);
      assert.ok(original && typeof original.value === "number");
      return { ...original, value: original.value + 10, recordedAt: sleepNow,
        lifecycle: { revision: deleted ? 3 : 2, ...(deleted ? { state: "deleted" } : {}) } };
    });
    await appendFile(shard, revisions.map(row => JSON.stringify(row)).join("\n") + "\n");
  });
}
async function discardProjection(vault: string) {
  await core.withCanonicalWriteLock(vault, () => Promise.all(["", "-wal", "-shm"].map(suffix =>
    rm(path.join(vault, QUERY_DB_RELATIVE_PATH) + suffix, { force: true }))));
}
for (const reader of ordinaryReaders) {
  test(`${reader} public service preserves full envelopes in every projection state`, async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "murph-ordinary-wearables-"));
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(sleepNow));
    try {
      for (const state of ["cold", "wearable-only", "fresh-global", "stale", "wearable-current-global-stale"] as const) {
        await rm(vault, { recursive: true, force: true });
        await seedSleepFixture(core, vault, days);
        if (state === "wearable-only") await readSleepProof(services, vault, days);
        if (state !== "cold" && state !== "wearable-only") await query.rebuildQueryProjection(vault);
        if (state === "stale" || state === "wearable-current-global-stale") await reviseOrdinaryFixture(vault);
        if (state === "wearable-current-global-stale") await readSleepProof(services, vault, days, 410);
        const shard = path.join(vault, "ledger/events/2026/2026-01.jsonl");
        const canonical = await readFile(shard);
        const filters = [
          {}, { providers: [] }, { providers: [" OURa ", "oura", "garmin"] }, { providers: ["garmin", "oura"] },
          { providers: ["", "  "] }, { providers: ["missing"] }, { providers: ["oura"] },
          { date: sleepDate(2) }, { from: sleepDate(3), to: sleepDate(5), limit: 1 }, { limit: 0 }, { limit: 2 },
        ];
        const actual = [];
        for (const [index, selection] of filters.entries()) {
          const read = await traceSleepRead(timing, `wearables ${reader}`, () => readOrdinary(services, vault, reader, {
            ...(reader === "day" ? { date: sleepDate(days - 1) } : {}), ...selection,
          }));
          actual.push(fingerprint(read.value));
          assert.equal(read.phases["query-metric-projection"] ?? 0, 0);
          assert.equal(read.phases["query-search-documents"] ?? 0, 0);
          assert.equal(read.phases["query-wearable-summary"] ?? 0, Number(index === 0 && (state === "cold" || state === "stale")));
        }
        assert.equal((await query.getQueryProjectionStatus(vault)).fresh, state === "fresh-global");
        assert.deepEqual(await readFile(shard), canonical);
        // A new full rebuild, not reuse of candidate rows, is the reference.
        await discardProjection(vault);
        await query.rebuildQueryProjection(vault);
        for (const [index, selection] of filters.entries()) {
          assert.deepEqual(actual[index], fingerprint(await readOrdinary(services, vault, reader, {
            ...(reader === "day" ? { date: sleepDate(days - 1) } : {}), ...selection,
          })), `${reader}/${state}/${index}`);
        }
      }
      // Deletion must reach every public reader too, without stale fallback.
      await reviseOrdinaryFixture(vault, true);
      const deleted = fingerprint(await readOrdinary(services, vault, reader, { date: sleepDate(days - 1), providers: ["oura"] }));
      await discardProjection(vault);
      await query.rebuildQueryProjection(vault);
      assert.deepEqual(deleted, fingerprint(await readOrdinary(services, vault, reader, { date: sleepDate(days - 1), providers: ["oura"] })));
    } finally { vi.useRealTimers(); await rm(vault, { recursive: true, force: true }); }
  });
}

test("all ordinary public services preserve empty results and strict malformed-source errors", async () => {
  const vault = await mkdtemp(path.join(tmpdir(), "murph-empty-wearables-"));
  try {
    await core.initializeVault({ vaultRoot: vault, timezone: "UTC" });
    const empty = await Promise.all(ordinaryReaders.map(reader => readOrdinary(services, vault, reader)));
    await discardProjection(vault);
    await query.rebuildQueryProjection(vault);
    assert.deepEqual(empty, await Promise.all(ordinaryReaders.map(reader => readOrdinary(services, vault, reader))));
    // Seed a valid prior generation, then make its canonical source invalid.
    await rm(vault, { recursive: true, force: true });
    await seedSleepFixture(core, vault, days);
    await query.rebuildQueryProjection(vault);
    const before = await readFile(path.join(vault, QUERY_DB_RELATIVE_PATH));
    await core.withCanonicalWriteLock(vault, () => appendFile(path.join(vault, "ledger/events/2026/2026-01.jsonl"), "{malformed synthetic input\n"));
    for (const reader of ordinaryReaders) for (const providers of [undefined, [], ["", "  "], ["missing"]]) {
      await assert.rejects(readOrdinary(services, vault, reader, { providers }), { code: "VAULT_INVALID_JSONL" });
    }
    assert.deepEqual(await readFile(path.join(vault, QUERY_DB_RELATIVE_PATH)), before);
  } finally { await rm(vault, { recursive: true, force: true }); }
});
