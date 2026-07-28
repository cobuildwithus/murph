#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildSanitizedVerificationEnvironment,
  runSanitizedVerification,
  STATIC_SSH_VERIFICATION_PROFILE,
} from "./run-verification.mjs";

const CLEANUP_FLAG = "--cleanup-static-workspace";
const CLEANUP_ONLY_FLAG = "--cleanup-static-workspace-only";
const INTERNAL_RUN_FLAG = "--internal-static-verification-child";
const STATIC_GIT_SNAPSHOT_DIRECTORY = ".murph-static-git-snapshot";
const STATIC_ARCHIVE_PROBE_MAX_BYTES = 1024 * 1024;
const STATIC_ARCHIVE_ZSTD_FRAME_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const STATIC_ARCHIVE_ZSTD_COMPRESSION_ARGS = [
  "-3",
  "--no-progress",
  "-T2",
];
const STATIC_ARCHIVE_ZSTD_DECOMPRESSION_ARGS = ["-d", "--stdout"];

export function parseSshVerificationRequest(argv) {
  if (argv[0] === CLEANUP_ONLY_FLAG && argv.length === 1) {
    return {
      cleanupOnly: true,
      cleanupWorkspace: true,
      verificationArgs: [],
    };
  }
  if (argv[0] !== CLEANUP_FLAG) {
    return {
      cleanupOnly: false,
      cleanupWorkspace: false,
      verificationArgs: argv,
    };
  }
  return {
    cleanupOnly: false,
    cleanupWorkspace: true,
    verificationArgs: argv.slice(1),
  };
}

export function assertSafeStaticWorkspace(
  { workspaceRoot, runRoot },
) {
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const resolvedRunRoot = path.resolve(
    runRoot ?? path.join(resolvedWorkspace, "../../.."),
  );
  const relativeWorkspace = path.relative(resolvedRunRoot, resolvedWorkspace);
  const pathParts = relativeWorkspace.split(path.sep);
  const runMatch = /^([a-f0-9]{16})-([a-f0-9]{16})$/u.exec(
    pathParts[0] ?? "",
  );
  if (
    pathParts.length !== 3 ||
    path.basename(resolvedRunRoot) !== "runs" ||
    path.basename(path.dirname(resolvedRunRoot)) !== "murph-crabbox" ||
    !runMatch ||
    pathParts[1] !== `static_murph_${runMatch[1]}` ||
    pathParts[2] !== "murph"
  ) {
    throw new Error(
      "Static SSH workspace cleanup requires Crabbox's exact opaque nested run directory below the configured run root.",
    );
  }
  return path.join(resolvedRunRoot, pathParts[0]);
}

export function cleanupStaticWorkspace(
  { workspaceRoot, runRoot },
) {
  rmSync(assertSafeStaticWorkspace({ workspaceRoot, runRoot }), {
    force: true,
    recursive: true,
  });
}

export function assertStaticWorkerArchiveCapabilities(
  sourceEnvironment = process.env,
) {
  const environment = buildSanitizedVerificationEnvironment(
    sourceEnvironment,
    { verificationProfile: STATIC_SSH_VERIFICATION_PROFILE },
  );
  const tarArchive = runStaticArchiveProbeCommand({
    args: [
      "--format=pax",
      "--no-recursion",
      "--null",
      "-T",
      "/dev/null",
      "-cvvf",
      "-",
    ],
    command: "tar",
    environment: { ...environment, COPYFILE_DISABLE: "1" },
    failureDescription: "create a production-compatible probe archive",
  });
  if (tarArchive.byteLength === 0) {
    throw new Error(
      "Static SSH worker prerequisite failed: tar produced an empty probe archive.",
    );
  }

  const compressedArchive = runStaticArchiveProbeCommand({
    args: STATIC_ARCHIVE_ZSTD_COMPRESSION_ARGS,
    command: "zstd",
    environment,
    failureDescription:
      "compress stdin with Murph's snapshot arguments (-3 --no-progress -T2)",
    input: tarArchive,
  });
  if (!compressedArchive.subarray(0, 4).equals(STATIC_ARCHIVE_ZSTD_FRAME_MAGIC)) {
    throw new Error(
      "Static SSH worker prerequisite failed: zstd compression did not produce a standard zstd frame.",
    );
  }
  const restoredArchive = runStaticArchiveProbeCommand({
    args: STATIC_ARCHIVE_ZSTD_DECOMPRESSION_ARGS,
    command: "zstd",
    environment,
    failureDescription:
      "decompress stdin with Murph's snapshot arguments (-d --stdout)",
    input: compressedArchive,
  });
  if (!restoredArchive.equals(tarArchive)) {
    throw new Error(
      "Static SSH worker prerequisite failed: zstd did not preserve the probe archive through compression and decompression.",
    );
  }
  runStaticArchiveProbeCommand({
    args: ["-tf", "-"],
    command: "tar",
    environment,
    failureDescription: "read the restored probe archive",
    input: restoredArchive,
  });

  process.stderr.write(
    `[ssh-verification] readiness=tar-zstd-round-trip profile=${STATIC_SSH_VERIFICATION_PROFILE}\n`,
  );
}

function runStaticArchiveProbeCommand({
  args,
  command,
  environment,
  failureDescription,
  input,
}) {
  const result = spawnSync(command, args, {
    encoding: null,
    env: environment,
    input,
    maxBuffer: STATIC_ARCHIVE_PROBE_MAX_BYTES,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.error && result.error.code === "ENOENT") {
    throw new Error(
      `Static SSH worker prerequisite failed: ${command} is unavailable on the non-interactive PATH.`,
    );
  }
  if (result.error) {
    throw new Error(
      `Static SSH worker prerequisite failed: ${command} could not start to ${failureDescription}.`,
    );
  }
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new Error(
      `Static SSH worker prerequisite failed: ${command} could not ${failureDescription} (exit ${result.status ?? "unknown"}).`,
    );
  }
  return result.stdout;
}

export function restoreStaticGitSnapshot({ workspaceRoot }) {
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const metadataRoot = path.join(
    resolvedWorkspace,
    STATIC_GIT_SNAPSHOT_DIRECTORY,
  );
  const gitDirectory = path.join(resolvedWorkspace, ".git");
  if (!existsSync(metadataRoot) || existsSync(gitDirectory)) {
    throw new Error(
      "Static SSH verification requires one transported Git snapshot and no pre-existing remote Git directory.",
    );
  }

  const baseCommit = readSnapshotObjectId(metadataRoot, "base-commit");
  const expectedBaseTree = readSnapshotObjectId(metadataRoot, "base-tree");
  const expectedCandidateTree = readSnapshotObjectId(
    metadataRoot,
    "candidate-tree",
  );

  runGit(
    resolvedWorkspace,
    ["init", "--quiet"],
    "initialize the transported static Git snapshot",
  );
  const privateMetadataRoot = path.join(
    gitDirectory,
    "murph-static-snapshot",
  );
  renameSync(metadataRoot, privateMetadataRoot);

  runGit(
    resolvedWorkspace,
    [
      "add",
      "--all",
      "--force",
      `--pathspec-from-file=${path.join(
        privateMetadataRoot,
        "candidate-paths",
      )}`,
      "--pathspec-file-nul",
    ],
    "hash the transported static Git candidate",
  );
  importGitObjectPack(
    resolvedWorkspace,
    path.join(privateMetadataRoot, "objects.pack"),
  );
  runGit(
    resolvedWorkspace,
    ["read-tree", "--empty"],
    "clear the provisional static Git index",
  );
  runGitWithInputFile(
    resolvedWorkspace,
    ["update-index", "-z", "--index-info"],
    path.join(privateMetadataRoot, "candidate-index"),
    "restore the admitted static Git candidate index",
  );
  const candidateTree = readGitValue(
    resolvedWorkspace,
    ["write-tree"],
    "transported candidate tree",
  );
  if (candidateTree !== expectedCandidateTree) {
    throw new Error(
      "Static SSH transport changed the admitted candidate Git tree.",
    );
  }
  runGit(
    resolvedWorkspace,
    [
      "fsck",
      "--connectivity-only",
      "--no-dangling",
      expectedCandidateTree,
    ],
    "verify the transported static Git candidate",
  );
  runGit(
    resolvedWorkspace,
    ["checkout-index", "--all", "--force"],
    "restore the admitted candidate files and modes",
  );
  runGit(
    resolvedWorkspace,
    ["diff", "--quiet", "--"],
    "verify the admitted candidate worktree",
  );
  const baseTree = readGitValue(
    resolvedWorkspace,
    ["rev-parse", `${baseCommit}^{tree}`],
    "transported base tree",
  );
  if (baseTree !== expectedBaseTree) {
    throw new Error(
      "Static SSH transport changed the admitted base Git tree.",
    );
  }
  runGit(
    resolvedWorkspace,
    ["fsck", "--connectivity-only", "--no-dangling", baseCommit],
    "verify the transported static Git base",
  );
  runGit(
    resolvedWorkspace,
    ["update-ref", "--no-deref", "HEAD", baseCommit],
    "detach the transported static Git base",
  );
  rmSync(privateMetadataRoot, { force: true, recursive: true });
}

function readSnapshotObjectId(metadataRoot, name) {
  const value = readFileSync(path.join(metadataRoot, name), "utf8").trim();
  if (!/^[a-f0-9]{40}$/u.test(value)) {
    throw new Error(
      `Static SSH Git snapshot ${name} must be one SHA-1 object id.`,
    );
  }
  return value;
}

function importGitObjectPack(repoRoot, packPath) {
  const packDescriptor = openSync(packPath, "r");
  try {
    const result = spawnSync("git", ["index-pack", "--stdin"], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: [packDescriptor, "pipe", "pipe"],
    });
    if (result.status !== 0) {
      throw new Error(
        "Unable to import the transported static Git base.",
      );
    }
  } finally {
    closeSync(packDescriptor);
  }
}

function runGitWithInputFile(repoRoot, args, inputPath, description) {
  const inputDescriptor = openSync(inputPath, "r");
  try {
    const result = spawnSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: [inputDescriptor, "pipe", "pipe"],
    });
    if (result.status !== 0) {
      throw new Error(`Unable to ${description}.`);
    }
  } finally {
    closeSync(inputDescriptor);
  }
}

function readGitValue(repoRoot, args, description) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const value = result.stdout.trim();
  if (result.status !== 0 || !value) {
    throw new Error(`Unable to inspect the ${description}.`);
  }
  return value;
}

function runGit(repoRoot, args, description) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Unable to ${description}.`);
  }
}

function createRunLifetimeSignalOwner() {
  let activeChild = null;
  let firstSignal = null;
  const handlers = new Map();

  for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
    const handler = () => {
      firstSignal ??= signal;
      if (activeChild) {
        signalChildProcessGroup(activeChild, signal);
      }
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }

  return {
    clearActiveChild(child) {
      if (activeChild === child) {
        activeChild = null;
      }
    },
    dispose() {
      for (const [signal, handler] of handlers) {
        process.off(signal, handler);
      }
    },
    get firstSignal() {
      return firstSignal;
    },
    setActiveChild(child) {
      activeChild = child;
      if (firstSignal) {
        signalChildProcessGroup(child, firstSignal);
      }
    },
  };
}

function signalChildProcessGroup(child, signal) {
  if (!child.pid) {
    return;
  }
  try {
    if (process.platform === "win32") {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if (!error || error.code !== "ESRCH") {
      process.stderr.write(
        `[ssh-verification] Unable to forward ${signal} to the active verifier process group.\n`,
      );
    }
  }
}

async function waitForChildProcessGroupExit(processGroupId) {
  if (process.platform === "win32" || !processGroupId) {
    return;
  }
  while (isProcessGroupRunning(processGroupId)) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function isProcessGroupRunning(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    return !error || error.code !== "ESRCH";
  }
}

function signalExitCode(signal) {
  switch (signal) {
    case "SIGHUP":
      return 129;
    case "SIGINT":
      return 130;
    case "SIGTERM":
      return 143;
    default:
      return 1;
  }
}

function runStaticVerificationChild(argv, signalOwner) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), INTERNAL_RUN_FLAG, ...argv],
      {
        cwd: process.cwd(),
        detached: process.platform !== "win32",
        env: process.env,
        stdio: "inherit",
      },
    );
    signalOwner.setActiveChild(child);
    child.once("error", (error) => {
      signalOwner.clearActiveChild(child);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      void waitForChildProcessGroupExit(child.pid).then(
        () => {
          signalOwner.clearActiveChild(child);
          resolve({ code, signal });
        },
        reject,
      );
    });
  });
}

async function runStaticVerification(argv) {
  const signalOwner = createRunLifetimeSignalOwner();
  try {
    const request = parseSshVerificationRequest(argv);
    const workspaceRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../..",
    );
    if (request.cleanupOnly) {
      cleanupStaticWorkspace({ workspaceRoot });
      return signalOwner.firstSignal
        ? signalExitCode(signalOwner.firstSignal)
        : 0;
    }

    let result;
    try {
      result = await runStaticVerificationChild(argv, signalOwner);
    } finally {
      if (request.cleanupWorkspace) {
        cleanupStaticWorkspace({ workspaceRoot });
      }
    }

    const terminatingSignal = signalOwner.firstSignal ?? result.signal;
    if (terminatingSignal) {
      return signalExitCode(terminatingSignal);
    }
    return result.code ?? 1;
  } finally {
    signalOwner.dispose();
  }
}

async function runStaticVerificationChildProcess(argv) {
  const signalOwner = createRunLifetimeSignalOwner();
  try {
    const request = parseSshVerificationRequest(argv);
    if (request.cleanupOnly) {
      throw new Error(
        "Static SSH cleanup-only execution must remain owned by the run supervisor.",
      );
    }
    assertStaticWorkerArchiveCapabilities(process.env);
    if (request.cleanupWorkspace) {
      const workspaceRoot = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../..",
      );
      restoreStaticGitSnapshot({ workspaceRoot });
    }
    const result = await runSanitizedVerification(
      request.verificationArgs,
      process.env,
      { verificationProfile: STATIC_SSH_VERIFICATION_PROFILE },
    );
    return signalOwner.firstSignal
      ? signalExitCode(signalOwner.firstSignal)
      : result;
  } finally {
    signalOwner.dispose();
  }
}

function isDirectEntrypoint() {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint) && import.meta.url === pathToFileURL(path.resolve(entrypoint)).href;
}

if (isDirectEntrypoint()) {
  try {
    const argv = process.argv.slice(2);
    if (argv[0] === INTERNAL_RUN_FLAG) {
      process.exitCode = await runStaticVerificationChildProcess(
        argv.slice(1),
      );
    } else {
      process.exitCode = await runStaticVerification(argv);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[ssh-verification] ${message}\n`);
    process.exitCode = 1;
  }
}
