import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { test } from "vitest";

import {
  ensureJournalDay,
  initializeVault,
  validateVault,
  VaultError,
} from "../../core/src/index.js";
import {
  acquireCanonicalWriteLock,
  CANONICAL_WRITE_LOCK_DIRECTORY,
  CANONICAL_WRITE_LOCK_METADATA_PATH,
} from "../../core/src/operations/index.js";
import { repoRoot } from "./cli-test-helpers.js";

async function makeVaultRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "healthybob-lock-test-"));
}

async function holdCanonicalWriteLock(vaultRoot: string) {
  const coreModuleUrl = pathToFileURL(path.join(repoRoot, "packages/core/dist/index.js")).href;
  const script = `
    const { acquireCanonicalWriteLock } = await import(${JSON.stringify(coreModuleUrl)});
    const lock = await acquireCanonicalWriteLock(process.argv[1]);
    process.stdout.write("ready\\n");
    process.stdin.on("end", async () => {
      await lock.release();
      process.exit(0);
    });
    process.stdin.resume();
  `;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script, vaultRoot], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const stderr: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => {
    stderr.push(chunk);
  });

  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.stdout.on("data", (chunk: Buffer) => {
      if (chunk.toString("utf8").includes("ready")) {
        resolve();
      }
    });
    child.once("exit", (code) => {
      reject(new Error(`lock holder exited early with code ${code}: ${Buffer.concat(stderr).toString("utf8")}`));
    });
  });

  return {
    child,
    async release() {
      child.stdin.end();
      const [code] = (await once(child, "exit")) as [number | null];
      assert.equal(code, 0);
    },
  };
}

test.sequential("acquireCanonicalWriteLock writes diagnostics and cleans up on release", async () => {
  const vaultRoot = await makeVaultRoot();

  try {
    await initializeVault({ vaultRoot });

    const lock = await acquireCanonicalWriteLock(vaultRoot);
    const metadata = JSON.parse(await readFile(path.join(vaultRoot, CANONICAL_WRITE_LOCK_METADATA_PATH), "utf8")) as {
      pid: number;
      command: string;
      startedAt: string;
      host: string;
    };

    assert.equal(metadata.pid, process.pid);
    assert.equal(typeof metadata.command, "string");
    assert.equal(metadata.command.length > 0, true);
    assert.equal(typeof metadata.startedAt, "string");
    assert.equal(typeof metadata.host, "string");

    await lock.release();

    await assert.rejects(() => readFile(path.join(vaultRoot, CANONICAL_WRITE_LOCK_METADATA_PATH), "utf8"));
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test.sequential("validateVault reports stale canonical write locks", async () => {
  const vaultRoot = await makeVaultRoot();

  try {
    await initializeVault({ vaultRoot });

    const liveLock = await acquireCanonicalWriteLock(vaultRoot);
    const liveMetadata = JSON.parse(
      await readFile(path.join(vaultRoot, CANONICAL_WRITE_LOCK_METADATA_PATH), "utf8"),
    ) as {
      host: string;
    };
    await liveLock.release();

    await mkdir(path.join(vaultRoot, CANONICAL_WRITE_LOCK_DIRECTORY), { recursive: true });
    await writeFile(
      path.join(vaultRoot, CANONICAL_WRITE_LOCK_METADATA_PATH),
      `${JSON.stringify(
        {
          pid: 999_999,
          command: "test-lock-holder",
          startedAt: "2026-03-13T00:00:00.000Z",
          host: liveMetadata.host,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const validation = await validateVault({ vaultRoot });
    assert.equal(validation.valid, false);
    assert.equal(
      validation.issues.some((issue) => issue.code === "HB_CANONICAL_WRITE_LOCK_STALE" && issue.path === CANONICAL_WRITE_LOCK_DIRECTORY),
      true,
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test.sequential("public core mutators reject concurrent writers while another process holds the lock", async () => {
  const vaultRoot = await makeVaultRoot();

  try {
    await initializeVault({ vaultRoot });
    const heldLock = await holdCanonicalWriteLock(vaultRoot);

    try {
      await assert.rejects(
        () =>
          ensureJournalDay({
            vaultRoot,
            date: "2026-03-13",
          }),
        (error: unknown) => error instanceof VaultError && error.code === "HB_CANONICAL_WRITE_LOCKED",
      );
    } finally {
      await heldLock.release();
    }
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
