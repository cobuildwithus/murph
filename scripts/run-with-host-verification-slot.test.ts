import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const wrapperPath = path.join(repoRoot, "scripts", "run-with-host-verification-slot.mjs");
const tempRoots: string[] = [];
const children = new Set<ChildProcess>();
const ownedDescendantPids = new Set<number>();
const holderSource = `
  process.stdout.write("ready\\n");
  process.stdin.resume();
`;
// A TERM-ignoring parent with a TERM-ignoring grandchild: the wedged-compile
// topology the command deadline must terminate as one process group.
const wedgedTreeSource = `
  import { spawn } from "node:child_process";
  process.on("SIGTERM", () => {});
  const grandchild = spawn(process.execPath, [
    "-e",
    "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
  ], { stdio: "ignore" });
  process.stdout.write("pids " + process.pid + " " + grandchild.pid + "\\n");
  setInterval(() => {}, 1000);
`;
// A leader that exits on the deadline's TERM while its grandchild ignores it:
// the descendant-outlives-leader topology that motivated supervisor-owned
// group reaping.
const exitingLeaderTreeSource = `
  import { spawn } from "node:child_process";
  const grandchild = spawn(process.execPath, [
    "-e",
    "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
  ], { stdio: "ignore" });
  process.stdout.write("pids " + process.pid + " " + grandchild.pid + "\\n");
  setInterval(() => {}, 1000);
`;

afterEach(async () => {
  for (const child of children) {
    child.stdin?.end();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
  }
  children.clear();
  for (const pid of ownedDescendantPids) {
    if (isProcessRunning(pid)) {
      process.kill(pid, "SIGTERM");
    }
  }
  ownedDescendantPids.clear();
  for (const tempRoot of tempRoots.splice(0)) {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

describe("shared-host verification slots", () => {
  it("bypasses slot state when disabled or already held", () => {
    const stateRoot = makeTempRoot();
    const command = [process.execPath, "--input-type=module", "-e", "process.stdout.write('ran')"];

    const disabled = runSync("disabled", command, stateRoot, {
      CODEX_THREAD_ID: "test-thread",
      MURPH_VERIFY_SHARED_HOST: "0",
    });
    expect(disabled.status, disabled.stderr).toBe(0);
    expect(disabled.stdout).toBe("ran");
    expect(readdirSync(stateRoot)).toEqual([]);

    const reentrant = runSync("reentrant", command, stateRoot, {
      MURPH_VERIFY_SHARED_HOST: "1",
      MURPH_VERIFY_HOST_SLOT_HELD: "1",
    });
    expect(reentrant.status, reentrant.stderr).toBe(0);
    expect(reentrant.stdout).toBe("ran");
    expect(readdirSync(stateRoot)).toEqual([]);

    const invalidMode = runSync("invalid", command, stateRoot, {
      MURPH_VERIFY_SHARED_HOST: "true",
    });
    expect(invalidMode.status).toBe(1);
    expect(invalidMode.stderr).toContain(
      "MURPH_VERIFY_SHARED_HOST must be 0 or 1",
    );
  });

  it("automatically admits Codex commands and propagates the normalized mode", () => {
    const stateRoot = makeTempRoot();
    const source = `
      const { existsSync } = require("node:fs");
      const { join } = require("node:path");
      process.stdout.write(
        process.env.MURPH_VERIFY_SHARED_HOST + ":" +
        existsSync(join(${JSON.stringify(stateRoot)}, "slot-1")),
      );
    `;
    const result = runSync(
      "automatic Codex admission",
      [process.execPath, "-e", source],
      stateRoot,
      { CODEX_THREAD_ID: "test-thread" },
      false,
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("1:true");

    const ciResult = runSync(
      "Codex CI bypass",
      [process.execPath, "-e", source],
      stateRoot,
      { CI: "1", CODEX_THREAD_ID: "test-thread" },
      false,
    );
    expect(ciResult.status, ciResult.stderr).toBe(0);
    expect(ciResult.stdout).toBe("0:false");
  });

  it("waits without a deadline for the exclusive slot", async () => {
    const stateRoot = makeTempRoot();
    const first = startHolder("first", stateRoot);
    await waitForLine(first, "ready");

    const second = startCommand(
      "second",
      stateRoot,
      "process.stdout.write('started\\n')",
      { MURPH_VERIFY_SHARED_HOST_TIMEOUT_MS: "40" },
    );
    await waitForStderrLine(second, "Waiting continues until the slot is available");
    await expectNoLine(second, "started", 120);
    expect(second.exitCode).toBeNull();

    first.stdin?.end();
    await waitForExit(first);
    await waitForLine(second, "started");
    expect(await waitForExit(second)).toBe(0);
  });

  it("reclaims a slot whose recorded owner has exited", () => {
    const stateRoot = makeTempRoot();
    const slotPath = path.join(stateRoot, "slot-1");
    mkdirSync(slotPath, { recursive: true });
    const exited = spawnSync(process.execPath, ["-e", ""], { encoding: "utf8" });
    expect(exited.status).toBe(0);
    writeFileSync(
      path.join(slotPath, "owner.json"),
      `${JSON.stringify({
        childPid: null,
        claimId: "stale-claim",
        label: "stale owner",
        pid: exited.pid,
        startedAt: new Date(0).toISOString(),
      })}\n`,
    );

    const result = runSync(
      "stale recovery",
      [process.execPath, "-e", "process.stdout.write('recovered')"],
      stateRoot,
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("recovered");
    expect(readdirSync(stateRoot)).toEqual([]);
  });

  it("does not expose absolute working paths in owner metadata", async () => {
    const stateRoot = makeTempRoot();
    const holder = startHolder(repoRoot, stateRoot);
    await waitForLine(holder, "ready");

    const ownerText = readFileSync(path.join(stateRoot, "slot-1", "owner.json"), "utf8");
    expect(ownerText).not.toContain(repoRoot);
    expect(ownerText).not.toContain(os.homedir());

    holder.stdin?.end();
    await waitForExit(holder);
  });

  it("exits promptly when signaled while waiting without disturbing the live owner", async () => {
    const stateRoot = makeTempRoot();
    const holder = startHolder("holder", stateRoot);
    await waitForLine(holder, "ready");

    const waiter = startCommand(
      "waiter",
      stateRoot,
      "process.stdout.write('unexpected-start\\n')",
    );
    await waitForStderrLine(waiter, "waiting for the exclusive shared-host slot");

    expect(waiter.kill("SIGTERM")).toBe(true);
    expect(await waitForExit(waiter)).toBe(143);
    expect(readFileSync(path.join(stateRoot, "slot-1", "owner.json"), "utf8")).toContain(
      '"label":"holder"',
    );

    holder.stdin?.end();
    await waitForExit(holder);
  });

  it("forwards termination only to its active child process group and releases the slot", async () => {
    const stateRoot = makeTempRoot();
    const markerPath = path.join(stateRoot, "active-processes.json");
    const sentinel = startRawCommand(holderSource);
    await waitForLine(sentinel, "ready");

    const active = startCommand(
      "active command",
      stateRoot,
      `
        const { spawn } = await import("node:child_process");
        const { writeFileSync } = await import("node:fs");
        const descendant = spawn(
          process.execPath,
          ["-e", "setInterval(() => {}, 1000)"],
          { stdio: "ignore" },
        );
        writeFileSync(
          ${JSON.stringify(markerPath)},
          JSON.stringify({ directPid: process.pid, descendantPid: descendant.pid }),
        );
        process.stdout.write("active-ready\\n");
        setInterval(() => {}, 1000);
      `,
    );
    await waitForLine(active, "active-ready");

    const ownedProcesses = JSON.parse(readFileSync(markerPath, "utf8")) as {
      directPid: number;
      descendantPid: number;
    };
    ownedDescendantPids.add(ownedProcesses.directPid);
    ownedDescendantPids.add(ownedProcesses.descendantPid);

    expect(active.kill("SIGTERM")).toBe(true);
    expect(await waitForExit(active)).toBe(143);
    await waitForOwnedProcessExit(ownedProcesses.directPid);
    await waitForOwnedProcessExit(ownedProcesses.descendantPid);

    expect(isProcessRunning(sentinel.pid)).toBe(true);
    expect(sentinel.exitCode).toBeNull();
    expect(readdirSync(stateRoot)).not.toContain("slot-1");

    const reacquired = runSync(
      "reacquired",
      [process.execPath, "-e", "process.stdout.write('reacquired')"],
      stateRoot,
    );
    expect(reacquired.status, reacquired.stderr).toBe(0);
    expect(reacquired.stdout).toBe("reacquired");

    sentinel.stdin?.end();
    await waitForExit(sentinel);
  });

  it("rejects a test state root outside the OS temp directory", () => {
    const result = runSync(
      "unsafe test root",
      [process.execPath, "-e", "process.stdout.write('unexpected')"],
      repoRoot,
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "MURPH_VERIFY_SHARED_HOST_TEST_STATE_ROOT must resolve to a directory beneath the OS temp directory",
    );
  });

  it("rejects a symlinked state root without changing its target", () => {
    const testRoot = makeTempRoot();
    const targetRoot = path.join(testRoot, "target");
    const linkedStateRoot = path.join(testRoot, "linked-state");
    const markerPath = path.join(targetRoot, "marker.txt");
    mkdirSync(targetRoot);
    chmodSync(targetRoot, 0o775);
    writeFileSync(markerPath, "preserve");
    symlinkSync(targetRoot, linkedStateRoot, "dir");

    const result = runSync(
      "symlinked state root",
      [process.execPath, "-e", "process.stdout.write('unexpected')"],
      linkedStateRoot,
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(readFileSync(markerPath, "utf8")).toBe("preserve");
    expect(statSync(targetRoot).mode & 0o777).toBe(0o775);
    expect(readdirSync(targetRoot)).toEqual(["marker.txt"]);
  });

  it("preserves a child failure code and releases its slot", () => {
    const stateRoot = makeTempRoot();
    const result = runSync(
      "failing child",
      [process.execPath, "-e", "process.exit(7)"],
      stateRoot,
    );

    expect(result.status).toBe(7);
    expect(readdirSync(stateRoot)).toEqual([]);
  });

  it("a configured command deadline reaps the whole process group", async () => {
    const stateRoot = makeTempRoot();
    const child = startCommand("deadline command", stateRoot, wedgedTreeSource, {
      MURPH_VERIFY_HOST_COMMAND_KILL_GRACE_MS: "300",
      MURPH_VERIFY_HOST_COMMAND_TIMEOUT_MS: "300",
    });

    const [parentPid, grandchildPid] = await waitForPids(child);
    ownedDescendantPids.add(parentPid);
    ownedDescendantPids.add(grandchildPid);

    await waitForStderrLine(child, "terminating its process group");
    const status = await waitForExit(child);
    expect(status).toBe(124);
    await waitForOwnedProcessExit(parentPid);
    await waitForOwnedProcessExit(grandchildPid);
    expect(readdirSync(stateRoot)).toEqual([]);
  });

  it("a deadline whose group leader exits on TERM still reaps a surviving descendant", async () => {
    const stateRoot = makeTempRoot();
    const child = startCommand("exiting leader", stateRoot, exitingLeaderTreeSource, {
      MURPH_VERIFY_HOST_COMMAND_KILL_GRACE_MS: "300",
      MURPH_VERIFY_HOST_COMMAND_TIMEOUT_MS: "300",
    });

    const [parentPid, grandchildPid] = await waitForPids(child);
    ownedDescendantPids.add(parentPid);
    ownedDescendantPids.add(grandchildPid);

    const status = await waitForExit(child);
    expect(status).toBe(124);
    await waitForOwnedProcessExit(parentPid);
    await waitForOwnedProcessExit(grandchildPid);
    expect(readdirSync(stateRoot)).toEqual([]);
  });

  it("a cancellation during post-leader reaping keeps ownership until the descendant is dead", async () => {
    const stateRoot = makeTempRoot();
    const child = startCommand("cancelled during reap", stateRoot, exitingLeaderTreeSource, {
      MURPH_VERIFY_HOST_COMMAND_KILL_GRACE_MS: "600",
      MURPH_VERIFY_HOST_COMMAND_TIMEOUT_MS: "300",
    });

    const [parentPid, grandchildPid] = await waitForPids(child);
    ownedDescendantPids.add(parentPid);
    ownedDescendantPids.add(grandchildPid);

    // Wait for the deadline to fell the leader while the TERM-ignoring
    // grandchild survives into the reaping grace, then cancel externally.
    const reapWindowDeadline = Date.now() + 2_000;
    while (isProcessRunning(parentPid) || !isProcessRunning(grandchildPid)) {
      if (Date.now() > reapWindowDeadline) {
        throw new Error("Never reached the post-leader reaping window");
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    child.kill("SIGTERM");

    const status = await waitForExit(child);
    expect(status).toBe(143);
    // Ownership must have been held until the whole group was gone: the
    // grandchild is already dead by the time the supervisor returns.
    expect(isProcessRunning(grandchildPid)).toBe(false);
    ownedDescendantPids.delete(grandchildPid);
    await waitForOwnedProcessExit(parentPid);
    expect(readdirSync(stateRoot)).toEqual([]);
  });

  it("external cancellation with a configured deadline escalates to KILL and reaps the group", async () => {
    const stateRoot = makeTempRoot();
    const child = startCommand("cancelled command", stateRoot, wedgedTreeSource, {
      MURPH_VERIFY_HOST_COMMAND_KILL_GRACE_MS: "300",
      MURPH_VERIFY_HOST_COMMAND_TIMEOUT_MS: "600000",
    });

    const [parentPid, grandchildPid] = await waitForPids(child);
    ownedDescendantPids.add(parentPid);
    ownedDescendantPids.add(grandchildPid);

    child.kill("SIGTERM");
    const status = await waitForExit(child);
    expect(status).toBe(143);
    await waitForOwnedProcessExit(parentPid);
    await waitForOwnedProcessExit(grandchildPid);
    expect(readdirSync(stateRoot)).toEqual([]);
  });
});

function makeTempRoot(): string {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "murph-host-slot-test-"));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function slotEnv(
  stateRoot: string,
  overrides: NodeJS.ProcessEnv = {},
  explicitMode = true,
): NodeJS.ProcessEnv {
  const {
    CI: _ci,
    CODEX_THREAD_ID: _codexThreadId,
    MURPH_VERIFY_SHARED_HOST: _sharedHostMode,
    ...baseEnv
  } = process.env;
  return {
    ...baseEnv,
    NODE_ENV: "test",
    ...(explicitMode ? { MURPH_VERIFY_SHARED_HOST: "1" } : {}),
    MURPH_VERIFY_SHARED_HOST_POLL_INTERVAL_MS: "10",
    MURPH_VERIFY_SHARED_HOST_STALE_METADATA_GRACE_MS: "0",
    MURPH_VERIFY_SHARED_HOST_TEST_STATE_ROOT: stateRoot,
    ...overrides,
  };
}

function runSync(
  label: string,
  command: string[],
  stateRoot: string,
  overrides: NodeJS.ProcessEnv = {},
  explicitMode = true,
) {
  return spawnSync(process.execPath, [wrapperPath, label, "--", ...command], {
    cwd: repoRoot,
    encoding: "utf8",
    env: slotEnv(stateRoot, overrides, explicitMode),
  });
}

function startHolder(label: string, stateRoot: string): ChildProcess {
  return startCommand(label, stateRoot, holderSource);
}

function startCommand(
  label: string,
  stateRoot: string,
  source: string,
  overrides: NodeJS.ProcessEnv = {},
): ChildProcess {
  const child = spawn(
    process.execPath,
    [
      wrapperPath,
      label,
      "--",
      process.execPath,
      "--input-type=module",
      "-e",
      source,
    ],
    {
      cwd: repoRoot,
      env: slotEnv(stateRoot, overrides),
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function startRawCommand(source: string): ChildProcess {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", source],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

async function waitForLine(child: ChildProcess, line: string): Promise<void> {
  await waitForStreamLine(child, child.stdout, line);
}

async function waitForPids(child: ChildProcess): Promise<[number, number]> {
  let output = "";
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for pids; output=${output}`)),
      2_000,
    );
    const onData = (chunk: Buffer | string) => {
      output += chunk.toString();
      const match = output.match(/pids (\d+) (\d+)/u);
      if (match) {
        clearTimeout(timeout);
        child.stdout?.off("data", onData);
        resolve([Number(match[1]), Number(match[2])]);
      }
    };
    child.stdout?.on("data", onData);
    child.once("error", reject);
  });
}

async function waitForStderrLine(child: ChildProcess, line: string): Promise<void> {
  await waitForStreamLine(child, child.stderr, line);
}

async function waitForStreamLine(
  child: ChildProcess,
  stream: ChildProcess["stdout"],
  line: string,
): Promise<void> {
  let output = "";
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${line}`)), 2_000);
    const onData = (chunk: Buffer | string) => {
      output += chunk.toString();
      if (output.includes(line)) {
        clearTimeout(timeout);
        stream?.off("data", onData);
        resolve();
      }
    };
    stream?.on("data", onData);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!output.includes(line)) {
        clearTimeout(timeout);
        reject(new Error(`Child exited with ${code} before ${line}; output=${output}`));
      }
    });
  });
}

async function expectNoLine(child: ChildProcess, line: string, durationMs: number): Promise<void> {
  let stdout = "";
  const onData = (chunk: Buffer | string) => {
    stdout += chunk.toString();
  };
  child.stdout?.on("data", onData);
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  child.stdout?.off("data", onData);
  expect(stdout.split("\n")).not.toContain(line);
}

async function waitForExit(child: ChildProcess): Promise<number> {
  if (child.exitCode !== null) {
    return child.exitCode;
  }
  return await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for child exit")), 2_000);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve(code ?? 1);
    });
  });
}

async function waitForOwnedProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) {
      ownedDescendantPids.delete(pid);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Owned process ${pid} did not exit`);
}

function isProcessRunning(pid: number | undefined): boolean {
  if (!pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error
      && typeof error === "object"
      && "code" in error
      && error.code === "ESRCH"
    );
  }
}
