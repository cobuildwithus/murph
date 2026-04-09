#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const WORKSPACE_ARTIFACT_LOCK_HELD_ENV = "MURPH_WORKSPACE_ARTIFACT_LOCK_HELD";
const DEFAULT_LOCK_POLL_INTERVAL_MS = 1_000;
const DEFAULT_LOCK_TIMEOUT_MS = 30 * 60 * 1_000;
const DEFAULT_STALE_METADATA_GRACE_MS = 10_000;
const WAIT_LOG_INTERVAL_MS = 5_000;
const LOCK_DIRECTORY_NAME = "workspace-artifacts.lock";
const LOCK_METADATA_FILE_NAME = "owner.json";
const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const invocationCwd = process.cwd();
const lockRoot = resolveWorkspaceArtifactLockRoot(repoRoot);
const lockPath = path.join(lockRoot, LOCK_DIRECTORY_NAME);
const metadataPath = path.join(lockPath, LOCK_METADATA_FILE_NAME);
const useDetachedChildProcessGroup = process.platform !== "win32";

const invocation = parseInvocation(process.argv.slice(2));

if (process.env[WORKSPACE_ARTIFACT_LOCK_HELD_ENV] === "1") {
  process.exit(runCommand(invocation.commandArgs, process.env));
}

mkdirSync(lockRoot, { recursive: true });

const startedAtMs = Date.now();
const pollIntervalMs = readPositiveIntegerEnv(
  process.env.MURPH_WORKSPACE_ARTIFACT_LOCK_POLL_INTERVAL_MS,
  DEFAULT_LOCK_POLL_INTERVAL_MS,
);
const timeoutMs = readPositiveIntegerEnv(
  process.env.MURPH_WORKSPACE_ARTIFACT_LOCK_TIMEOUT_MS,
  DEFAULT_LOCK_TIMEOUT_MS,
);
const staleMetadataGraceMs = readPositiveIntegerEnv(
  process.env.MURPH_WORKSPACE_ARTIFACT_LOCK_STALE_METADATA_GRACE_MS,
  DEFAULT_STALE_METADATA_GRACE_MS,
);
const ownerMetadata = {
  command: describeCommandArgs(invocation.commandArgs),
  cwd: describeInvocationCwd(invocationCwd),
  label: sanitizeLabel(invocation.label),
  pid: process.pid,
  startedAt: new Date().toISOString(),
};
let activeChild = null;
let forcedExitCode = null;
let lockHeld = false;
let lastWaitLogAtMs = 0;

const releaseLock = () => {
  if (!lockHeld) {
    return;
  }

  lockHeld = false;
  rmSync(lockPath, { force: true, recursive: true });
};

installTerminationHandlers(releaseLock);

try {
  acquireWorkspaceArtifactLock();
  process.exit(await runCommand(invocation.commandArgs, {
    ...process.env,
    [WORKSPACE_ARTIFACT_LOCK_HELD_ENV]: "1",
  }));
} finally {
  releaseLock();
}

function acquireWorkspaceArtifactLock() {
  while (true) {
    try {
      mkdirSync(lockPath);
      writeFileSync(metadataPath, `${JSON.stringify(ownerMetadata, null, 2)}\n`, "utf8");
      lockHeld = true;
      return;
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }

      const lockInspection = inspectExistingWorkspaceArtifactLock();

      if (lockInspection.state === "available") {
        continue;
      }

      if (lockInspection.state === "stale") {
        rmSync(lockPath, { force: true, recursive: true });
        continue;
      }

      const elapsedMs = Date.now() - startedAtMs;
      if (elapsedMs >= timeoutMs) {
        throw new Error(
          [
            `Timed out after ${timeoutMs}ms waiting for the repo workspace-artifact lock.`,
            formatLockOwner(lockInspection.metadata),
          ].join(" "),
        );
      }

      if (Date.now() - lastWaitLogAtMs >= WAIT_LOG_INTERVAL_MS) {
        console.error(
          `[workspace-lock] waiting for ${formatLockOwner(lockInspection.metadata)}.`,
        );
        lastWaitLogAtMs = Date.now();
      }

      sleep(pollIntervalMs);
    }
  }
}

function inspectExistingWorkspaceArtifactLock() {
  try {
    const ageMs = Date.now() - statSync(lockPath).mtimeMs;
    const metadata = readLockMetadata(metadataPath);

    if (!metadata) {
      return ageMs >= staleMetadataGraceMs
        ? { state: "stale", metadata: null }
        : { state: "held", metadata: null };
    }

    if (!isProcessRunning(metadata.pid)) {
      return { state: "stale", metadata };
    }

    return { state: "held", metadata };
  } catch (error) {
    if (isMissingPathError(error)) {
      return { state: "available" };
    }

    throw error;
  }
}

function readLockMetadata(targetPath) {
  try {
    const parsed = JSON.parse(readFileSync(targetPath, "utf8"));

    if (!isLockMetadata(parsed)) {
      return null;
    }

    return parsed;
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }

    return null;
  }
}

function runCommand(commandArgs, env) {
  const [command, ...args] = commandArgs;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: invocationCwd,
      detached: useDetachedChildProcessGroup,
      env,
      stdio: "inherit",
    });

    activeChild = child;

    child.on("error", (error) => {
      activeChild = null;
      reject(error);
    });

    child.on("exit", (code, signal) => {
      activeChild = null;

      if (forcedExitCode !== null) {
        resolve(forcedExitCode);
        return;
      }

      if (signal) {
        resolve(signalToExitCode(signal));
        return;
      }

      resolve(code ?? 1);
    });
  });
}

function formatLockOwner(metadata) {
  if (!metadata) {
    return "an existing workspace-artifact command with pending owner metadata";
  }

  const label = typeof metadata.label === "string" && metadata.label.trim().length > 0
    ? metadata.label.trim()
    : "workspace-artifact command";
  const commandPreview = Array.isArray(metadata.command) && metadata.command.length > 0
    ? ` (${metadata.command.join(" ")})`
    : "";
  const cwdPreview = typeof metadata.cwd === "string" && metadata.cwd.trim().length > 0
    ? ` in ${metadata.cwd}`
    : "";

  return `${label} (pid ${metadata.pid})${commandPreview}${cwdPreview}`;
}

function parseInvocation(argv) {
  const separatorIndex = argv.indexOf("--");
  const hasExplicitSeparator = separatorIndex !== -1;
  const labelArgs = hasExplicitSeparator ? argv.slice(0, separatorIndex) : argv.slice(0, 1);
  const commandArgs = hasExplicitSeparator ? argv.slice(separatorIndex + 1) : argv.slice(1);
  const label = labelArgs.join(" ").trim();

  if (!label || commandArgs.length === 0) {
    console.error(
      "Usage: node scripts/run-with-workspace-artifact-lock.mjs <label> -- <command> [args...]",
    );
    process.exit(1);
  }

  return {
    commandArgs,
    label,
  };
}

function readPositiveIntegerEnv(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function installTerminationHandlers(releaseLock) {
  let released = false;

  const releaseOnce = () => {
    if (released) {
      return;
    }

    released = true;
    releaseLock();
  };

  process.on("exit", releaseOnce);
  process.on("SIGINT", () => {
    handleTerminationSignal("SIGINT", 130, releaseOnce);
  });
  process.on("SIGTERM", () => {
    handleTerminationSignal("SIGTERM", 143, releaseOnce);
  });
  process.on("SIGHUP", () => {
    handleTerminationSignal("SIGHUP", 143, releaseOnce);
  });
}

function resolveWorkspaceArtifactLockRoot(currentRepoRoot) {
  const gitDirectory = resolveGitDirectory(currentRepoRoot);

  if (gitDirectory) {
    return path.join(gitDirectory, "murph-locks");
  }

  const repoHash = createHash("sha256").update(currentRepoRoot).digest("hex").slice(0, 16);
  return path.join(os.tmpdir(), "murph-locks", repoHash);
}

function resolveGitDirectory(currentRepoRoot) {
  const gitPath = path.join(currentRepoRoot, ".git");

  try {
    const stats = statSync(gitPath);

    if (stats.isDirectory()) {
      return gitPath;
    }

    if (stats.isFile()) {
      const descriptor = readFileSync(gitPath, "utf8").trim();
      const prefix = "gitdir:";

      if (descriptor.toLowerCase().startsWith(prefix)) {
        return path.resolve(currentRepoRoot, descriptor.slice(prefix.length).trim());
      }
    }
  } catch {
    return null;
  }

  return null;
}

function describeInvocationCwd(currentCwd) {
  const relativePath = path.relative(repoRoot, currentCwd);

  if (relativePath === "") {
    return ".";
  }

  if (!relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
    return relativePath;
  }

  return "<outside-repo>";
}

function describeCommandArgs(commandArgs) {
  return commandArgs.map((argument) => sanitizePathLikeToken(argument));
}

function sanitizeLabel(label) {
  return label
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => sanitizePathLikeToken(part))
    .join(" ");
}

function sanitizePathLikeToken(token) {
  if (typeof token !== "string" || token.length === 0) {
    return "<arg>";
  }

  if (!path.isAbsolute(token)) {
    return token;
  }

  const relativePath = path.relative(repoRoot, token);
  if (!relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
    return relativePath === "" ? "." : relativePath;
  }

  return path.basename(token);
}

function handleTerminationSignal(signalName, exitCode, releaseLock) {
  forcedExitCode = exitCode;

  if (!activeChild) {
    releaseLock();
    process.exit(exitCode);
    return;
  }

  terminateChildProcess(activeChild, signalName);
}

function terminateChildProcess(child, signalName) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  try {
    if (useDetachedChildProcessGroup) {
      process.kill(-child.pid, signalName);
      return;
    }

    child.kill(signalName);
  } catch (error) {
    if (!isMissingProcessError(error)) {
      throw error;
    }
  }
}

function signalToExitCode(signalName) {
  switch (signalName) {
    case "SIGINT":
      return 130;
    case "SIGTERM":
    case "SIGHUP":
      return 143;
    default:
      return 1;
  }
}

function isLockMetadata(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Number.isInteger(value.pid) &&
      value.pid > 0,
  );
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "ESRCH" || error.code === "ENOENT")
    );
  }
}

function isAlreadyExistsError(error) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EEXIST",
  );
}

function isMissingPathError(error) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT",
  );
}

function isMissingProcessError(error) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "ESRCH" || error.code === "ENOENT"),
  );
}

function sleep(delayMs) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}
