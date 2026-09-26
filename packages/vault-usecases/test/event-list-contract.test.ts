import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test, vi } from "vitest";
import * as core from "@murphai/core";
import { addMeal, initializeVault, withCanonicalWriteLock, withHostedCanonicalWritePort } from "@murphai/core";
import { createIntegratedVaultServices } from "@murphai/vault-usecases/vault-services";
import { getQueryProjectionStatus } from "@murphai/query";
import { QUERY_DB_RELATIVE_PATH } from "@murphai/runtime-state/node";
import { withCliTiming } from "@murphai/runtime-state/node/cli-timing";
import type { CliTiming } from "@murphai/runtime-state/cli-timing";

const services = createIntegratedVaultServices();
type EventFilters = Partial<Omit<Parameters<typeof services.query.listEvents>[0], "vault" | "requestId">>;
const list = (vault: string, filters: EventFilters = {}) => services.query.listEvents({
  vault, requestId: "synthetic-event-list-contract", limit: 100, ...filters,
});
const ids = (result: Awaited<ReturnType<typeof list>>) => result.items.map((item) => item.id);
const shard = "ledger/events/2026/2026-04.jsonl";
function note(id: string, fields: Record<string, unknown> = {}) {
  return { schemaVersion: "murph.event.v1", id: `evt_synthetic_${id}`, kind: "note",
    occurredAt: "2026-04-11T02:00:00.000Z", recordedAt: "2026-04-11T03:00:00.000Z",
    source: "manual", title: "Synthetic note", dayKey: "2026-04-10",
    tags: ["alpha"], experimentSlug: "synthetic-study", ...fields };
}
async function fixture(rows: Record<string, unknown>[] = []) {
  const vault = await mkdtemp(path.join(tmpdir(), "murph-event-list-contract-"));
  await initializeVault({ vaultRoot: vault, timezone: "America/Los_Angeles" });
  await mkdir(path.dirname(path.join(vault, shard)), { recursive: true });
  await writeFile(path.join(vault, shard), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  return vault;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function timed<T>(run: () => Promise<T>) {
  let timing: CliTiming | undefined;
  const result = await withCliTiming(run, (report) => { timing = report; });
  assert.ok(timing);
  assert.equal(timing.droppedCalls + timing.droppedSpans, 0);
  assert.equal(timing.transportTruncated, false);
  return { result, phases: timing.commands.flatMap((command) => command.phases.map((phase) => phase.phase)) };
}
const globalPhases = ["query-rebuild", "query-metric-projection", "query-search-documents",
  "query-wearable-dataset", "query-wearable-summary", "query-publication"];
function assertEventOnly(report: Awaited<ReturnType<typeof timed>>, sourceRead: boolean) {
  assert.ok(report.phases.includes("query-freshness"), "Timing must observe the real query owner");
  assert.deepEqual(report.phases.filter((phase) => globalPhases.includes(phase)), []);
  assert.equal(report.phases.includes("query-source-read"), sourceRead);
}

test("event list preserves date fallback, canonical order, tag OR, experiment and post-filter limit", async () => {
  const vault = await fixture([
    note("b", { tags: ["beta"] }), note("a"),
    note("fallback", { dayKey: undefined, occurredAt: "2026-04-10T09:00:00.000Z" }),
    note("other_date", { dayKey: "2026-04-11" }),
    note("other_experiment", { experimentSlug: "synthetic-control" }),
    note("other_kind", { kind: "meal" }),
  ]);
  try {
    const filters = { kind: "note", from: "2026-04-10", to: "2026-04-10",
      tag: ["alpha", "beta"], experiment: "synthetic-study", limit: 2 };
    const result = await list(vault, filters);
    assert.deepEqual(ids(result), ["evt_synthetic_fallback", "evt_synthetic_a"]);
    assert.deepEqual(result.filters, filters);
    assert.equal(result.count, 2);
    assert.equal(result.nextCursor, null);
    assert.deepEqual(ids(await list(vault, { ...filters, limit: 10 })),
      ["evt_synthetic_fallback", "evt_synthetic_a", "evt_synthetic_b"]);
    assert.equal((await list(vault, { ...filters, tag: ["ALPHA"] })).count, 0);
    assert.equal((await list(vault, { ...filters, limit: 0 })).count, 0);
    const selections: EventFilters[] = [{}, filters, { ...filters, limit: 10 },
      { ...filters, tag: ["ALPHA"] }, { ...filters, limit: 0 },
      { kind: "missing" }, { kind: "", from: "", to: "" },
      { from: "2026-04-10", to: "2026-04-11" }, { experiment: "synthetic-control" }];
    const direct = [];
    for (const selection of selections) direct.push(await list(vault, selection));
    await services.query.list({ vault, requestId: "synthetic-event-list-contract", limit: 40 });
    for (const [index, selection] of selections.entries()) {
      assert.deepEqual(await list(vault, selection), direct[index], "Fresh indexed and direct envelopes must match");
    }
  } finally { await rm(vault, { recursive: true, force: true }); }
});

test("revisions, duplicate rows, retractions and metric visibility precede event selection", async () => {
  const moved = note("moved", { lifecycle: { revision: 1 } });
  const deleted = note("deleted", { lifecycle: { revision: 1 } });
  const duplicate = note("duplicate");
  const vault = await fixture([
    moved, duplicate, duplicate, deleted,
    note("hidden", { kind: "observation", metric: "heart-rate", value: 72, unit: "bpm" }),
    note("display", { kind: "observation", metric: "resting-heart-rate", value: 58,
      unit: "bpm", canonicalFact: true }),
  ]);
  try {
    const initial = await list(vault);
    assert.ok(ids(initial).includes("evt_synthetic_moved"));
    await services.query.list({ vault, requestId: "synthetic-event-list-contract", limit: 40 });
    assert.deepEqual(await list(vault), initial);
    // A different shard proves that date selection cannot precede history collapse.
    const correctionShard = path.join(vault, "ledger/events/2026/2026-05.jsonl");
    await writeFile(correctionShard, [
      { ...moved, lifecycle: { revision: 2 }, dayKey: "2026-05-01",
        occurredAt: "2026-05-01T12:00:00.000Z", title: "Corrected synthetic note" },
      { ...deleted, lifecycle: { revision: 2, state: "deleted" } },
    ].map((row) => JSON.stringify(row)).join("\n") + "\n");
    const all = ids(await list(vault));
    assert.equal(all.filter((id) => id === "evt_synthetic_duplicate").length, 1);
    assert.ok(!all.includes("evt_synthetic_hidden"));
    assert.ok(all.includes("evt_synthetic_display"));
    assert.ok(!all.includes("evt_synthetic_deleted"));
    assert.deepEqual(ids(await list(vault, { from: "2026-05-01", to: "2026-05-01" })), ["evt_synthetic_moved"]);
    assert.ok(!ids(await list(vault, { to: "2026-04-30" })).includes("evt_synthetic_moved"));
    const beforeWrite = await list(vault);
    await services.query.list({ vault, requestId: "synthetic-event-list-contract", limit: 40 });
    assert.deepEqual(await list(vault), beforeWrite);
    const meal = await addMeal({ vaultRoot: vault, occurredAt: "2026-05-02T12:00:00Z", note: "Synthetic fresh meal" });
    const afterWrite = await list(vault);
    assert.equal(afterWrite.count, beforeWrite.count + 1);
    assert.ok(ids(afterWrite).includes(meal.mealId));
    assert.deepEqual(await list(vault), afterWrite);
    await services.query.list({ vault, requestId: "synthetic-event-list-contract", limit: 40 });
    assert.deepEqual(await list(vault), afterWrite);
  } finally { await rm(vault, { recursive: true, force: true }); }
});

for (const target of ["event", "goal"] as const) {
for (const prewarm of [false, true]) {
  test(`event JSONL errors stay strict; malformed goal frontmatter is isolated (${target}, prewarm=${prewarm})`, async () => {
    const vault = await fixture([note("valid")]);
    const goalPath = "bank/goals/synthetic-broken.md";
    const expectedError = target === "event"
      ? { code: "VAULT_INVALID_JSONL" }
      : { code: "QUERY_SOURCE_INVALID", details: {
        querySource: true, relativePath: goalPath, issue: "frontmatter_invalid",
      } };
    try {
      const expected = await list(vault);
      if (prewarm) await services.query.list({ vault, requestId: "synthetic-event-list-contract", limit: 40 });
      if (target === "event") await appendFile(path.join(vault, shard), "{invalid synthetic JSON\n");
      else {
        const file = path.join(vault, goalPath);
        await mkdir(path.dirname(file), { recursive: true });
        // The strict goal reader rejects a missing closing delimiter. A lone
        // "[" is a valid plain scalar in the repository's frontmatter format.
        await writeFile(file, "---\ntitle: Synthetic incomplete goal\n");
      }
      const filtered = () => list(vault, { kind: "nonexistent", from: "2099-01-01" });
      if (target === "event") await assert.rejects(filtered(), expectedError);
      else {
        assert.deepEqual(await list(vault), expected);
        assert.equal((await filtered()).count, 0);
      }
      // Prove the malformed source really is invalid for its owning global read.
      await assert.rejects(services.query.list({ vault, requestId: "synthetic-event-list-contract", limit: 40 }), expectedError);
    } finally { await rm(vault, { recursive: true, force: true }); }
  });
}
}

for (const outcome of ["commit", "rollback"] as const) {
for (const prewarm of [false, true]) {
  test(`event list (prewarm=${prewarm}) waits for canonical persistence ${outcome} and never exposes tentative files`, async () => {
    const vault = await fixture();
    if (prewarm) await services.query.list({ vault, requestId: "synthetic-event-list-contract", limit: 40 });
    const held = deferred();
    const release = deferred();
    const write = withHostedCanonicalWritePort({
      async persistCanonicalWrite() {
        held.resolve();
        await release.promise;
        if (outcome === "rollback") throw new Error("synthetic persistence failure");
      },
    }, () => addMeal({ vaultRoot: vault, occurredAt: "2026-04-10T12:00:00Z", note: "Synthetic held meal" }));
    // Attach rejection handling before allowing the parked writer to resume.
    const settledWrite = write.then(() => null, (error: unknown) => error);
    let read: ReturnType<typeof list> | undefined;
    try {
      await Promise.race([held.promise, settledWrite.then(() => { throw new Error("Writer did not reach persistence"); })]);
      read = list(vault);
      assert.equal(await Promise.race([read.then(() => "exposed"), delay(100).then(() => "waiting")]), "waiting");
      release.resolve();
      const error = await settledWrite;
      if (outcome === "rollback") assert.match(String(error), /synthetic persistence failure/u);
      else assert.equal(error, null);
      assert.equal((await read).count, outcome === "commit" ? 1 : 0);
    } finally {
      release.resolve();
      await settledWrite;
      await read?.catch(() => undefined);
      await rm(vault, { recursive: true, force: true });
    }
  });
}
}

test("a canonical lock owner can list events while an outside reader waits", async () => {
  const vault = await fixture([note("reentrant")]);
  const held = deferred();
  const enterNested = deferred();
  let nested: ReturnType<typeof list> | undefined;
  const owner = withCanonicalWriteLock(vault, async () => {
    held.resolve();
    await enterNested.promise;
    nested = list(vault);
    assert.equal(await Promise.race([nested.then(() => "read"), delay(1000).then(() => "blocked")]), "read");
  });
  await held.promise;
  const waiting = deferred();
  const originalLock = core.withCanonicalWriteLock;
  const spy = vi.spyOn(core, "withCanonicalWriteLock").mockImplementation((...args: Parameters<typeof originalLock>) => {
    waiting.resolve();
    return originalLock(...args);
  });
  const outside = list(vault);
  try {
    await Promise.race([waiting.promise, outside.then(() => {
      throw new Error("Outside event read completed without waiting for the canonical lock");
    })]);
    enterNested.resolve();
    await owner;
    assert.deepEqual(ids(await outside), ["evt_synthetic_reentrant"]);
  } finally {
    enterNested.resolve();
    await Promise.allSettled([owner, outside]);
    spy.mockRestore();
    await nested?.catch(() => undefined);
    await rm(vault, { recursive: true, force: true });
  }
});


test("narrow reads do no global work; fresh reuse survives empty results and stale reads leave the cache alone", async () => {
  const vault = await fixture([note("first")]);
  const db = path.join(vault, QUERY_DB_RELATIVE_PATH);
  try {
    for (let read = 0; read < 3; read++) {
      assertEventOnly(await timed(() => list(vault)), true);
      assert.equal((await getQueryProjectionStatus(vault)).exists, false);
    }
    const global = await timed(() => services.query.list({ vault, requestId: "synthetic-event-list-contract", limit: 40 }));
    assert.deepEqual([...global.phases.filter((phase) => globalPhases.includes(phase))].sort(), [...globalPhases].sort(),
      "Positive control must observe every forbidden computation on an explicit global rebuild");
    const published = await readFile(db);
    for (const filters of [{}, { kind: "missing" }]) {
      const warm = await timed(() => list(vault, filters));
      assertEventOnly(warm, false);
      assert.ok(!warm.phases.includes("query-wait"), "Fresh indexed reads keep their lock-free path");
    }
    const meal = await addMeal({ vaultRoot: vault, occurredAt: "2026-04-12T12:00:00Z", note: "Synthetic update" });
    const stale = await timed(() => list(vault));
    assertEventOnly(stale, true);
    assert.ok(ids(stale.result).includes(meal.mealId));
    assert.equal((await getQueryProjectionStatus(vault)).fresh, false);
    assert.deepEqual(await readFile(db), published, "Event reads must not publish a partial cache");
    await services.query.list({ vault, requestId: "synthetic-event-list-contract", limit: 40 });
    const warm = await timed(() => list(vault));
    assertEventOnly(warm, false);
    assert.deepEqual(warm.result, stale.result);
  } finally { await rm(vault, { recursive: true, force: true }); }
});

test("an event reader rechecks fresh indexed state after waiting for a global reader's lock", async () => {
  const vault = await fixture([note("waiting")]);
  const held = deferred();
  const publish = deferred();
  const owner = withCanonicalWriteLock(vault, async () => {
    held.resolve();
    await publish.promise;
    await services.query.list({ vault, requestId: "synthetic-event-list-contract", limit: 40 });
  });
  await held.promise;
  const waiting = deferred();
  const originalLock = core.withCanonicalWriteLock;
  const spy = vi.spyOn(core, "withCanonicalWriteLock").mockImplementation((...args: Parameters<typeof originalLock>) => {
    waiting.resolve();
    return originalLock(...args);
  });
  const read = timed(() => list(vault));
  try {
    await Promise.race([waiting.promise, read.then(() => {
      throw new Error("Event read completed before the held canonical lock was released");
    })]);
    publish.resolve();
    await owner;
    const report = await read;
    assertEventOnly(report, false);
    assert.ok(report.phases.includes("query-wait"));
    assert.deepEqual(ids(report.result), ["evt_synthetic_waiting"]);
  } finally {
    publish.resolve();
    await Promise.allSettled([owner, read]);
    spy.mockRestore();
    await rm(vault, { recursive: true, force: true });
  }
});
