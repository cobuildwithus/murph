import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, test } from "vitest";

import { createWorkspaceSourceImportExecOptions } from "../../../config/workspace-source-resolution.js";
import { initializeVault } from "../src/index.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceSourceImportExecOptions = createWorkspaceSourceImportExecOptions(packageDir, process.env);
const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((targetPath) => rm(targetPath, { force: true, recursive: true })),
  );
});

test("acquireCanonicalWriteLock waits across processes instead of failing immediately", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "murph-core-canonical-write-lock-"));
  cleanupPaths.push(parent);
  const vaultRoot = path.join(parent, "vault");
  await mkdir(vaultRoot, { recursive: true });

  const holderScript = await writeTsxScript(parent, "holder", `
    import { mkdir } from "node:fs/promises";
    import { acquireCanonicalWriteLock } from ${JSON.stringify(
      path.join(repoRoot, "packages/core/src/operations/canonical-write-lock.ts"),
    )};

    const vaultRoot = process.argv[2];
    if (!vaultRoot) {
      throw new Error("vaultRoot is required");
    }

    await mkdir(vaultRoot, { recursive: true });
    const lock = await acquireCanonicalWriteLock(vaultRoot);
    process.stdout.write("locked\\\\n");
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await lock.release();
  `);

  const waiterScript = await writeTsxScript(parent, "waiter", `
    import { acquireCanonicalWriteLock } from ${JSON.stringify(
      path.join(repoRoot, "packages/core/src/operations/canonical-write-lock.ts"),
    )};

    const vaultRoot = process.argv[2];
    if (!vaultRoot) {
      throw new Error("vaultRoot is required");
    }

    const startedAt = Date.now();
    const lock = await acquireCanonicalWriteLock(vaultRoot);
    const waitedMs = Date.now() - startedAt;
    await lock.release();
    process.stdout.write(JSON.stringify({ waitedMs }));
  `);

  const holder = spawnTsxProcess(holderScript, [vaultRoot]);
  const holderExitPromise = waitForChild(holder);
  await waitForStdoutLine(holder, "locked");
  const waiter = await runTsxProcess(waiterScript, [vaultRoot]);
  const holderExit = await holderExitPromise;

  assert.equal(holderExit.code, 0);
  assert.equal(waiter.code, 0);
  assert.doesNotMatch(waiter.stderr, /CANONICAL_WRITE_LOCKED/u);

  const payload = JSON.parse(waiter.stdout.trim()) as { waitedMs: number };
  assert.equal(payload.waitedMs >= 250, true);
});

test("parallel meal and workout writes complete without a canonical write lock failure", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "murph-core-meal-workout-parallel-"));
  cleanupPaths.push(parent);
  const vaultRoot = path.join(parent, "vault");
  await initializeVault({ vaultRoot });

  const mealScript = await writeTsxScript(parent, "meal", `
    import { addMeal } from ${JSON.stringify(path.join(repoRoot, "packages/core/src/index.ts"))};

    const vaultRoot = process.argv[2];
    if (!vaultRoot) {
      throw new Error("vaultRoot is required");
    }

    const result = await addMeal({
      vaultRoot,
      occurredAt: "2026-04-15T12:00:00.000Z",
      note: "parallel meal",
    });
    process.stdout.write(JSON.stringify({ mealId: result.mealId }));
  `);

  const workoutScript = await writeTsxScript(parent, "workout", `
    import { addActivitySession } from ${JSON.stringify(path.join(repoRoot, "packages/core/src/index.ts"))};

    const vaultRoot = process.argv[2];
    if (!vaultRoot) {
      throw new Error("vaultRoot is required");
    }

    const result = await addActivitySession({
      vaultRoot,
      draft: {
        occurredAt: "2026-04-15T12:05:00.000Z",
        title: "parallel workout",
        activityType: "strength-training",
        durationMinutes: 45,
        workout: {
          exercises: [],
        },
      },
    });
    process.stdout.write(JSON.stringify({ eventId: result.eventId }));
  `);

  const [meal, workout] = await Promise.all([
    runTsxProcess(mealScript, [vaultRoot]),
    runTsxProcess(workoutScript, [vaultRoot]),
  ]);

  assert.equal(meal.code, 0);
  assert.equal(workout.code, 0);
  assert.doesNotMatch(meal.stderr, /CANONICAL_WRITE_LOCKED/u);
  assert.doesNotMatch(workout.stderr, /CANONICAL_WRITE_LOCKED/u);
  assert.match((JSON.parse(meal.stdout) as { mealId: string }).mealId, /^meal_/u);
  assert.match((JSON.parse(workout.stdout) as { eventId: string }).eventId, /^evt_/u);
});

async function writeTsxScript(parent: string, name: string, source: string): Promise<string> {
  const filePath = path.join(parent, `${name}.mts`);
  await writeFile(filePath, `${source.trim()}\n`, "utf8");
  return filePath;
}

function spawnTsxProcess(scriptPath: string, args: string[]) {
  return spawn(process.execPath, ["--import", "tsx/esm", scriptPath, ...args], {
    cwd: workspaceSourceImportExecOptions.cwd,
    env: {
      ...process.env,
      ...workspaceSourceImportExecOptions.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function runTsxProcess(
  scriptPath: string,
  args: string[],
): Promise<{
  code: number | null;
  stderr: string;
  stdout: string;
}> {
  const child = spawnTsxProcess(scriptPath, args);
  return await waitForChild(child);
}

async function waitForStdoutLine(
  child: ReturnType<typeof spawnTsxProcess>,
  expected: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    child.once("error", reject);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.includes(expected)) {
        resolve();
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("close", (code) => {
      if (!stdout.includes(expected)) {
        const stderrMessage = stderr.trim();
        const stdoutMessage = stdout.trim();
        reject(
          new Error(
            [
              `Process exited before emitting expected stdout line: ${expected}`,
              `code=${String(code)}`,
              stdoutMessage.length > 0 ? `stdout=${stdoutMessage}` : null,
              stderrMessage.length > 0 ? `stderr=${stderrMessage}` : null,
            ]
              .filter((value): value is string => value !== null)
              .join("\n"),
          ),
        );
      }
    });
  });
}

async function waitForChild(
  child: ReturnType<typeof spawnTsxProcess>,
): Promise<{
  code: number | null;
  stderr: string;
  stdout: string;
}> {
  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    child.once("error", reject);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("close", (code) => {
      resolve({
        code,
        stderr: stderr.trim(),
        stdout: stdout.trim(),
      });
    });
  });
}
