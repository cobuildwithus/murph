import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, vi } from "vitest";

import { CONTRACT_SCHEMA_VERSION, eventRecordSchema, type MealEventRecord } from "@murphai/contracts";
import { normalizeCliTiming, type CliTiming } from "@murphai/runtime-state/cli-timing";
import { timeCliDispatch, withCliTiming } from "@murphai/runtime-state/node/cli-timing";
import { readEvent, readOwnedEvent } from "../src/event-read.ts";
import * as storage from "../src/event-ledger-storage.ts";
import { startEventOwnerOperation, withEventOwnerScanTiming } from "../src/event-owner-timing.ts";
import * as pathSafety from "../src/path-safety.ts";
import * as compression from "../src/shard-compression.ts";
import { deterministicContractId } from "../src/ids.ts";
import { compressShard } from "../src/shard-compression.ts";
import { initializeVault } from "../src/vault.ts";

const ownerId = deterministicContractId("meal", "synthetic-timing-owner");
const oldOwnerId = deterministicContractId("meal", "synthetic-timing-old-owner");
const eventId = deterministicContractId("evt", "synthetic-timing-event");
const privateText = "SYNTHETIC_PRIVATE_EVENT_TEXT";
const unrelated = { id: "synthetic-unrelated", kind: "unsupported", note: privateText };
const shard = (month: number) => `ledger/events/2026/2026-0${month}.jsonl`;
function meal(revision: number, month = 1, mealId = ownerId): MealEventRecord {
  const row: MealEventRecord = {
    schemaVersion: CONTRACT_SCHEMA_VERSION.event, id: eventId, kind: "meal", mealId,
    occurredAt: `2026-0${month}-10T12:00:00.000Z`, recordedAt: `2026-04-0${revision}T00:00:00.000Z`,
    dayKey: `2026-0${month}-10`, timeZone: "UTC", source: "manual", title: privateText,
    lifecycle: { revision },
  };
  assert.equal(eventRecordSchema.safeParse(row).success, true);
  return row;
}
async function withVault(run: (vaultRoot: string) => Promise<void>) {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "murph-owner-timing-"));
  try {
    await initializeVault({ vaultRoot, createdAt: "2026-04-01T00:00:00.000Z", timezone: "UTC" });
    await run(vaultRoot);
  } finally {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
}
async function writeShard(vaultRoot: string, month: number, rows: unknown[], encoding: "jsonl" | "gzip" | "brotli" = "jsonl") {
  const text = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  const suffix = encoding === "jsonl" ? "" : encoding === "gzip" ? ".gz" : ".br";
  const destination = path.join(vaultRoot, `${shard(month)}${suffix}`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, encoding === "jsonl" ? text : compressShard(text, encoding));
}
function timed(run: () => Promise<void>) {
  const reports: CliTiming[] = [];
  return {
    reports,
    done: withCliTiming(() => timeCliDispatch("meal show", run), (report) => { reports.push(report); }),
  };
}
function checkReport(reports: CliTiming[], vaultRoot: string, outcome: "ok" | "error", candidatesUs: number, revisionsUs?: number) {
  assert.equal(reports.length, 1);
  const report = reports[0]!;
  assert.deepEqual(normalizeCliTiming(report), report);
  assert.equal(report.droppedSpans, 0);
  assert.equal(report.commands.length, 1);
  const command = report.commands[0]!;
  assert.equal(command.command, "meal show");
  assert.equal(command.outcome, outcome);
  assert.equal(command.calls, 1);
  const phases = command.phases.filter((phase) =>
    phase.phase === "event-owner-candidates" || phase.phase === "event-owner-revisions");
  assert.deepEqual(phases.map((phase) => [phase.phase, phase.count, phase.sumUs, phase.maxUs]), [
    ["event-owner-candidates", 1, candidatesUs, candidatesUs],
    ...(revisionsUs === undefined ? [] : [["event-owner-revisions", 1, revisionsUs, revisionsUs]]),
  ]);
  assert.ok(phases.every((phase) => phase.cpu === undefined));
  const breakdown = command.phases.filter((phase) => /^event-owner-(?:candidates|revisions)-/u.test(phase.phase));
  assert.equal(breakdown.length, revisionsUs === undefined ? 6 : 12);
  assert.ok(breakdown.every((phase) => phase.count === 1 && phase.cpu === undefined));
  const serialized = JSON.stringify(report);
  for (const value of [vaultRoot, ownerId, oldOwnerId, eventId, privateText, "synthetic-unrelated", "ledger/events"]) {
    assert.equal(serialized.includes(value), false);
  }
}
// Real storage still runs; the clock isolates which existing work each span covers.
async function withStorageClock(run: () => Promise<void>, failure?: { at: "listing" | 1 | 2; error: Error }) {
  const originalClock = process.hrtime.bigint;
  const list = storage.listEventLedgerShardPaths;
  const read = storage.readEventLedgerShardRecords;
  let clock = 0n;
  let reads = 0;
  process.hrtime.bigint = () => clock;
  const listSpy = vi.spyOn(storage, "listEventLedgerShardPaths").mockImplementation(async (root) => {
    clock += 11_000n;
    if (failure?.at === "listing") throw failure.error;
    return list(root);
  });
  const readSpy = vi.spyOn(storage, "readEventLedgerShardRecords").mockImplementation(async (input) => {
    clock += 13_000n;
    reads += 1;
    if (failure?.at === reads) throw failure.error;
    return read(input);
  });
  try { await run(); }
  finally {
    listSpy.mockRestore();
    readSpy.mockRestore();
    process.hrtime.bigint = originalClock;
  }
}

test("owner spans cover all shards once per pass and preserve archived revisions, parity, and fresh reads", async () => {
  await withVault(async (vaultRoot) => {
    const current = meal(3, 2);
    await writeShard(vaultRoot, 1, [meal(2), unrelated], "gzip");
    await writeShard(vaultRoot, 2, [current], "brotli");
    await writeShard(vaultRoot, 3, [meal(1, 3, oldOwnerId)]);
    const read = () => readOwnedEvent({ vaultRoot, kind: "meal", ownerId });
    const expected = { eventId, ledgerFile: shard(2), event: current };
    assert.deepEqual(await read(), expected); // No active timing context.
    await withStorageClock(async () => {
      const measured = timed(async () => { assert.deepEqual(await read(), expected); });
      await measured.done;
      checkReport(measured.reports, vaultRoot, "ok", 50, 39);
    });
    const fresh = meal(4, 3);
    await fs.appendFile(path.join(vaultRoot, shard(3)), `${JSON.stringify(fresh)}\n`);
    const refreshed = { eventId, ledgerFile: shard(3), event: fresh };
    assert.deepEqual(await readEvent({ vaultRoot, eventId }), refreshed);
    await withStorageClock(async () => {
      const measured = timed(async () => { assert.deepEqual(await read(), refreshed); });
      await measured.done;
      checkReport(measured.reports, vaultRoot, "ok", 50, 39);
    });
  });
});

test("meal scan totals separate actual source, path, read, decode, parse and selection work", async () => {
  await withVault(async (vaultRoot) => {
    const current = meal(3, 2);
    await writeShard(vaultRoot, 1, [meal(2), unrelated], "gzip");
    await writeShard(vaultRoot, 2, [current], "brotli");
    await writeShard(vaultRoot, 3, [meal(1, 3, oldOwnerId)]);
    const clock = process.hrtime.bigint;
    let ticks = 0n;
    process.hrtime.bigint = () => ticks;
    const list = storage.listEventLedgerShardPaths;
    const access = fs.access.bind(fs);
    const within = pathSafety.assertPathWithinVaultOnDisk;
    const read = fs.readFile.bind(fs);
    const decode = compression.decompressShard;
    const parse = JSON.parse;
    const validate = eventRecordSchema.safeParse.bind(eventRecordSchema);
    const spies = [
      vi.spyOn(storage, "listEventLedgerShardPaths").mockImplementation(async (root) => {
        ticks += 11_000n; return list(root);
      }),
      vi.spyOn(fs, "access").mockImplementation(async (file, mode) => {
        ticks += 2_000n; return access(file, mode);
      }),
      vi.spyOn(pathSafety, "assertPathWithinVaultOnDisk").mockImplementation(async (root, file) => {
        ticks += 3_000n; return within(root, file);
      }),
      vi.spyOn(fs, "readFile").mockImplementation(async (file, options) => {
        ticks += 5_000n; return read(file, options);
      }),
      vi.spyOn(compression, "decompressShard").mockImplementation((bytes, kind, limit) => {
        ticks += 7_000n; return decode(bytes, kind, limit);
      }),
      vi.spyOn(JSON, "parse").mockImplementation((text, reviver) => {
        ticks += 11_000n; return parse(text, reviver);
      }),
      vi.spyOn(eventRecordSchema, "safeParse").mockImplementation((value, options) => {
        ticks += 13_000n; return validate(value, options);
      }),
    ];
    try {
      const measured = timed(async () => {
        assert.deepEqual(await readOwnedEvent({ vaultRoot, kind: "meal", ownerId }),
          { eventId, ledgerFile: shard(2), event: current });
      });
      await measured.done;
      // Listing includes its existing access/containment work; every physical
      // resolution checks three formats. Decode and parsing never include reads.
      checkReport(measured.reports, vaultRoot, "ok", 142, 139);
      const phases = measured.reports[0]!.commands[0]!.phases;
      for (const [pass, totals] of [
        ["candidates", [34, 9, 15, 14, 44, 26]],
        ["revisions", [18, 9, 15, 14, 44, 39]],
      ] as const) {
        assert.deepEqual(phases.filter((phase) => phase.phase.startsWith(`event-owner-${pass}-`))
          .map((phase) => [phase.phase, phase.count, phase.sumUs, phase.maxUs]),
        ["source", "path", "read", "decode", "parse", "select"].map((operation, index) =>
          [`event-owner-${pass}-${operation}`, 1, totals[index], totals[index]]));
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
      process.hrtime.bigint = clock;
    }
  });
});

test("more than 64 shard operations still emit only twelve meal breakdown samples", async () => {
  await withVault(async (vaultRoot) => {
    const current = meal(1);
    await writeShard(vaultRoot, 1, [current], "gzip");
    for (let index = 0; index < 80; index += 1) {
      const year = 2010 + Math.floor(index / 12);
      const month = String(index % 12 + 1).padStart(2, "0");
      const directory = path.join(vaultRoot, "ledger/events", String(year));
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, `${year}-${month}.jsonl`), `${JSON.stringify(unrelated)}\n`);
    }
    const measured = timed(async () => {
      assert.deepEqual(await readOwnedEvent({ vaultRoot, kind: "meal", ownerId }),
        { eventId, ledgerFile: shard(1), event: current });
    });
    await measured.done;
    const phases = measured.reports[0]!.commands[0]!.phases;
    checkReport(measured.reports, vaultRoot, "ok",
      phases.find((phase) => phase.phase === "event-owner-candidates")!.sumUs,
      phases.find((phase) => phase.phase === "event-owner-revisions")!.sumUs);
  });
});

test("scan breakdown adds no clocks when disabled and no document or event-ID read phases", async () => {
  await withVault(async (vaultRoot) => {
    await writeShard(vaultRoot, 1, [meal(1)]);
    const clock = vi.spyOn(process.hrtime, "bigint");
    try {
      await readOwnedEvent({ vaultRoot, kind: "meal", ownerId });
      assert.equal(clock.mock.calls.length, 0);
    } finally { clock.mockRestore(); }
    const measured = timed(async () => {
      await readEvent({ vaultRoot, eventId });
      await assert.rejects(readOwnedEvent({ vaultRoot, kind: "document", ownerId }), { code: "EVENT_MISSING" });
    });
    await measured.done;
    assert.equal(measured.reports[0]!.commands[0]!.phases.some((phase) =>
      /^event-owner-(?:candidates|revisions)-/u.test(phase.phase)), false);
  });
});

test("concurrent scan scopes stay separate and closed operation callbacks cannot add timing", async () => {
  const clock = process.hrtime.bigint;
  let ticks = 0n;
  process.hrtime.bigint = () => ticks;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let late!: () => void;
  const reports: CliTiming[] = [];
  try {
    const first = withCliTiming(() => withEventOwnerScanTiming("meal", "candidates", async () => {
      const end = startEventOwnerOperation("read");
      await gate;
      ticks += 5_000n;
      end();
      end();
    }), (report) => { reports.push(report); });
    await withCliTiming(() => withEventOwnerScanTiming("meal", "revisions", async () => {
      const end = startEventOwnerOperation("parse");
      ticks += 7_000n;
      end();
      late = startEventOwnerOperation("source");
    }), (report) => { reports.push(report); });
    release();
    await first;
    const samples = reports.map((report) => report.commands[0]!.phases.filter((phase) => phase.phase.startsWith("event-owner-")));
    assert.deepEqual(samples.map((phases) => phases.filter((phase) => phase.sumUs > 0).map((phase) => [phase.phase, phase.sumUs])),
      [[["event-owner-revisions-parse", 7]], [["event-owner-candidates-read", 12]]]);
    assert.ok(samples.every((phases) => phases.length === 6 && phases.every((phase) => phase.count === 1)));
    const before = structuredClone(reports);
    process.hrtime.bigint = () => { throw new Error("closed scan must not read the clock"); };
    late();
    assert.deepEqual(reports, before);
  } finally { release(); process.hrtime.bigint = clock; }
});

test.each([
  { format: "gzip", code: "EVENT_LEDGER_ARCHIVE_INVALID" },
  { format: "jsonl", code: "VAULT_INVALID_JSONL" },
  { format: "symlink", code: "VAULT_PATH_SYMLINK" },
])("scan breakdown preserves real $format failure and emits no revision totals", async ({ format, code }) => {
  await withVault(async (vaultRoot) => {
    await writeShard(vaultRoot, 1, [meal(1)], format === "gzip" ? "gzip" : "jsonl");
    const file = path.join(vaultRoot, `${shard(1)}${format === "gzip" ? ".gz" : ""}`);
    if (format === "symlink") {
      const target = path.join(vaultRoot, "synthetic-source.jsonl");
      await fs.rename(file, target);
      await fs.symlink(target, file);
    } else { await fs.writeFile(file, "{invalid synthetic data\n"); }
    const read = () => readOwnedEvent({ vaultRoot, kind: "meal", ownerId });
    await assert.rejects(read(), { code });
    const measured = timed(async () => { await read(); });
    await assert.rejects(measured.done, { code });
    const parent = measured.reports[0]!.commands[0]!.phases.find((phase) => phase.phase === "event-owner-candidates")!;
    checkReport(measured.reports, vaultRoot, "error", parent.sumUs);
  });
});

test.each(["listing", 1, 2] as const)("owner timing closes on storage failure at %s without replacing the error", async (at) => {
  await withVault(async (vaultRoot) => {
    await writeShard(vaultRoot, 1, [meal(1)]);
    const original = Object.assign(new Error(privateText), { code: "EACCES", path: vaultRoot });
    await withStorageClock(async () => {
      const measured = timed(async () => { await readOwnedEvent({ vaultRoot, kind: "meal", ownerId }); });
      await assert.rejects(measured.done, (error) => error === original);
      checkReport(measured.reports, vaultRoot, "error", at === "listing" ? 11 : 24, at === 2 ? 13 : undefined);
    }, { at, error: original });
  });
});

test.each([
  { name: "no candidate", rows: [unrelated], code: "EVENT_MISSING", revisions: false },
  { name: "invalid candidate", rows: [{ ...meal(1), id: null }], code: "EVENT_CONTRACT_INVALID", revisions: false },
  { name: "invalid reassigned revision", rows: [meal(1), { ...meal(2, 1, oldOwnerId), title: null }], code: "EVENT_CONTRACT_INVALID", revisions: true },
  { name: "duplicate owner", rows: [meal(1), { ...meal(1), id: deterministicContractId("evt", "synthetic-duplicate-owner") }], code: "EVENT_OWNER_AMBIGUOUS", revisions: true },
  { name: "deletion", rows: [meal(1), { ...meal(2), lifecycle: { revision: 2, state: "deleted" } }], code: "EVENT_MISSING", revisions: true },
  { name: "reassignment", rows: [meal(1), meal(2, 1, oldOwnerId)], code: "EVENT_MISSING", revisions: true },
])("owner timing preserves $name failure and records only entered phases", async ({ rows, code, revisions }) => {
  await withVault(async (vaultRoot) => {
    await writeShard(vaultRoot, 1, rows);
    const read = () => readOwnedEvent({ vaultRoot, kind: "meal", ownerId });
    await assert.rejects(read(), { code });
    await withStorageClock(async () => {
      const measured = timed(async () => { await read(); });
      await assert.rejects(measured.done, { code });
      checkReport(measured.reports, vaultRoot, "error", 24, revisions ? 13 : undefined);
    });
  });
});
