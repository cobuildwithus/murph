import assert from "node:assert/strict";
import { access, appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, vi } from "vitest";
import * as core from "@murphai/core";
import * as query from "@murphai/query";
import { QUERY_DB_RELATIVE_PATH } from "@murphai/runtime-state/node";
import { withCliTiming, timeCliDispatch } from "@murphai/runtime-state/node/cli-timing";
import type { CliTiming } from "@murphai/runtime-state/cli-timing";
import { createIntegratedVaultServices } from "@murphai/vault-usecases/vault-services";
import { experimentPath, seedExperimentListFixture } from "../bench/experiment-list-fixture.ts";

const services = createIntegratedVaultServices();
const requestId = "synthetic-followup-source";
const slug = "synthetic-list-1";
const lookup = core.deterministicContractId("exp", slug);
const read = (vault: string, kind: "missed-log" | "weekly-digest", date?: string, target = slug) =>
  services.query.showExperimentFollowupDue({ vault, requestId, lookup: target, kind, date });
async function fixture(run: (vault: string) => Promise<void>) {
  const vault = await mkdtemp(path.join(tmpdir(), "murph-followup-source-"));
  try { await seedExperimentListFixture(core, vault, 2); await run(vault); }
  finally { await rm(vault, { recursive: true, force: true }); }
}
async function parity(vault: string, kind: "missed-log" | "weekly-digest", date?: string) {
  const actual = await read(vault, kind, date);
  const previous = query.decideExperimentFollowupDue(await query.readVault(vault), slug, { kind, date });
  assert.deepEqual(actual, { experimentId: lookup, lookupId: lookup, slug,
    kind: previous.kind, date: previous.date, decision: previous });
  assert.deepEqual(await read(vault, kind, date, lookup), actual);
}

test("followup reads preserve both decisions across dates, lifecycle changes and canonical revisions", async () => {
  await fixture(async vault => {
    for (const kind of ["missed-log", "weekly-digest"] as const) {
      for (const date of ["2025-12-31", "2026-01-08", "2026-01-20", "2026-02-01"]) await parity(vault, kind, date);
    }
    for (const status of ["paused", "completed", "active"] as const) {
      await core.updateExperiment({ vaultRoot: vault, relativePath: experimentPath(1), status });
      await parity(vault, "missed-log", "2026-01-20");
      await parity(vault, "weekly-digest", "2026-01-20");
    }
    const shard = path.join(vault, "ledger/events/2026/2026-01.jsonl");
    const event = { schemaVersion: "murph.event.v1", id: "evt_synthetic_followup_note", kind: "note",
      source: "manual", title: "Synthetic follow-up context", experimentSlug: slug,
      occurredAt: "2026-01-20T12:00:00Z", recordedAt: "2026-01-20T12:00:00Z" };
    for (const revision of [1, 2]) {
      await core.withCanonicalWriteLock(vault, () => appendFile(shard, JSON.stringify({ ...event,
        lifecycle: { revision, ...(revision === 2 ? { state: "deleted" } : {}) },
      }) + "\n"));
      await parity(vault, "missed-log", "2026-01-20");
    }
  });
});

test("followup default date retains the vault timezone", async () => {
  await fixture(async vault => {
    const file = path.join(vault, "vault.json");
    const metadata = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify({ ...metadata, timezone: "America/Los_Angeles" }));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-21T01:00:00Z"));
    try {
      await parity(vault, "missed-log");
      assert.equal((await read(vault, "missed-log")).date, "2026-01-20");
    } finally { vi.useRealTimers(); }
  });
});

test("cold and stale followup reads avoid global projection work and remain reentrant", async () => {
  await fixture(async vault => {
    const canonicalBefore = await readFile(path.join(vault, experimentPath(1)), "utf8");
    let report: CliTiming | undefined;
    await withCliTiming(() => timeCliDispatch("experiment followup due", async () => {
      await core.withCanonicalWriteLock(vault, () => read(vault, "missed-log", "2026-01-20"));
    }), value => { report = value; });
    assert.ok(report);
    assert.equal(report.droppedCalls + report.droppedSpans, 0);
    assert.ok(!report.commands.flatMap(command => command.phases).some(phase => phase.phase === "query-rebuild"));
    await assert.rejects(access(path.join(vault, QUERY_DB_RELATIVE_PATH)), { code: "ENOENT" });
    assert.equal(await readFile(path.join(vault, experimentPath(1)), "utf8"), canonicalBefore);
    await query.readVault(vault);
    const before = await readFile(path.join(vault, QUERY_DB_RELATIVE_PATH));
    await core.updateExperiment({ vaultRoot: vault, relativePath: experimentPath(1), status: "paused" });
    await read(vault, "weekly-digest", "2026-01-20");
    assert.deepEqual(await readFile(path.join(vault, QUERY_DB_RELATIVE_PATH)), before);
    await parity(vault, "weekly-digest", "2026-01-20");
  });
});

test("followup preserves missing targets and strict source error mapping", async () => {
  await fixture(async vault => {
    await assert.rejects(read(vault, "missed-log", "2026-01-20", "missing"), { code: "not_found" });
    await appendFile(path.join(vault, "ledger/events/2026/2026-01.jsonl"), "invalid-json\n");
    await assert.rejects(read(vault, "missed-log", "2026-01-20"), { code: "vault_error" });
  });
});
