import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import {
  discoverPostgresTests,
  postgresTestEnvironment,
  selectPostgresShard,
  validatePostgresReceipt,
} from "./run-postgres-tests.mjs";

test("discovery includes alternate DB flags, nested files, and database-only files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "murph-db-discovery-"));
  try {
    const directory = path.join(root, "apps/web/test");
    await mkdir(path.join(directory, "nested"), { recursive: true });
    const sources = {
      "ordinary.test.ts": "test('unit', () => {});",
      "consent-postgres.test.ts": "process.env.MURPH_CONSENT_TEST_DB_URL;",
      "race.test.ts": "process.env.MURPH_TEST_POSTGRES_CONCURRENCY;",
      "new-owner.db.test.ts": "test('database', () => {});",
      "nested/logs.test.ts": "process.env.MURPH_TEST_RUNTIME_LOG_POSTGRES;",
      "support.ts": "process.env.MURPH_TEST_POSTGRES_CONCURRENCY;",
    };
    await Promise.all(Object.entries(sources).map(([file, source]) =>
      writeFile(path.join(directory, file), source)));
    assert.deepEqual(await discoverPostgresTests(root), [
      "apps/web/test/nested/logs.test.ts",
      "apps/web/test/new-owner.db.test.ts",
      "apps/web/test/race.test.ts",
    ]);
    await Promise.all(Object.keys(sources).map((file) => rm(path.join(directory, file))));
    await assert.rejects(discoverPostgresTests(root), /zero test files/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("four shards partition the discovered inventory exactly once", () => {
  const files = Array.from({ length: 87 }, (_, index) => `file-${index}`);
  const shards = Array.from({ length: 4 }, (_, index) =>
    selectPostgresShard(files, ["--shard", `${index + 1}/4`]));
  assert.deepEqual(shards.map((shard) => shard.length), [22, 22, 22, 21]);
  assert.deepEqual(shards.flat().sort(), files.toSorted());
  for (const args of [[], ["--shard", "0/4"], ["--shard", "5/4"],
    ["--shard", "1/88"], ["--shard", "1/4", "stale.test.ts"],
    ["--shard", "1/4", "--testNamePattern", "one"]]) {
    assert.throws(() => selectPostgresShard(files, args));
  }
});

test("the lane enables every existing opt-in owner only for a local test database", () => {
  const env = postgresTestEnvironment({
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/murph_test_gate",
    MURPH_TEST_POSTGRES_CONCURRENCY: "0",
    MURPH_VITEST_SUITE_CONCURRENCY: "1",
  });
  assert.equal(env.MURPH_TEST_POSTGRES_CONCURRENCY, "1");
  assert.equal(env.MURPH_TEST_RUNTIME_LOG_POSTGRES, "1");
  assert.equal(env.MURPH_IMESSAGE_ENROLLMENT_TEST_DB_URL, env.DATABASE_URL);
  assert.equal(env.MURPH_VITEST_FILE_PARALLELISM, "0");
  assert.equal(env.MURPH_VITEST_SUITE_CONCURRENCY, "0");
  for (const DATABASE_URL of [undefined, "invalid", "https://localhost/murph_test",
    "postgresql://db.example.test/murph_test", "postgresql://localhost/production",
    "postgresql://localhost/murph_test?host=db.example.test",
    "postgresql://localhost/murph_test#override"]) {
    assert.throws(() => postgresTestEnvironment({ DATABASE_URL }), /loopback murph_test/u);
  }
});

const file = "apps/web/test/owner-postgres.test.ts";
const passed = { file, state: "passed", tests: ["passed", "passed"] };

test("receipts count successful cases without recording paths outside the repo or test data", () => {
  assert.deepEqual(validatePostgresReceipt([file], {
    modules: [passed], errors: 0, reason: "passed",
  }), { files: 1, tests: 2 });
});

test("missing, duplicate, unexpected, empty, skipped, pending and failed cases reject the gate", () => {
  const invalidModules = [
    [], [passed, passed], [{ ...passed, file: "unexpected.test.ts" }],
    [{ ...passed, tests: [] }],
    ...["skipped", "pending", "failed"].map((state) => [{ ...passed, tests: [state] }]),
    [{ ...passed, state: "failed" }],
  ];
  for (const modules of invalidModules) {
    assert.throws(() => validatePostgresReceipt([file], {
      modules, errors: 0, reason: "passed",
    }));
  }
  for (const receipt of [undefined,
    { modules: [passed], errors: 1, reason: "passed" },
    { modules: [passed], errors: 0, reason: "interrupted" },
    { modules: [passed], errors: 0, reason: "failed" }]) {
    assert.throws(() => validatePostgresReceipt([file], receipt));
  }
  assert.throws(() => validatePostgresReceipt([], { modules: [], errors: 0, reason: "passed" }));
});

test("the actual Vitest reporter rejects successful runs that skip or omit requested files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "murph-db-receipt-"));
  const run = promisify(execFile);
  const entry = new URL("./run-postgres-tests.mjs", import.meta.url).href;
  const selected = "apps/web/test/receipt.db.test.ts";
  const program = [
    "const {executePostgresTests}=await import(process.argv[1]);",
    "try { await executePostgresTests(JSON.parse(process.argv[3]), process.argv[2]); }",
    "catch { process.exitCode = 1; }",
  ].join("\n");
  /** @param {string[]} files */
  const invoke = (files) => run(process.execPath,
    ["--input-type=module", "-e", program, entry, root, JSON.stringify(files)],
    { timeout: 30_000 });
  try {
    await mkdir(path.join(root, "apps/web/test"), { recursive: true });
    await writeFile(path.join(root, "apps/web/vitest.config.ts"),
      "export default { test: { globals: true, include: ['apps/web/test/*.test.ts'] } };\n");
    await writeFile(path.join(root, selected), "test('executes', () => {});\n");
    await invoke([selected]);
    await assert.rejects(invoke([selected, "apps/web/test/removed.db.test.ts"]), { code: 1 });
    await writeFile(path.join(root, selected), "test.skip('does not execute', () => {});\n");
    await assert.rejects(invoke([selected]), { code: 1 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
