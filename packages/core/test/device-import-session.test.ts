import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { test, vi } from "vitest";
import { eventRecordSchema, safeParseContract } from "@murphai/contracts";
import * as contracts from "@murphai/contracts";

import * as eventLedger from "../src/event-ledger-storage.ts";
import * as publication from "../src/operations/write-batch.ts";

import {
  importDeviceBatch,
  deterministicContractId,
  initializeVault,
  readEvent,
  readIntegrationIngestById,
  type DeviceBatchImportTiming,
} from "../src/index.ts";

function buildObservation(resourceId: string, occurredAt: string, value: number) {
  return {
    kind: "observation" as const,
    occurredAt,
    recordedAt: occurredAt,
    title: "Synthetic observation",
    externalRef: {
      system: "synthetic",
      resourceType: "metric",
      resourceId,
      version: occurredAt,
    },
    fields: {
      metric: "synthetic-metric",
      unit: "count",
      value,
    },
  };
}

async function withTempVault(
  operation: (vaultRoot: string) => Promise<void>,
): Promise<void> {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "murph-device-import-session-"));
  try {
    await initializeVault({ vaultRoot, createdAt: "2026-01-01T00:00:00.000Z" });
    await operation(vaultRoot);
  } finally {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
}

test("a writing import defers identity reduction of its committed rows until reuse", async () => {
  await withTempVault(async (vaultRoot) => {
    let committed = false;
    let reducedAfterCommit = 0;
    const realWrite = publication.runCanonicalWrite;
    const writeSpy = vi.spyOn(publication, "runCanonicalWrite").mockImplementation(async (request) => {
      const result = await realWrite(request);
      committed = true;
      return result;
    });
    const realParse = contracts.safeParseContract;
    const parseSpy = vi.spyOn(contracts, "safeParseContract").mockImplementation((schema, value) => {
      if (committed && schema === eventRecordSchema) reducedAfterCommit += 1;
      return realParse(schema, value);
    });
    try {
      const result = await importDeviceBatch({
        vaultRoot, provider: "synthetic", importedAt: "2026-02-01T00:00:00.000Z",
        events: [
          buildObservation("first", "2026-01-01T00:00:00.000Z", 1),
          buildObservation("second", "2026-02-01T00:00:00.000Z", 2),
        ],
      });
      assert.equal(result.applied, true);
      assert.equal(result.events.length, 2);
      assert.equal(reducedAfterCommit, 0, "unused appended rows must not be reduced after publication");
    } finally {
      writeSpy.mockRestore();
      parseSpy.mockRestore();
    }
  });
});

test("deferred committed rows give the next warm import the same owners as a fresh build", async () => {
  await withTempVault(async (vaultRoot) => withTempVault(async (coldRoot) => {
    const seed = await importDeviceBatch({
      vaultRoot, provider: "synthetic", importedAt: "2026-02-01T00:00:00.000Z",
      events: [
        buildObservation("first", "2026-01-01T00:00:00.000Z", 1),
        buildObservation("second", "2026-02-01T00:00:00.000Z", 2),
      ],
    });
    await fs.cp(vaultRoot, coldRoot, { recursive: true });
    const correction = {
      provider: "synthetic", importedAt: "2026-03-01T00:00:00.000Z",
      events: [
        buildObservation("first", "2026-03-01T00:00:00.000Z", 3),
        buildObservation("second", "2026-03-01T00:00:00.000Z", 4),
      ],
    };
    const hits: boolean[] = [];
    const options = { onTiming: (timing: DeviceBatchImportTiming) => hits.push(timing.eventIdentityIndexCacheHit) };
    const warm = await importDeviceBatch({ ...correction, vaultRoot }, options);
    const cold = await importDeviceBatch({ ...correction, vaultRoot: coldRoot }, options);
    assert.deepEqual(hits, [true, false]);
    assert.equal(warm.applied, true);
    assert.equal(cold.applied, true);
    assert.deepEqual(warm.events, cold.events);
    assert.deepEqual(warm.events.map((event) => event.id), seed.events.map((event) => event.id));
    assert.ok(warm.events.every((event) => event.lifecycle?.revision === 2));
  }));
});

test("separate drains reuse identity rows without visiting unrelated history", async () => {
  await withTempVault(async (vaultRoot) => {
    const seed = await importDeviceBatch({
      vaultRoot, provider: "synthetic", importedAt: "2026-01-01T00:00:00.000Z",
      events: [buildObservation("history", "2020-01-01T00:00:00.000Z", 1)],
    });
    const shardPath = seed.eventShardPaths[0]!;
    const row = seed.events[0]!;
    await fs.writeFile(path.join(vaultRoot, shardPath), Array.from({ length: 1_000 }, (_, i) =>
      JSON.stringify({ ...row, id: deterministicContractId("evt", `history-${i}`), externalRef: { ...row.externalRef, resourceId: `history-${i}` } }),
    ).join("\n") + "\n");
    let visited = 0;
    const realVisit = eventLedger.visitEventLedgerShardRecordsInterruptible;
    const spy = vi.spyOn(eventLedger, "visitEventLedgerShardRecordsInterruptible")
      .mockImplementation((input) => realVisit({ ...input, visit(record, line) {
        if (input.relativePath === shardPath) visited += 1;
        return input.visit(record, line);
      } }));
    try {
      for (const day of [2, 3]) {
        const at = `2026-01-0${day}T00:00:00.000Z`;
        await importDeviceBatch({ vaultRoot, provider: "synthetic", importedAt: at,
          events: [buildObservation(`drain-${day}`, at, day)],
        });
        if (day === 2) {
          assert.equal(visited, 1_000);
          visited = 0;
        } else {
          assert.equal(visited, 0, "the second drain must not scan unrelated identity rows");
        }
      }
    } finally {
      spy.mockRestore();
    }
  });
});

test.skipIf(process.env.MURPH_IDENTITY_BENCH !== "1")("measures two drains over 70k identity rows", async () => {
  await withTempVault(async (vaultRoot) => {
    const seed = await importDeviceBatch({ vaultRoot, provider: "synthetic",
      importedAt: "2026-01-01T00:00:00.000Z",
      events: [buildObservation("seed", "2020-01-01T00:00:00.000Z", 1)],
    });
    const row = seed.events[0]!;
    for (let month = 0; month < 55; month++) {
      const at = new Date(Date.UTC(2020, month, 1)).toISOString();
      const shardPath = path.join(path.dirname(seed.eventShardPaths[0]!), `${at.slice(0, 7)}.jsonl`);
      await fs.mkdir(path.dirname(path.join(vaultRoot, shardPath)), { recursive: true });
      const rows = Array.from({ length: month === 54 ? 1_312 : 1_272 }, (_, i) => ({
        ...row, id: deterministicContractId("evt", `bench-${month}-${i}`), occurredAt: at, dayKey: at.slice(0, 10),
        externalRef: { ...row.externalRef, resourceId: `bench-${month}-${i}` },
      }));
      assert.ok(safeParseContract(eventRecordSchema, rows[0]).success);
      await fs.writeFile(path.join(vaultRoot, shardPath), rows.map((record) => JSON.stringify(record)).join("\n") + "\n");
    }
    const timings: DeviceBatchImportTiming[] = [];
    for (const day of [2, 3]) {
      const at = `2026-01-0${day}T00:00:00.000Z`;
      await importDeviceBatch({ vaultRoot, provider: "synthetic", importedAt: at,
        events: [buildObservation(`drain-${day}`, at, day)],
      }, { onTiming: (timing) => timings.push(timing) });
    }
    process.stdout.write(JSON.stringify({ rows: 70_000, shards: 55, identityMs: timings.map((t) => t.eventIdentityIndexElapsedMs), hits: timings.map((t) => t.eventIdentityIndexCacheHit) }) + "\n");
  });
});

test("reuses a large event identity index across overlapping imports", async () => {
  await withTempVault(async (vaultRoot) => {
    const start = Date.parse("2020-01-01T00:00:00.000Z");
    await importDeviceBatch({
      vaultRoot,
      provider: "synthetic",
      accountId: "synthetic-account",
      importedAt: "2026-01-01T00:00:00.000Z",
      events: Array.from({ length: 1_000 }, (_, index) => {
        const occurredAt = new Date(start + index * 60_000).toISOString();
        return buildObservation(`seed-${index}`, occurredAt, index);
      }),
    });

    const timings: DeviceBatchImportTiming[] = [];
    const firstAt = "2026-01-02T00:00:00.000Z";
    const first = await importDeviceBatch({
      vaultRoot,
      provider: "synthetic",
      accountId: "synthetic-account",
      importedAt: firstAt,
      events: [buildObservation("incremental-a", firstAt, 1)],
    }, {
      onTiming: (timing) => timings.push(timing),
    });
    const secondAt = "2026-01-03T00:00:00.000Z";
    const second = await importDeviceBatch({
      vaultRoot,
      provider: "synthetic",
      accountId: "synthetic-account",
      importedAt: secondAt,
      events: [buildObservation("incremental-b", secondAt, 2)],
    }, {
      onTiming: (timing) => timings.push(timing),
    });

    assert.equal(timings[0]?.eventIdentityIndexCacheHit, true);
    assert.equal(timings[1]?.eventIdentityIndexCacheHit, true);
    assert.equal(first.events.length, 1);
    assert.equal(second.events.length, 1);

    const correctionAt = "2026-01-04T00:00:00.000Z";
    const correction = await importDeviceBatch({
      vaultRoot,
      provider: "synthetic",
      accountId: "synthetic-account",
      importedAt: correctionAt,
      events: [buildObservation("incremental-a", correctionAt, 3)],
    }, {
      onTiming: (timing) => timings.push(timing),
    });

    assert.equal(timings[2]?.eventIdentityIndexCacheHit, true);
    assert.equal(correction.events[0]?.id, first.events[0]?.id);
    assert.equal(correction.events[0]?.lifecycle?.revision, 2);

    const externalAt = "2026-01-05T00:00:00.000Z";
    await importDeviceBatch({
      vaultRoot,
      provider: "synthetic",
      accountId: "synthetic-account",
      importedAt: externalAt,
      events: [buildObservation("outside-session", externalAt, 4)],
    });
    const afterExternalAt = "2026-01-06T00:00:00.000Z";
    await importDeviceBatch({
      vaultRoot,
      provider: "synthetic",
      accountId: "synthetic-account",
      importedAt: afterExternalAt,
      events: [buildObservation("after-outside-session", afterExternalAt, 5)],
    }, {
      onTiming: (timing) => timings.push(timing),
    });
    assert.equal(timings[3]?.eventIdentityIndexCacheHit, true);
  });
}, 30_000);

test("does not seed an empty event identity cache from a sample-only import", async () => {
  await withTempVault(async (vaultRoot) => {
    const persistedAt = "2026-01-02T00:00:00.000Z";
    const persisted = await importDeviceBatch({
      vaultRoot,
      provider: "synthetic",
      importedAt: persistedAt,
      events: [buildObservation("existing", persistedAt, 1)],
    });
    await fs.utimes(path.join(vaultRoot, persisted.eventShardPaths[0]!), new Date(0), new Date(0));
    await importDeviceBatch({
      vaultRoot,
      provider: "synthetic",
      importedAt: "2026-01-03T00:00:00.000Z",
      samples: [{
        recordedAt: "2026-01-03T00:00:00.000Z",
        stream: "heart_rate",
        unit: "bpm",
        sample: {
          recordedAt: "2026-01-03T00:00:00.000Z",
          value: 60,
        },
      }],
    });

    let replayTiming: DeviceBatchImportTiming | undefined;
    const replay = await importDeviceBatch({
      vaultRoot,
      provider: "synthetic",
      importedAt: "2026-01-04T00:00:00.000Z",
      events: [buildObservation("existing", "2026-01-04T00:00:00.000Z", 2)],
    }, {
      onTiming: (timing) => {
        replayTiming = timing;
      },
    });

    assert.equal(replayTiming?.eventIdentityIndexCacheHit, false);
    assert.equal(replay.events[0]?.id, persisted.events[0]?.id);
    assert.equal(replay.events[0]?.lifecycle?.revision, 2);
  });
});

test("keeps the cached baseline isolated from reconciliation and discards it after rejection", async () => {
  await withTempVault(async (vaultRoot) => {
    const originalAt = "2026-01-01T00:00:00.000Z";
    const original = await importDeviceBatch({
      vaultRoot, provider: "synthetic", importedAt: originalAt,
      events: [buildObservation("existing", originalAt, 1)],
    });
    const timings: DeviceBatchImportTiming[] = [];
    const options = { onTiming: (timing: DeviceBatchImportTiming) => timings.push(timing) };
    const secondAt = "2026-01-02T00:00:00.000Z";
    await importDeviceBatch({
      vaultRoot, provider: "synthetic", importedAt: secondAt,
      events: [buildObservation("disjoint", secondAt, 2)],
    }, options);
    const correctionAt = "2026-01-03T00:00:00.000Z";
    const correction = await importDeviceBatch({
      vaultRoot, provider: "synthetic", importedAt: correctionAt,
      events: [buildObservation("existing", correctionAt, 3)],
    }, options);
    const fourthAt = "2026-01-04T00:00:00.000Z";
    const disjoint = await importDeviceBatch({
      vaultRoot, provider: "synthetic", importedAt: fourthAt,
      events: [buildObservation("another-disjoint", fourthAt, 4)],
    }, options);
    assert.deepEqual(timings.map((timing) => timing.eventIdentityIndexCacheHit), [true, true, true]);
    assert.equal(correction.events[0]?.id, original.events[0]?.id);
    assert.equal(correction.events[0]?.lifecycle?.revision, 2);
    assert.equal(disjoint.events[0]?.lifecycle?.revision ?? 1, 1);

    await assert.rejects(importDeviceBatch({
      vaultRoot, provider: "synthetic", importedAt: fourthAt,
      events: [{ ...buildObservation("invalid", fourthAt, 5), timeZone: "Invalid/Zone" }],
    }, options));
    const recovered = await importDeviceBatch({
      vaultRoot, provider: "synthetic", importedAt: correctionAt,
      events: [buildObservation("existing", correctionAt, 3)],
    }, options);
    assert.equal(timings.at(-1)?.eventIdentityIndexCacheHit, false);
    assert.equal(recovered.applied, false);
    assert.equal(recovered.events[0]?.id, correction.events[0]?.id);
    assert.equal(recovered.events[0]?.lifecycle?.revision, 2);
    const eventId = original.events[0]?.id;
    assert.ok(eventId);
    const persisted = await readEvent({ vaultRoot, eventId });
    assert.ok(persisted.event.kind === "observation");
    assert.equal(persisted.event.value, 3);
    assert.equal(persisted.event.lifecycle?.revision, 2);
  });
});

test("does not fail a committed import when the timing observer throws", async () => {
  await withTempVault(async (vaultRoot) => {
    const occurredAt = "2026-01-02T00:00:00.000Z";
    const result = await importDeviceBatch({
      vaultRoot,
      provider: "synthetic",
      importedAt: occurredAt,
      events: [buildObservation("timing-observer", occurredAt, 1)],
    }, {
      onTiming: () => {
        throw new Error("synthetic timing observer failure");
      },
    });

    assert.equal(result.applied, true);
    assert.equal(result.events.length, 1);
  });
});

test("preserves raw evidence identity across reordered frozen nested values", async () => {
  await withTempVault(async (vaultRoot) => {
    const importedAt = "2026-01-02T00:00:00.000Z";
    const nested = Object.freeze({ z: 2, a: 1, omitted: undefined });
    const literalPrototype = Object.freeze({ retained: true });
    const firstContent = Object.freeze(Object.fromEntries([
      ["timestamp", new Date(importedAt)],
      ["nested", nested],
      ["__proto__", literalPrototype],
      ["10", "ten"],
      ["2", "two"],
    ]));
    const replayContent = Object.freeze(Object.fromEntries([
      ["2", "two"],
      ["10", "ten"],
      ["__proto__", Object.freeze({ retained: true })],
      ["nested", Object.freeze({ a: 1, z: 2 })],
      ["timestamp", importedAt],
    ]));
    const makeInput = (content: Record<string, unknown>) => ({
      vaultRoot,
      provider: "synthetic",
      importedAt,
      events: [buildObservation("frozen-content", importedAt, 1)],
      evidenceParts: [{ role: "snapshot", fileName: "snapshot.json", content }],
    });
    const original = await importDeviceBatch(makeInput(firstContent));
    assert.ok(original.applied);
    const replay = await importDeviceBatch(makeInput(replayContent));
    assert.equal(replay.applied, false);
    assert.deepEqual(replay.events.map((event) => event.id), original.events.map((event) => event.id));
    const stored = await readIntegrationIngestById(vaultRoot, original.ingestId);
    assert.ok(stored);
    assert.deepEqual(JSON.parse(stored.record.parts[0]?.content ?? ""), replayContent);
    assert.equal(firstContent.nested, nested);
    assert.equal(firstContent.__proto__, literalPrototype);
    assert.ok(firstContent.timestamp instanceof Date);
    assert.deepEqual(Object.keys(nested), ["z", "a", "omitted"]);
  });
});
