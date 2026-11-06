import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as core from "@murphai/core";
import * as query from "@murphai/query";
import * as timing from "@murphai/runtime-state/node/cli-timing";
import { createIntegratedVaultServices } from "@murphai/vault-usecases/vault-services";
import { afterEach, beforeEach, test, vi } from "vitest";
import {
  fingerprint, readGlobalProof, readSleepProof, reviseSleepFixture, seedSleepFixture, sleepDate, sleepNow, traceSleepRead,
} from "../bench/wearable-sleep-fixture.ts";

const roots: string[] = [];
const services = createIntegratedVaultServices();
const days = 5;
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(sleepNow)); });
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "murph-sleep-service-"));
  roots.push(root);
  await seedSleepFixture(core, root, days);
  return root;
}
async function pair() {
  const root = await fixture();
  const reference = await fixture();
  // Independent full publication, never promotion of the candidate's rows.
  await query.rebuildQueryProjection(reference);
  return { root, reference };
}
const filters = [
  {}, { providers: [] }, { providers: [" "] }, { providers: ["missing"] },
  { providers: ["oura"] }, { providers: [" OURA ", "oura", "whoop"] },
  { date: "2026-01-03" }, { date: "2026-01-03", providers: ["garmin"] },
  { from: "2026-01-02", to: "2026-01-04" },
  { date: "2026-01-03", from: "2026-01-01", to: "2026-01-05" },
  { from: "2026-01-03", to: "2026-01-03", providers: ["oura", "whoop"] },
  { from: "2026-01-04", to: "2026-01-01" }, { date: "2030-01-01" },
  { limit: 1 }, { limit: 0 }, { limit: -1 }, { limit: 1.5 },
] satisfies Partial<Parameters<typeof services.query.listWearableSleep>[0]>[];

async function assertEnvelopeParity(root: string, reference: string) {
  for (const filter of filters) {
    const input = { requestId: null, limit: 7, ...filter };
    const actual = await services.query.listWearableSleep({ vault: root, ...input });
    const expected = await services.query.listWearableSleep({ vault: reference, ...input });
    assert.deepEqual(fingerprint(actual), fingerprint(expected), JSON.stringify(filter));
  }
  // The service intentionally compacts provenance. Also compare the complete
  // public query envelope so units, confidence and provenance cannot regress.
  assert.deepEqual(fingerprint(await query.summarizeWearableSleepRuntime(root)),
    fingerprint(await query.summarizeWearableSleepRuntime(reference)));
}

test("sleep service equals an independently full-built oracle across scopes, context and ordered limits", async () => {
  const { root, reference } = await pair();
  const before = await readFile(path.join(root, "ledger/events/2026/2026-01.jsonl"), "utf8");
  await assertEnvelopeParity(root, reference);
  const input = { vault: root, requestId: null, limit: 7 };
  const all = await services.query.listWearableSleep(input);
  assert.equal(all.count, days);
  assert.deepEqual(all.items.map(item => item.date), [4, 3, 2, 1, 0].map(sleepDate));
  const total = all.items[0]?.totalSleepMinutes;
  assert.ok(total && typeof total === "object" && !Array.isArray(total));
  assert.equal(total.value, 455);
  assert.equal(total.unit, "minutes");
  assert.equal(total.provider, "oura");
  // Exact confidence, candidate details and provenance are covered by the
  // complete oracle comparison above, not reimplemented as fixture policy.
  const night = await services.query.listWearableSleep({ ...input, date: "2026-01-03", providers: ["oura"] });
  assert.equal(night.count, 1);
  const start = night.items[0]?.sleepStartAt;
  const end = night.items[0]?.sleepEndAt;
  assert.equal(typeof start, "string");
  assert.equal(typeof end, "string");
  assert.equal(Date.parse(String(start)), Date.parse("2026-01-02T23:00:00Z"));
  assert.equal(Date.parse(String(end)), Date.parse("2026-01-03T07:00:00Z"));
  assert.ok(night.items[0]?.deepMinutes && night.items[0]?.remMinutes && night.items[0]?.lightMinutes);
  const context = await services.query.listWearableSleep({ ...input, providers: ["oura"] });
  assert.deepEqual(night.items[0], context.items.find(item => item.date === "2026-01-03"));
  // Neighboring nights exist on both sides; the selected night retains its
  // previous-date start, complete stages and unchanged normal composition.
  assert.ok(context.items.some(item => item.date === "2026-01-02"));
  assert.ok(context.items.some(item => item.date === "2026-01-04"));
  for (const [provider, expected] of [["oura", 460], ["whoop", 445], ["garmin", 430]] as const) {
    const scoped = await services.query.listWearableSleep({ ...input, date: "2026-01-03", providers: [provider] });
    const metric = scoped.items[0]?.totalSleepMinutes;
    assert.ok(metric && typeof metric === "object" && !Array.isArray(metric));
    assert.equal(metric.provider, provider);
    assert.equal(metric.value, expected);
  }
  assert.equal((await services.query.listWearableSleep({ ...input, providers: [] })).count, days);
  assert.equal((await services.query.listWearableSleep({ ...input, providers: [" "] })).count, 0);
  assert.equal((await services.query.listWearableSleep({ ...input, providers: ["missing"] })).count, 0);
  assert.equal(await readFile(path.join(root, "ledger/events/2026/2026-01.jsonl"), "utf8"), before);
});

test("sleep keeps current-index reuse and exact global search/metric integrity after cold and corrected reads", async () => {
  const { root, reference } = await pair();
  const original = fingerprint(await readSleepProof(services, root, days));
  assert.deepEqual(fingerprint(await readGlobalProof(services, query, root, days)),
    fingerprint(await readGlobalProof(services, query, reference, days)));
  const fresh = await traceSleepRead(timing, "wearables sleep list", () => readSleepProof(services, root, days));
  assert.deepEqual(fingerprint(fresh.value), original);
  assert.equal(fresh.phases["query-rebuild"] ?? 0, 0);
  assert.equal((await query.getQueryProjectionStatus(root)).fresh, true);
  for (const deleted of [false, true]) {
    await reviseSleepFixture(core, root, days, deleted);
    await reviseSleepFixture(core, reference, days, deleted);
    await query.rebuildQueryProjection(reference);
    const changed = await readSleepProof(services, root, days, deleted ? undefined : 410);
    if (!deleted) assert.notEqual(fingerprint(changed).sha256, original.sha256);
    await assertEnvelopeParity(root, reference);
    assert.deepEqual(fingerprint(await readGlobalProof(services, query, root, days)),
      fingerprint(await readGlobalProof(services, query, reference, days)));
    assert.equal((await query.getQueryProjectionStatus(root)).fresh, true);
  }
});

test("sleep validates the complete canonical snapshot even when its provider scope is empty", async () => {
  const root = await fixture();
  await readSleepProof(services, root, days);
  const file = path.join(root, "ledger/events/2026/2026-01.jsonl");
  const original = await readFile(file, "utf8");
  const lineNumber = original.trim().split("\n").length + 1;
  await core.withCanonicalWriteLock(root, () => appendFile(file, "{SYNTHETIC_INVALID_SOURCE\n"));
  for (const providers of [undefined, [], ["oura"], ["whoop"], ["garmin"], [" OURA ", "oura", "whoop"], ["missing"], [" "]]) {
    await assert.rejects(services.query.listWearableSleep({ vault: root, requestId: null, limit: 7, providers }), error => {
      assert.ok(error instanceof core.VaultError);
      assert.equal(error.code, "VAULT_INVALID_JSONL");
      assert.equal(error.message, `Invalid JSON on line ${lineNumber}.`);
      assert.equal(error.details.relativePath, "ledger/events/2026/2026-01.jsonl");
      assert.equal(error.details.lineNumber, lineNumber);
      // Native parser cause is not pinned; the CLI proof checks public redaction.
      return true;
    });
  }
});

test("sleep composes under a reentrant writer and an outside reader sees the committed generation", async () => {
  const { root, reference } = await pair();
  await readSleepProof(services, root, days);
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const inside = new Promise<void>(resolve => { entered = resolve; });
  let intermediateHash: string | undefined;
  const writer = core.withCanonicalWriteLock(root, async () => {
    await reviseSleepFixture(core, root, days);
    intermediateHash = fingerprint(await readSleepProof(services, root, days)).sha256;
    // Invalidate that intermediate publication while still holding the writer.
    await reviseSleepFixture(core, root, days, true);
    entered();
    await gate;
  });
  try {
    await Promise.race([inside, writer.then(() => { throw new Error("Writer exited before barrier"); })]);
    let finished = false;
    const reader = readSleepProof(services, root, days).then(value => { finished = true; return value; });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(finished, false);
    release();
    const [, result] = await Promise.all([writer, reader]);
    await reviseSleepFixture(core, reference, days);
    await reviseSleepFixture(core, reference, days, true);
    await query.rebuildQueryProjection(reference);
    assert.notEqual(fingerprint(result).sha256, intermediateHash);
    assert.deepEqual(fingerprint(result), fingerprint(await readSleepProof(services, reference, days)));
  } finally {
    release();
    await writer;
  }
});
