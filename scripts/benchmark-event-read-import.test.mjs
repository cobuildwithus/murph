import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertOutputParity, coldPairs, distribution, importWorkRemoved, narrowImports,
} from "./benchmark-event-read-import.mjs";

const root = "@murphai/core/dist/index.js";
const reader = "@murphai/core/dist/event-read.js";
const inventory = (names, modules = 20, fileBytes = 2_000) => ({
  core: names.map((module) => ({ module })), modules, fileBytes, outsideBundle: 0,
});
const output = () => ({ status: 0, stdout: Buffer.from('{"synthetic":true}\n'),
  stderr: Buffer.alloc(0), wallMs: 10, childWallMs: 9, cpuMs: 8 });

test("import acceptance requires real whole-process work removal and the native semantic entry", () => {
  const base = inventory([root], 40, 4_000);
  const candidate = inventory([reader]);
  assert.equal(importWorkRemoved(base, candidate), true);
  for (const rejected of [inventory([reader, root]), inventory([]),
    inventory([reader, "@murphai/core/dist/automation.js"]),
    { ...candidate, outsideBundle: 1 }]) {
    assert.equal(narrowImports(rejected), false);
    assert.equal(importWorkRemoved(base, rejected), false);
  }
  assert.equal(importWorkRemoved(candidate, candidate), false);
  assert.equal(importWorkRemoved(base, { ...candidate, modules: 40 }), false);
  assert.equal(importWorkRemoved(base, { ...candidate, fileBytes: 4_000 }), false);
});

test("parity compares every stdout/stderr byte and exit status without normalization", () => {
  const expected = output();
  assert.doesNotThrow(() => assertOutputParity(output(), expected));
  for (const changed of [{ status: 1 }, { stdout: Buffer.from('{ "synthetic": true }\n') },
    { stderr: Buffer.from("unexpected\n") }]) {
    assert.throws(() => assertOutputParity({ ...output(), ...changed }, expected), /parity-failed/u);
  }
});

test("pairs are sequential, alternate order, discard only two warmup pairs, and retain all measured samples", async () => {
  const order = []; let active = 0;
  const result = await coldPairs(async (label) => {
    assert.equal(active++, 0);
    order.push(label);
    await Promise.resolve();
    active--;
    return { ...output(), wallMs: label === "base" ? 10 : 8 };
  }, 10);
  assert.equal(order.length, 24);
  for (let i = 0; i < 12; i++) {
    assert.deepEqual(order.slice(i * 2, i * 2 + 2), i % 2 ? ["candidate", "base"] : ["base", "candidate"]);
  }
  assert.equal(result.samples.length, 10);
  assert.deepEqual(result.summary.wallMs.candidateMinusBase, { min: -2, median: -2, max: -2 });
  assert.equal(result.summary.wallMs.candidateOverBase.median, 0.8);
  await assert.rejects(coldPairs(async (label) => ({ ...output(), status: label === "base" ? 0 : 1 })), /parity-failed/u);
  await assert.rejects(coldPairs(async () => output(), 3), /invalid-pair-count/u);
  assert.deepEqual(distribution([1, 9, 3, 5]), { min: 1, median: 4, max: 9 });
});
