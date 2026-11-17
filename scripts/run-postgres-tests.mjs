#!/usr/bin/env node
// @ts-check

import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseFlag = /\bMURPH_TEST_[A-Z_]*POSTGRES[A-Z_]*\b/u;

/** @param {string} root */
export async function discoverPostgresTests(root) {
  const directory = "apps/web/test";
  const entries = await readdir(path.join(root, directory), { recursive: true, withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.test\.(?:ts|tsx)$/u.test(entry.name)) continue;
    const absolute = path.join(entry.parentPath, entry.name);
    const source = await readFile(absolute, "utf8");
    // Consent and supplement search retain their separate required DB owners.
    // Source discovery also catches concurrency suites without postgres in the name.
    if (/\.db\.test\.(?:ts|tsx)$/u.test(entry.name) || databaseFlag.test(source)) {
      files.push(path.relative(root, absolute).split(path.sep).join("/"));
    }
  }
  if (files.length === 0) throw new Error("PostgreSQL discovery matched zero test files.");
  return files.sort();
}

/** @param {string[]} files @param {string[]} argv */
export function selectPostgresShard(files, argv) {
  if (argv.length !== 2 || argv[0] !== "--shard") {
    throw new Error("Usage: node scripts/run-postgres-tests.mjs --shard <index>/<count>");
  }
  const match = /^([1-9][0-9]*)\/([1-9][0-9]*)$/u.exec(argv[1]);
  if (!match) throw new Error("PostgreSQL shard must be <index>/<count>.");
  const index = Number(match[1]);
  const count = Number(match[2]);
  if (!Number.isSafeInteger(count) || index > count || count > files.length) {
    throw new Error("PostgreSQL shard must select at least one discovered file.");
  }
  return files.filter((_file, ordinal) => ordinal % count === index - 1);
}

/** @param {NodeJS.ProcessEnv} env */
export function postgresTestEnvironment(env) {
  let url;
  try {
    url = new URL(env.DATABASE_URL ?? "");
  } catch {
    throw new Error("PostgreSQL proof requires a loopback murph_test database URL.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !/^\/murph_test(?:_[a-z0-9_]+)?$/u.test(url.pathname)
    || url.search || url.hash) {
    throw new Error("PostgreSQL proof requires a loopback murph_test database URL without overrides.");
  }
  return {
    ...env,
    DATABASE_URL: url.toString(),
    MURPH_TEST_POSTGRES_CONCURRENCY: "1",
    MURPH_TEST_RUNTIME_LOG_POSTGRES: "1",
    MURPH_IMESSAGE_ENROLLMENT_TEST_DB_URL: url.toString(),
    MURPH_VITEST_FILE_PARALLELISM: "0",
    MURPH_VITEST_SUITE_CONCURRENCY: "0",
  };
}

/**
 * @typedef {{ file: string, state: string, tests: string[] }} DatabaseModuleReceipt
 * @param {string[]} expected
 * @param {{ modules: DatabaseModuleReceipt[], errors: number, reason: string } | undefined} receipt
 */
export function validatePostgresReceipt(expected, receipt) {
  if (!receipt || receipt.reason !== "passed" || receipt.errors !== 0) {
    throw new Error("PostgreSQL proof did not finish cleanly.");
  }
  const remaining = new Set(expected);
  if (remaining.size !== expected.length || remaining.size === 0) {
    throw new Error("PostgreSQL proof requires a nonempty unique inventory.");
  }
  let tests = 0;
  for (const module of receipt.modules) {
    if (!remaining.delete(module.file)) {
      throw new Error("PostgreSQL proof reported a duplicate or unexpected test file.");
    }
    if (module.state !== "passed" || module.tests.length === 0
      || module.tests.some((state) => state !== "passed")) {
      throw new Error(`PostgreSQL proof has failed, skipped, or empty cases: ${module.file}`);
    }
    tests += module.tests.length;
  }
  if (remaining.size > 0) {
    throw new Error(`PostgreSQL proof omitted test files: ${[...remaining].join(", ")}`);
  }
  return { files: expected.length, tests };
}

/** @param {string[]} files @param {string} root */
export async function executePostgresTests(files, root) {
  const { startVitest } = await import("vitest/node");
  /** @type {Parameters<typeof validatePostgresReceipt>[1]} */
  let receipt;
  const context = await startVitest("test", files, {
    root,
    config: path.join(root, "apps/web/vitest.config.ts"),
    run: true,
    watch: false,
    maxWorkers: 1,
    fileParallelism: false,
    maxConcurrency: 1,
    silent: "passed-only",
    coverage: { enabled: false },
    reporters: ["default", {
      onTestRunEnd(modules, errors, reason) {
        receipt = {
          errors: errors.length,
          reason,
          modules: modules.map((module) => ({
            file: path.relative(root, module.moduleId).split(path.sep).join("/"),
            state: module.state(),
            tests: [...module.children.allTests()].map((test) => test.result().state),
          })),
        };
      },
    }],
  });
  try {
    return validatePostgresReceipt(files, receipt);
  } finally {
    await context.close();
  }
}

/**
 * Splits `--workers <n>` from the shard arguments. Each worker gets its own
 * copy of the migrated database, so files stay serial within a database.
 * @param {string[]} argv
 */
export function parsePostgresWorkers(argv) {
  const index = argv.indexOf("--workers");
  if (index === -1) return { shardArgs: argv, workers: 1 };
  const workers = Number(argv[index + 1]);
  if (!Number.isSafeInteger(workers) || workers < 1 || workers > 8) {
    throw new Error("PostgreSQL workers must be an integer from 1 to 8.");
  }
  return { shardArgs: [...argv.slice(0, index), ...argv.slice(index + 2)], workers };
}

/** @param {string[]} files @param {number} workers */
export function splitPostgresWorkers(files, workers) {
  const groups = Array.from({ length: Math.min(workers, files.length) }, () => /** @type {string[]} */ ([]));
  files.forEach((file, ordinal) => groups[ordinal % groups.length].push(file));
  return groups;
}

/** @param {string} databaseUrl @param {number} worker */
export function workerDatabaseUrl(databaseUrl, worker) {
  const url = new URL(databaseUrl);
  url.pathname = `${url.pathname}_w${worker}`;
  return url.toString();
}

/**
 * Copies the migrated database once per worker. The name was validated by
 * postgresTestEnvironment, so it is a plain murph_test identifier.
 * @param {string} databaseUrl @param {number} workers
 */
async function cloneWorkerDatabases(databaseUrl, workers) {
  const { default: pg } = await import("pg");
  const source = new URL(databaseUrl).pathname.slice(1);
  const admin = new URL(databaseUrl);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    for (let worker = 1; worker <= workers; worker += 1) {
      const target = new URL(workerDatabaseUrl(databaseUrl, worker)).pathname.slice(1);
      await client.query(`DROP DATABASE IF EXISTS "${target}"`);
      await client.query(`CREATE DATABASE "${target}" TEMPLATE "${source}"`);
    }
  } finally {
    await client.end();
  }
}

/**
 * Runs one group of files serially in its own database, in a child process,
 * and prints its output in one block when it ends.
 * @param {string[]} files @param {string} databaseUrl @param {number} worker
 * @returns {Promise<{ files: number, tests: number }>}
 */
function runPostgresWorker(files, databaseUrl, worker) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--worker-files"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...postgresTestEnvironment({ ...process.env, DATABASE_URL: databaseUrl }),
        MURPH_POSTGRES_PROOF_FILES: JSON.stringify(files),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    /** @type {Buffer[]} */
    const output = [];
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => output.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      const text = Buffer.concat(output).toString("utf8");
      process.stdout.write(`::group::PostgreSQL worker ${worker} (${files.length} files)\n${text}::endgroup::\n`);
      const receipt = /^\[postgres-proof-worker\] (.+)$/mu.exec(text);
      if (code !== 0 || !receipt) {
        reject(new Error(`PostgreSQL worker ${worker} failed.`));
        return;
      }
      resolve(JSON.parse(receipt[1]));
    });
  });
}

/** @param {string[]} argv */
async function main(argv) {
  if (argv.length === 1 && argv[0] === "--worker-files") {
    Object.assign(process.env, postgresTestEnvironment(process.env));
    const files = JSON.parse(process.env.MURPH_POSTGRES_PROOF_FILES ?? "[]");
    const result = await executePostgresTests(files, repoRoot);
    console.log(`[postgres-proof-worker] ${JSON.stringify(result)}`);
    return;
  }
  const { shardArgs, workers } = parsePostgresWorkers(argv);
  Object.assign(process.env, postgresTestEnvironment(process.env));
  const files = selectPostgresShard(await discoverPostgresTests(repoRoot), shardArgs);
  let result;
  if (workers === 1) {
    result = await executePostgresTests(files, repoRoot);
  } else {
    const groups = splitPostgresWorkers(files, workers);
    const databaseUrl = /** @type {string} */ (process.env.DATABASE_URL);
    await cloneWorkerDatabases(databaseUrl, groups.length);
    const settled = await Promise.allSettled(groups.map((group, index) =>
      runPostgresWorker(group, workerDatabaseUrl(databaseUrl, index + 1), index + 1)));
    const failed = settled.filter((outcome) => outcome.status === "rejected");
    if (failed.length > 0) {
      throw new Error(`PostgreSQL proof failed in ${failed.length} of ${groups.length} workers.`);
    }
    result = settled.reduce((total, outcome) => {
      const value = /** @type {PromiseFulfilledResult<{ files: number, tests: number }>} */ (outcome).value;
      return { files: total.files + value.files, tests: total.tests + value.tests };
    }, { files: 0, tests: 0 });
    if (result.files !== files.length) {
      throw new Error("PostgreSQL workers did not cover the shard exactly once.");
    }
  }
  console.log(`[postgres-proof] ${JSON.stringify({ shard: shardArgs[1], workers, ...result })}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : "PostgreSQL proof failed.");
    process.exitCode = 1;
  });
}
