import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const bundle = path.resolve(process.env.MURPH_DEVICE_PASS_BUNDLE ?? ".artifacts/device-pass-bench.mjs");

function run(extra) {
  const result = spawnSync(process.execPath, [bundle], {
    encoding: "utf8",
    env: {
      ...process.env,
      MURPH_DEVICE_PASS_HISTORY_ROWS: process.env.MURPH_DEVICE_PASS_HISTORY_ROWS ?? "105000",
      MURPH_DEVICE_PASS_JOB_ROWS: process.env.MURPH_DEVICE_PASS_JOB_ROWS ?? "8",
      ...extra,
    },
    maxBuffer: 1024 * 1024,
    timeout: 180_000,
  });
  assert.equal(result.status, 0, result.stderr.slice(0, 2000));
  return JSON.parse(result.stdout.trim());
}

test("one durable job sequence has byte-identical canonical vault and receipts with scoped identity reuse", { timeout: 400_000 }, async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "device-pass-differential-"));
  try {
    run({ MURPH_DEVICE_PASS_SAVE_FIXTURE: fixture });
    const legacy = run({ MURPH_DEVICE_PASS_FIXTURE: fixture, MURPH_DEVICE_PASS_NO_SCOPE: "1" });
    const scoped = run({ MURPH_DEVICE_PASS_FIXTURE: fixture });
    assert.equal(legacy.manifestSha256, scoped.manifestSha256);
    if (legacy.historyRows > 100_000) {
      assert.equal(legacy.summary.applied.cacheHits, 0);
      assert.equal(legacy.summary.noop.cacheHits, 0);
    }
    assert.ok(scoped.summary.applied.cacheHits > 0);
    assert.ok(scoped.summary.noop.cacheHits > 0);
    console.log(JSON.stringify({
      historyRows: legacy.historyRows,
      jobRows: legacy.jobRows,
      canonicalAndReceiptManifestSha256: scoped.manifestSha256,
      before: legacy.summary,
      after: scoped.summary,
    }));
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
