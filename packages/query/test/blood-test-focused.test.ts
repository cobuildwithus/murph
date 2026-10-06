import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, test, vi } from "vitest";
import * as core from "@murphai/core";
import { QUERY_DB_RELATIVE_PATH } from "@murphai/runtime-state/node";
import { timeCliDispatch, withCliTiming } from "@murphai/runtime-state/node/cli-timing";
import type { CliTiming } from "@murphai/runtime-state/cli-timing";
import { getQueryProjectionStatus, listBloodTests, listCanonicalEntities, showBloodTest } from "../src/index.ts";
import * as source from "../src/vault-source.ts";

const roots: string[] = [];
const shard = "ledger/events/2026/2026-03.jsonl";
const panel = (id: string, date: string, extra: Record<string, unknown> = {}) => ({
  schemaVersion: "murph.event.v1", id, kind: "test", source: "manual", title: "Synthetic panel",
  occurredAt: `${date}T08:00:00Z`, recordedAt: `${date}T09:00:00Z`, testCategory: "blood",
  testName: "synthetic-panel", resultStatus: "normal", lifecycle: { revision: 1 }, ...extra,
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "murph-blood-focused-")); roots.push(root);
  await core.initializeVault({ vaultRoot: root, timezone: "UTC", createdAt: "2026-03-01T00:00:00Z" });
  await mkdir(path.dirname(path.join(root, shard)), { recursive: true });
  const rows = [
    panel("evt_urine", "2026-03-06", { testCategory: "urine", specimenType: "urine" }),
    panel("evt_other_blood", "2026-03-05", { title: "Unmatched panel" }),
    panel("evt_target_b", "2026-03-04", { title: "Target panel", labPanelId: "synthetic-alias", resultStatus: "mixed" }),
    panel("evt_target_a", "2026-03-04", { title: "Target serum", testCategory: "other", specimenType: "serum" }),
    panel("evt_older", "2026-03-02", { title: "Target older" }),
  ];
  await core.withCanonicalWriteLock(root, () => writeFile(path.join(root, shard), rows.map(row => JSON.stringify(row)).join("\n") + "\n"));
  return { root, rows };
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function measuredList(root: string, options: Parameters<typeof listBloodTests>[1] = {}) {
  let report: CliTiming | undefined;
  let value!: Awaited<ReturnType<typeof listBloodTests>>;
  await withCliTiming(() => timeCliDispatch("blood-test list", async () => { value = await listBloodTests(root, options); }), timing => { report = timing; });
  assert.ok(report);
  const forbidden = new Set(["query-rebuild", "query-metric-projection", "query-wearable-summary", "query-search-documents", "query-publication"]);
  assert.ok(report.commands.every(command => command.phases.every(phase => !forbidden.has(phase.phase))));
  return value;
}

test("blood lists classify/filter before limit, preserve aliases, dates, ordering and full global parity", async () => {
  const { root, rows } = await fixture();
  const options = [{}, { text: "TARGET", limit: 1 }, { from: "2026-03-04", to: "2026-03-04" },
    { text: "target", status: "mixed", limit: 1 }, { text: "missing" }, { limit: 0 }];
  const cold = await Promise.all(options.map(selection => measuredList(root, selection)));
  assert.deepEqual(cold[0]!.map(row => row.id), ["evt_other_blood", "evt_target_a", "evt_target_b", "evt_older"]);
  assert.deepEqual(cold[1]!.map(row => row.id), ["evt_target_a"]);
  assert.deepEqual(cold[2]!.map(row => row.id), ["evt_target_a", "evt_target_b"]);
  assert.deepEqual(cold[3]!.map(row => row.id), ["evt_target_b"]);
  assert.deepEqual(cold[4], []);
  assert.equal((await showBloodTest(root, "synthetic-alias"))?.id, "evt_target_b");
  assert.equal((await getQueryProjectionStatus(root)).exists, false);
  await listCanonicalEntities(root, { limit: null });
  assert.equal((await getQueryProjectionStatus(root)).fresh, true);
  let database = await readFile(path.join(root, QUERY_DB_RELATIVE_PATH));
  assert.deepEqual(await Promise.all(options.map(selection => measuredList(root, selection))), cold);
  assert.deepEqual(await readFile(path.join(root, QUERY_DB_RELATIVE_PATH)), database);
  for (const revision of [2, 3]) {
    await core.withCanonicalWriteLock(root, () => appendFile(path.join(root, shard), JSON.stringify({ ...rows[3],
      title: "Corrected target", occurredAt: "2026-03-07T08:00:00Z",
      lifecycle: { revision, ...(revision === 3 ? { state: "deleted" } : {}) },
    }) + "\n"));
    const corrected = await measuredList(root);
    assert.equal(corrected.some(row => row.id === "evt_target_a"), revision === 2);
    if (revision === 2) assert.equal(corrected[0]?.title, "Corrected target");
    assert.deepEqual(await readFile(path.join(root, QUERY_DB_RELATIVE_PATH)), database);
    assert.equal((await getQueryProjectionStatus(root)).fresh, false);
    // Explicit global work is still required, not silently certified by the list.
    await listCanonicalEntities(root, { limit: null });
    assert.equal((await getQueryProjectionStatus(root)).fresh, true);
    assert.equal(JSON.stringify(await measuredList(root)), JSON.stringify(corrected));
    // Compare the next stale read against this last committed global generation.
    database = await readFile(path.join(root, QUERY_DB_RELATIVE_PATH));
  }
});

test("blood lists isolate unrelated families but reject malformed selected events without publication", async () => {
  const { root } = await fixture();
  const expected = await measuredList(root);
  const unrelated = path.join(root, "bank/goals/synthetic-broken.md");
  await mkdir(path.dirname(unrelated), { recursive: true });
  // Missing closing frontmatter, not a scalar which happens to contain "[".
  await writeFile(unrelated, "---\ntitle: Synthetic incomplete goal\n");
  assert.deepEqual(await measuredList(root), expected);
  await assert.rejects(listCanonicalEntities(root), { code: "QUERY_SOURCE_INVALID", details: {
    querySource: true, relativePath: "bank/goals/synthetic-broken.md", issue: "frontmatter_invalid",
  } });
  assert.equal((await getQueryProjectionStatus(root)).exists, false);
  await rm(unrelated); await listCanonicalEntities(root);
  const before = await readFile(path.join(root, QUERY_DB_RELATIVE_PATH));
  await core.withCanonicalWriteLock(root, () => appendFile(path.join(root, shard), "{malformed synthetic event\n"));
  const error = await source.readCanonicalEntityFamilySource(root, "event").then(() => null, (error: unknown) => error);
  assert.ok(error instanceof Error);
  for (const options of [{}, { text: "missing", limit: 0 }, { from: "2099-01-01" }]) {
    await assert.rejects(listBloodTests(root, options), (actual: unknown) => {
      assert.ok(actual instanceof Error); assert.equal(actual.constructor, error.constructor); assert.equal(actual.message, error.message); return true;
    });
  }
  assert.deepEqual(await readFile(path.join(root, QUERY_DB_RELATIVE_PATH)), before);
});

test("a blood reader captures the locked event generation and remains reentrant with a queued reader", async () => {
  const { root, rows } = await fixture();
  let enter!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; });
  let resume!: () => void; const resumed = new Promise<void>(resolve => { resume = resolve; });
  const readSource = source.readCanonicalEntityFamilySource;
  vi.spyOn(source, "readCanonicalEntityFamilySource").mockImplementation((...args) => {
    assert.equal(existsSync(path.join(root, core.CANONICAL_WRITE_LOCK_DIRECTORY)), true);
    return readSource(...args);
  });
  const owner = core.withCanonicalWriteLock(root, async () => {
    enter(); await resumed;
    await appendFile(path.join(root, shard), JSON.stringify({ ...rows[0], testCategory: "blood", lifecycle: { revision: 2 } }) + "\n");
    const nested = listBloodTests(root);
    assert.notEqual(await Promise.race([nested, delay(1000).then(() => "blocked")]), "blocked");
  });
  await entered;
  const outside = listBloodTests(root);
  try {
    assert.equal(await Promise.race([outside.then(() => "exposed"), delay(50).then(() => "waiting")]), "waiting");
    resume(); await owner;
    assert.equal((await outside)[0]?.id, "evt_urine");
    assert.equal((await getQueryProjectionStatus(root)).exists, false);
  } finally { resume(); await Promise.allSettled([owner, outside]); }
});


test("empty blood history stays empty without creating a global projection", async () => {
  const { root } = await fixture();
  await core.withCanonicalWriteLock(root, () => writeFile(path.join(root, shard), ""));
  assert.deepEqual(await measuredList(root), []);
  assert.equal((await getQueryProjectionStatus(root)).exists, false);
  await listCanonicalEntities(root);
  assert.deepEqual(await measuredList(root), []);
  assert.equal((await getQueryProjectionStatus(root)).fresh, true);
});
