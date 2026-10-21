import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test, vi } from "vitest";
import * as core from "@murphai/core";
import * as query from "@murphai/query";
import { EXPERIMENT_STATUSES } from "@murphai/contracts";
import { QUERY_DB_RELATIVE_PATH } from "@murphai/runtime-state/node";
import { withCliTiming, timeCliDispatch } from "@murphai/runtime-state/node/cli-timing";
import type { CliTiming, CliTimingPhase } from "@murphai/runtime-state/cli-timing";
import { createIntegratedVaultServices } from "@murphai/vault-usecases/vault-services";
import { asListEnvelope, toListEntity } from "../src/usecases/shared.js";
import { experimentPath, seedExperimentListFixture } from "../bench/experiment-list-fixture.ts";
import { fingerprint } from "../bench/wearable-sleep-fixture.ts";

const services = createIntegratedVaultServices();
const requestId = "synthetic-experiment-list-contract";
type Selection = Partial<Pick<Parameters<typeof services.query.listExperiments>[0], "status" | "limit">>;
const list = (vault: string, selection: Selection = {}) => services.query.listExperiments({ vault, requestId, limit: 100, ...selection });
const globalRead = (vault: string) => services.query.list({ vault, requestId, limit: 100 });
const id = (index: number) => core.deterministicContractId("exp", `synthetic-list-${index}`);
async function fixture(count = 12) {
  const vault = await mkdtemp(path.join(tmpdir(), "murph-experiment-list-contract-"));
  if (count === 0) await core.initializeVault({ vaultRoot: vault, timezone: "UTC" });
  else await seedExperimentListFixture(core, vault, count);
  return vault;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function timed<T>(run: () => Promise<T>) {
  let timing: CliTiming | undefined;
  let result: { value: T } | undefined;
  await withCliTiming(() => timeCliDispatch("experiment list", async () => {
    result = { value: await run() };
  }), report => { timing = report; });
  assert.ok(result);
  assert.ok(timing);
  assert.equal(timing.droppedCalls + timing.droppedSpans, 0);
  return { value: result.value, phases: timing.commands.flatMap(command => command.phases.map(phase => phase.phase)) };
}

// Prior selection owner, plus the existing public show mapper and list compactor.
// This is not an alternate entity projector. The paired checkout benchmark also
// compares the actual old/new list services byte-for-byte without this oracle.
async function priorEnvelope(vault: string, selection: Selection = {}) {
  const limit = selection.limit ?? 100;
  const entities = query.listEntities(await query.readVault(vault), {
    families: ["experiment"], statuses: selection.status ? [selection.status] : undefined,
  }).slice(0, limit);
  const items = await Promise.all(entities.map(async entity => toListEntity(
    (await services.query.showExperiment({ vault, requestId, lookup: entity.entityId })).entity,
  )));
  return asListEnvelope(vault, { status: selection.status ?? null, limit }, items);
}

for (const count of [0, 1, 12]) {
  test(`experiment list preserves complete prior envelopes for ${count} empty/sparse/rich documents`, async () => {
    const vault = await fixture(count);
    try {
      const selections: Selection[] = [{}, { limit: 0 }, ...EXPERIMENT_STATUSES.map(status => ({ status, limit: 2 }))];
      for (const selection of selections) {
        const actual = await list(vault, selection);
        assert.deepEqual(actual, await priorEnvelope(vault, selection));
        assert.deepEqual(fingerprint(actual), fingerprint(await priorEnvelope(vault, selection)));
        assert.equal(actual.nextCursor, null);
      }
      if (count === 12) {
        assert.deepEqual((await list(vault, { status: "active", limit: 2 })).items.map(item => item.id), [id(1), id(6)]);
        assert.deepEqual((await list(vault)).items.slice(0, 2).map(item => item.id), [id(0), id(1)].sort((a, b) => a.localeCompare(b)));
        const rich = (await list(vault)).items.find(item => item.id === id(1));
        assert.ok(rich);
        assert.equal(rich.path, experimentPath(1));
        assert.equal(rich.data.schemaVersion, "murph.frontmatter.experiment.v1");
        assert.ok(rich.data.runPlan && rich.data.analysisPlan && rich.excerpt);
        assert.deepEqual(rich.data.commonsProtocolRef, {
          key: "protocol_variant:synthetic-walk/standard",
          pageRevisionId: `sha256:${"1".repeat(64)}`, runSpecRevisionId: `sha256:${"2".repeat(64)}`,
        });
        assert.ok(rich.data.protocolRef && rich.data.effectiveProtocolSnapshot);
        assert.deepEqual(rich.links, [], "Markdown references are not invented query links");
      }
    } finally { await rm(vault, { recursive: true, force: true }); }
  });
}

for (const prewarm of [false, true]) {
  for (const issue of ["frontmatter_invalid", "missing_field", "document_path_mismatch"] as const) {
    test(`selected experiment errors stay strict before filters/limit (${issue}, warm=${prewarm})`, async () => {
      const vault = await fixture(1);
      const relativePath = experimentPath(0);
      try {
        if (prewarm) await globalRead(vault);
        const original = await readFile(path.join(vault, relativePath), "utf8");
        const malformed = issue === "frontmatter_invalid" ? "---\ntitle: Synthetic incomplete experiment\n"
          : issue === "missing_field" ? original.replace(/^experimentId:.*\n/mu, "")
          : original.replace("slug: synthetic-list-0", "slug: synthetic-other");
        assert.notEqual(malformed, original);
        await writeFile(path.join(vault, relativePath), malformed);
        const expected = { code: "QUERY_SOURCE_INVALID", details: { querySource: true, relativePath, issue,
          ...(issue === "missing_field" ? { field: "experimentId" } : issue === "document_path_mismatch" ? { field: "slug" } : {}) } };
        await assert.rejects(list(vault, { status: "active", limit: 0 }), expected);
        await assert.rejects(globalRead(vault), expected);
      } finally { await rm(vault, { recursive: true, force: true }); }
    });
  }
  for (const family of ["goal", "event"] as const) {
    test(`unrelated malformed ${family} does not block experiment list (warm=${prewarm})`, async () => {
      const vault = await fixture(1);
      try {
        const before = await list(vault);
        if (prewarm) await globalRead(vault);
        const goalPath = "bank/goals/synthetic-broken.md";
        if (family === "goal") {
          await mkdir(path.dirname(path.join(vault, goalPath)), { recursive: true });
          await writeFile(path.join(vault, goalPath), "---\ntitle: Synthetic incomplete goal\n");
        } else await appendFile(path.join(vault, "ledger/events/2026/2026-01.jsonl"), "{invalid synthetic JSON\n");
        assert.deepEqual(await list(vault), before);
        assert.equal((await list(vault, { status: "active" })).count, 0);
        await assert.rejects(globalRead(vault), family === "event" ? { code: "VAULT_INVALID_JSONL" }
          : { code: "QUERY_SOURCE_INVALID", details: { querySource: true, relativePath: goalPath, issue: "frontmatter_invalid" } });
      } finally { await rm(vault, { recursive: true, force: true }); }
    });
  }
}

test("relevant canonical edits and status transitions are visible without publishing any query cache", async () => {
  const vault = await fixture();
  const forbidden: readonly CliTimingPhase[] = ["query-freshness", "query-manifest", "query-status", "query-rebuild", "query-source-read",
    "query-wearable-dataset", "query-metric-projection", "query-wearable-summary", "query-search-documents", "query-publication"];
  const full = vi.spyOn(query, "readVault");
  const family = vi.spyOn(query, "readCanonicalEntityFamilySource");
  try {
    for (let read = 0; read < 3; read++) {
      assert.deepEqual((await timed(() => list(vault))).phases.filter(phase => forbidden.includes(phase)), []);
      assert.equal((await query.getQueryProjectionStatus(vault)).exists, false);
    }
    assert.equal(full.mock.calls.length, 0);
    assert.deepEqual(family.mock.calls, Array.from({ length: 3 }, () => [vault, "experiment"]));
    const positive = await timed(() => globalRead(vault));
    for (const phase of forbidden.filter(phase => phase !== "query-source-read")) assert.ok(positive.phases.includes(phase), phase);
    const db = path.join(vault, QUERY_DB_RELATIVE_PATH);
    const bytes = await readFile(db);
    for (const status of EXPERIMENT_STATUSES) {
      await core.updateExperiment({ vaultRoot: vault, relativePath: experimentPath(0), status, title: `Synthetic ${status}` });
      const value = (await timed(() => list(vault, { status }))).value;
      assert.equal(value.items.find(item => item.id === id(0))?.title, `Synthetic ${status}`);
      assert.equal((await query.getQueryProjectionStatus(vault)).fresh, false);
      assert.deepEqual(await readFile(db), bytes);
    }
    // Physical source removal: no experiment tombstone status or event-style
    // collapse is invented. Tombstones belong to the unrelated event fixture.
    await core.withCanonicalWriteLock(vault, async () => {
      await rm(path.join(vault, experimentPath(0)));
    });
    assert.ok(!(await list(vault)).items.some(item => item.id === id(0)));
    assert.deepEqual(await list(vault), await priorEnvelope(vault));
  } finally {
    full.mockRestore(); family.mockRestore();
    await rm(vault, { recursive: true, force: true });
  }
});

for (const prewarm of [false, true]) for (const outcome of ["commit", "rollback"] as const) {
  test(`experiment list waits for real canonical persistence (${outcome}, warm=${prewarm})`, async () => {
    const vault = await fixture(1);
    const held = deferred();
    const release = deferred();
    let read: ReturnType<typeof list> | undefined;
    let settledWrite: Promise<unknown> | undefined;
    try {
      if (prewarm) await globalRead(vault);
      const write = core.withHostedCanonicalWritePort({ async persistCanonicalWrite() {
        held.resolve(); await release.promise;
        if (outcome === "rollback") throw new Error("synthetic persistence failure");
      } }, () => core.updateExperiment({ vaultRoot: vault, relativePath: experimentPath(0), title: "Committed synthetic experiment" }));
      settledWrite = write.then(() => null, (error: unknown) => error);
      await Promise.race([held.promise, settledWrite.then(() => { throw new Error("Writer missed persistence"); })]);
      read = list(vault);
      assert.equal(await Promise.race([read.then(() => "exposed"), delay(100).then(() => "waiting")]), "waiting");
      release.resolve();
      const error = await settledWrite;
      if (outcome === "rollback") assert.match(String(error), /synthetic persistence failure/u);
      else assert.equal(error, null);
      assert.equal((await read).items[0]?.title, outcome === "commit" ? "Committed synthetic experiment" : "Synthetic experiment 0");
    } finally {
      release.resolve(); await settledWrite; await read?.catch(() => undefined);
      await rm(vault, { recursive: true, force: true });
    }
  });
}

test("canonical owner can list reentrantly while an outside experiment reader waits", async () => {
  const vault = await fixture(1);
  const held = deferred(); const enter = deferred(); const waiting = deferred();
  let nested: ReturnType<typeof list> | undefined;
  const owner = core.withCanonicalWriteLock(vault, async () => {
    held.resolve(); await enter.promise;
    nested = list(vault);
    assert.equal(await Promise.race([nested.then(() => "read"), delay(1000).then(() => "deadlock")]), "read");
  });
  await held.promise;
  const original = core.withCanonicalWriteLock;
  const spy = vi.spyOn(core, "withCanonicalWriteLock").mockImplementation(async <T>(root: string | undefined, run: () => Promise<T>) => {
    waiting.resolve(); return original(root, run);
  });
  const outside = list(vault);
  try {
    await Promise.race([waiting.promise, outside.then(() => { throw new Error("Read bypassed the canonical lock"); })]);
    enter.resolve(); await owner;
    assert.deepEqual(await outside, await nested);
  } finally {
    enter.resolve(); await Promise.allSettled([owner, outside]); spy.mockRestore();
    await nested?.catch(() => undefined); await rm(vault, { recursive: true, force: true });
  }
});

for (const [code, expected] of [["VAULT_INVALID_METADATA", "invalid_metadata"],
  ["VAULT_UNSUPPORTED_FORMAT", "unsupported_format"]] as const) {
  test(`experiment list retains the existing ${code} error translation`, async () => {
    const vault = await fixture(0);
    // Inject the actual owner's typed error, not an invalid frontmatter guess.
    const spy = vi.spyOn(query, "readCanonicalEntityFamilySource")
      .mockRejectedValue(new core.VaultError(code, "Synthetic owner failure"));
    try { await assert.rejects(list(vault), { code: expected, context: { vaultCode: code, stage: "validation" } }); }
    finally { spy.mockRestore(); await rm(vault, { recursive: true, force: true }); }
  });
}

test("experiment list does not translate or swallow an owner's cancellation", async () => {
  const vault = await fixture(0);
  const aborted = new DOMException("Synthetic cancellation", "AbortError");
  const spy = vi.spyOn(query, "readCanonicalEntityFamilySource").mockRejectedValue(aborted);
  try { await assert.rejects(list(vault), error => error === aborted); }
  finally { spy.mockRestore(); await rm(vault, { recursive: true, force: true }); }
});
