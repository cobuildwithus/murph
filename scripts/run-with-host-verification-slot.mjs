#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const ENABLED_ENV = "MURPH_VERIFY_SHARED_HOST";
const HELD_ENV = "MURPH_VERIFY_HOST_SLOT_HELD";
const TEST_STATE_ROOT_ENV = "MURPH_VERIFY_SHARED_HOST_TEST_STATE_ROOT";
const CODEX_THREAD_ENV = "CODEX_THREAD_ID";
const COMMAND_TIMEOUT_ENV = "MURPH_VERIFY_HOST_COMMAND_TIMEOUT_MS";
const COMMAND_KILL_GRACE_ENV = "MURPH_VERIFY_HOST_COMMAND_KILL_GRACE_MS";
const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_STALE_METADATA_GRACE_MS = 10_000;
const DEFAULT_COMMAND_KILL_GRACE_MS = 30_000;
const COMMAND_TIMEOUT_EXIT_CODE = 124;
const GROUP_EXIT_POLL_INTERVAL_MS = 100;
const WAIT_LOG_INTERVAL_MS = 60_000;
const OWNER_FILE_NAME = "owner.json";
const invocationCwd = process.cwd();
const invocation = parseInvocation(process.argv.slice(2));
const useDetachedChildProcessGroup = process.platform !== "win32";
// A configured command deadline arms whole-process-group termination: timeout,
// cancellation, and failed-command cleanup act on the one detached group this
// supervisor creates, so a wedged descendant (for example a Webpack compiler
// worker) cannot outlive an unsuccessful command. A clean command exit returns
// directly so platform-owned residual process state cannot stall completion.
const commandTimeoutMs = useDetachedChildProcessGroup
  ? readPositiveInteger(process.env[COMMAND_TIMEOUT_ENV], 0)
  : 0;
const commandKillGraceMs = readPositiveInteger(
  process.env[COMMAND_KILL_GRACE_ENV],
  DEFAULT_COMMAND_KILL_GRACE_MS,
);
let activeChild = null;
let forcedExitCode = null;
let heldSlot = null;
let lastWaitLogAtMs = 0;

installTerminationHandlers();

try {
  const sharedHostMode = resolveSharedHostMode(process.env);
  const childEnv = {
    ...process.env,
    [ENABLED_ENV]: sharedHostMode,
  };

  if (sharedHostMode !== "1" || process.env[HELD_ENV] === "1") {
    process.exitCode = await runCommand(invocation.commandArgs, childEnv);
  } else {
    await acquireSlot(invocation.label);
    process.exitCode = await runCommand(invocation.commandArgs, {
      ...childEnv,
      [HELD_ENV]: "1",
    });
  }
} catch (error) {
  console.error(`[host-verification] ${formatError(error)}`);
  process.exitCode = 1;
} finally {
  releaseHeldSlot();
}

async function acquireSlot(label) {
  const stateRoot = resolveStateRoot();
  const slotPath = path.join(stateRoot, "slot-1");
  const pollIntervalMs = readPositiveInteger(
    process.env.MURPH_VERIFY_SHARED_HOST_POLL_INTERVAL_MS,
    DEFAULT_POLL_INTERVAL_MS,
  );
  const staleMetadataGraceMs = readNonNegativeInteger(
    process.env.MURPH_VERIFY_SHARED_HOST_STALE_METADATA_GRACE_MS,
    DEFAULT_STALE_METADATA_GRACE_MS,
  );
  const owner = {
    childPid: null,
    claimId: randomUUID(),
    label: sanitizeLabel(label),
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };

  prepareStateRoot(stateRoot);

  while (true) {
    try {
      mkdirSync(slotPath, { mode: 0o700 });
      writeOwnerMetadata(slotPath, owner);
      heldSlot = { owner, slotPath };
      return;
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
    }

    const inspection = inspectSlot(slotPath, staleMetadataGraceMs);
    if (inspection.state === "available") {
      continue;
    }
    if (
      inspection.state === "stale"
      && reclaimStaleSlot(slotPath, inspection, staleMetadataGraceMs)
    ) {
      continue;
    }

    if (Date.now() - lastWaitLogAtMs >= WAIT_LOG_INTERVAL_MS) {
      console.error(
        `[host-verification] waiting for the exclusive shared-host slot.${formatOwner(inspection.metadata)} Waiting continues until the slot is available or this command is cancelled.`,
      );
      lastWaitLogAtMs = Date.now();
    }

    await delay(pollIntervalMs);
  }
}

function inspectSlot(slotPath, staleMetadataGraceMs) {
  try {
    const stats = statSync(slotPath);
    const metadata = readOwnerMetadata(slotPath);

    if (!metadata) {
      return Date.now() - stats.mtimeMs >= staleMetadataGraceMs
        ? { dev: stats.dev, ino: stats.ino, metadata: null, state: "stale" }
        : { dev: stats.dev, ino: stats.ino, metadata: null, state: "held" };
    }

    if (isProcessRunning(metadata.pid) || isProcessRunning(metadata.childPid)) {
      return { dev: stats.dev, ino: stats.ino, metadata, state: "held" };
    }

    return { dev: stats.dev, ino: stats.ino, metadata, state: "stale" };
  } catch (error) {
    if (isMissingPathError(error)) {
      return { metadata: null, state: "available" };
    }
    throw error;
  }
}

function reclaimStaleSlot(slotPath, priorInspection, staleMetadataGraceMs) {
  const reaperPath = path.join(slotPath, ".reaper");
  const reaperClaimId = randomUUID();

  try {
    mkdirSync(reaperPath, { mode: 0o700 });
    writeFileSync(path.join(reaperPath, reaperClaimId), "", { mode: 0o600 });
  } catch (error) {
    if (isAlreadyExistsError(error) || isMissingPathError(error)) {
      return false;
    }
    throw error;
  }

  try {
    const currentStats = statSync(slotPath);
    if (currentStats.dev !== priorInspection.dev || currentStats.ino !== priorInspection.ino) {
      return false;
    }

    const currentMetadata = readOwnerMetadata(slotPath);
    if (
      currentMetadata
      && (isProcessRunning(currentMetadata.pid) || isProcessRunning(currentMetadata.childPid))
    ) {
      return false;
    }
    if (
      currentMetadata
      && priorInspection.metadata
      && currentMetadata.claimId !== priorInspection.metadata.claimId
    ) {
      return false;
    }
    if (
      !currentMetadata
      && priorInspection.metadata
      && Date.now() - currentStats.mtimeMs < staleMetadataGraceMs
    ) {
      return false;
    }

    rmSync(slotPath, { force: true, recursive: true });
    return true;
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }
    throw error;
  } finally {
    releaseReaper(reaperPath, reaperClaimId);
  }
}

function releaseReaper(reaperPath, reaperClaimId) {
  try {
    if (statSync(path.join(reaperPath, reaperClaimId)).isFile()) {
      rmSync(reaperPath, { force: true, recursive: true });
    }
  } catch {
    // The stale slot may already have been removed.
  }
}

function releaseHeldSlot() {
  if (!heldSlot) {
    return;
  }

  const { owner, slotPath } = heldSlot;
  heldSlot = null;
  const currentOwner = readOwnerMetadata(slotPath);
  if (currentOwner?.claimId === owner.claimId) {
    rmSync(slotPath, { force: true, recursive: true });
  }
}

async function runCommand(commandArgs, env) {
  const [command, ...args] = commandArgs;

  const exitState = await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: invocationCwd,
      detached: useDetachedChildProcessGroup,
      env,
      stdio: "inherit",
    });

    activeChild = child;
    if (heldSlot) {
      heldSlot.owner.childPid = child.pid ?? null;
      writeOwnerMetadata(heldSlot.slotPath, heldSlot.owner);
    }

    let deadlineTimer = null;
    let killTimer = null;
    if (commandTimeoutMs > 0) {
      deadlineTimer = setTimeout(() => {
        forcedExitCode = COMMAND_TIMEOUT_EXIT_CODE;
        console.error(
          `[host-verification] Command exceeded ${commandTimeoutMs}ms; terminating its process group before the platform build ceiling.`,
        );
        signalProcessGroup(child.pid, "SIGTERM");
        killTimer = setTimeout(
          () => signalProcessGroup(child.pid, "SIGKILL"),
          commandKillGraceMs,
        );
      }, commandTimeoutMs);
    }

    child.on("error", (error) => {
      activeChild = null;
      clearTimeout(deadlineTimer);
      clearTimeout(killTimer);
      reject(error);
    });
    // Classify the direct child's result before releasing process ownership.
    // Unsuccessful commands still reap surviving descendants, and a
    // termination signal arriving during that cleanup must keep targeting the
    // detached group instead of exiting immediately.
    child.on("exit", (code, signal) => {
      clearTimeout(deadlineTimer);
      clearTimeout(killTimer);
      resolve({ code, pid: child.pid ?? null, signal });
    });
  });

  const commandSucceeded = forcedExitCode === null
    && exitState.signal === null
    && exitState.code === 0;
  try {
    if (!commandSucceeded && commandTimeoutMs > 0 && exitState.pid !== null) {
      await reapCommandProcessGroup(exitState.pid);
    }
  } finally {
    activeChild = null;
  }

  if (forcedExitCode !== null) {
    return forcedExitCode;
  }
  if (exitState.signal) {
    return signalToExitCode(exitState.signal);
  }
  return exitState.code ?? 1;
}

// Group signals tolerate EPERM as well as ESRCH: on macOS a killed group
// member that has not been reaped yet (a zombie) makes kill(-pgid, ...)
// return EPERM even though there is nothing left to signal. The group probe
// treats that same state as "still draining" so the reaper keeps waiting
// until the member is reaped and the group reports ESRCH.
function signalProcessGroup(pid, signalName) {
  if (!pid) {
    return;
  }
  try {
    process.kill(-pid, signalName);
  } catch (error) {
    if (!isMissingProcessError(error) && !isNotPermittedProcessError(error)) {
      throw error;
    }
  }
}

function isProcessGroupRunning(pid) {
  if (!pid) {
    return false;
  }
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return !isMissingProcessError(error);
  }
}

// With a command deadline configured, the direct child's exit is not enough:
// a wedged descendant in the detached group must also be gone before the
// supervisor returns and releases any held slot.
async function reapCommandProcessGroup(pid) {
  if (!isProcessGroupRunning(pid)) {
    return;
  }
  signalProcessGroup(pid, "SIGTERM");
  const killDeadline = Date.now() + commandKillGraceMs;
  while (Date.now() < killDeadline) {
    if (!isProcessGroupRunning(pid)) {
      return;
    }
    await delay(GROUP_EXIT_POLL_INTERVAL_MS);
  }
  signalProcessGroup(pid, "SIGKILL");
  while (isProcessGroupRunning(pid)) {
    await delay(GROUP_EXIT_POLL_INTERVAL_MS);
  }
}

function writeOwnerMetadata(slotPath, owner) {
  const metadataPath = path.join(slotPath, OWNER_FILE_NAME);
  const temporaryPath = path.join(slotPath, `.owner-${owner.claimId}.tmp`);
  writeFileSync(temporaryPath, `${JSON.stringify(owner)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    renameSync(temporaryPath, metadataPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function readOwnerMetadata(slotPath) {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(slotPath, OWNER_FILE_NAME), "utf8"),
    );
    if (!isOwnerMetadata(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function resolveStateRoot() {
  const override = process.env[TEST_STATE_ROOT_ENV];
  if (typeof override === "string" && override.trim().length > 0) {
    if (process.env.NODE_ENV !== "test") {
      throw new Error(`${TEST_STATE_ROOT_ENV} requires NODE_ENV=test.`);
    }

    const resolvedTempRoot = realpathSync(os.tmpdir());
    const absoluteOverride = path.resolve(override);
    const resolvedOverride = path.join(
      realpathSync(path.dirname(absoluteOverride)),
      path.basename(absoluteOverride),
    );
    const relativePath = path.relative(resolvedTempRoot, resolvedOverride);
    if (
      relativePath === ""
      || relativePath.startsWith("..")
      || path.isAbsolute(relativePath)
    ) {
      throw new Error(
        `${TEST_STATE_ROOT_ENV} must resolve to a directory beneath the OS temp directory.`,
      );
    }
    return resolvedOverride;
  }

  const userScope = typeof process.getuid === "function"
    ? String(process.getuid())
    : "current-user";
  return path.join(os.tmpdir(), `murph-host-verification-${userScope}`);
}

function prepareStateRoot(stateRoot) {
  try {
    mkdirSync(stateRoot, { mode: 0o700 });
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }
  }

  const stats = lstatSync(stateRoot);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error("Shared-host state root must be a real directory.");
  }
  if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
    throw new Error("Shared-host state root must be owned by the current user.");
  }

  chmodSync(stateRoot, 0o700);
}

function installTerminationHandlers() {
  process.on("exit", releaseHeldSlot);
  process.on("SIGINT", () => handleTerminationSignal("SIGINT", 130));
  process.on("SIGTERM", () => handleTerminationSignal("SIGTERM", 143));
  process.on("SIGHUP", () => handleTerminationSignal("SIGHUP", 143));
}

function handleTerminationSignal(signalName, exitCode) {
  forcedExitCode = exitCode;
  if (!activeChild?.pid) {
    releaseHeldSlot();
    process.exit(exitCode);
  }

  if (useDetachedChildProcessGroup) {
    signalProcessGroup(activeChild.pid, signalName);
  } else {
    try {
      activeChild.kill(signalName);
    } catch (error) {
      if (!isMissingProcessError(error)) {
        throw error;
      }
    }
  }

  // With a command deadline configured, external cancellation must also be
  // bounded: a group member that ignores the forwarded signal is force-killed
  // after the same grace the deadline path uses.
  if (commandTimeoutMs > 0) {
    const cancelledPid = activeChild.pid;
    setTimeout(() => signalProcessGroup(cancelledPid, "SIGKILL"), commandKillGraceMs).unref();
  }
}

function parseInvocation(argv) {
  const separatorIndex = argv.indexOf("--");
  const labelArgs = separatorIndex === -1 ? argv.slice(0, 1) : argv.slice(0, separatorIndex);
  const commandArgs = separatorIndex === -1 ? argv.slice(1) : argv.slice(separatorIndex + 1);
  const label = labelArgs.join(" ").trim();

  if (!label || commandArgs.length === 0) {
    console.error(
      "Usage: node scripts/run-with-host-verification-slot.mjs <label> -- <command> [args...]",
    );
    process.exit(1);
  }

  return { commandArgs, label };
}

function sanitizeLabel(label) {
  let sanitized = label.replaceAll(invocationCwd, "<cwd>");
  const homeDirectory = os.homedir();
  if (homeDirectory) {
    sanitized = sanitized.replaceAll(homeDirectory, "<home>");
  }
  return sanitized.replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
}

function formatOwner(owner) {
  if (!owner) {
    return "";
  }
  return ` Active: ${owner.label} (pid ${owner.pid}).`;
}

function formatError(error) {
  if (error instanceof Error && error.message.startsWith(`${ENABLED_ENV} `)) {
    return error.message;
  }
  if (error instanceof Error && error.message.startsWith(`${TEST_STATE_ROOT_ENV} `)) {
    return error.message;
  }
  const code = error && typeof error === "object" && "code" in error
    ? ` (${String(error.code)})`
    : "";
  return `Unable to run the verification command${code}.`;
}

function isOwnerMetadata(value) {
  return Boolean(
    value
      && typeof value === "object"
      && !Array.isArray(value)
      && typeof value.claimId === "string"
      && value.claimId.length > 0
      && typeof value.label === "string"
      && Number.isInteger(value.pid)
      && value.pid > 0
      && (value.childPid === null
        || (Number.isInteger(value.childPid) && value.childPid > 0)),
  );
}

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isMissingProcessError(error);
  }
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveSharedHostMode(env) {
  const configured = env[ENABLED_ENV];
  if (configured !== undefined) {
    if (configured !== "0" && configured !== "1") {
      throw new Error(`${ENABLED_ENV} must be 0 or 1.`);
    }
    return configured;
  }

  return !env.CI && typeof env[CODEX_THREAD_ENV] === "string"
    && env[CODEX_THREAD_ENV].trim().length > 0
    ? "1"
    : "0";
}

function readNonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function signalToExitCode(signalName) {
  return signalName === "SIGINT" ? 130 : 143;
}

function isAlreadyExistsError(error) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

function isMissingPathError(error) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function isMissingProcessError(error) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ESRCH");
}

function isNotPermittedProcessError(error) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EPERM");
}

function delay(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
