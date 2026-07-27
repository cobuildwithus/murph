#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const BLACKSMITH_PROVIDER = "blacksmith-testbox";
const BLACKSMITH_ORG = "cobuildwithus";
const BLACKSMITH_REF = "main";
const BLACKSMITH_WORKFLOW = ".github/workflows/crabbox-bounded.yml";
const BLACKSMITH_JOB = "hydrate";
const DEFAULT_CRABBOX_PROFILE = "murph-verification";
const CRABBOX_IDLE_TIMEOUT = "10m";
const TRUSTED_CRABBOX_ENTRYPOINT = "/usr/local/bin/murph-crabbox-verify";
const SSH_PROVIDER = "ssh";
const SSH_TARGET = "macos";
const SSH_WORK_ROOT = "/Users/Shared/murph-crabbox";
const SSH_RUN_ROOT = `${SSH_WORK_ROOT}/runs`;
const SSH_VERIFICATION_ENTRYPOINT =
  "scripts/crabbox/run-ssh-locked-verification.sh";
const SNAPSHOT_ORIGIN = "https://github.com/cobuildwithus/murph.git";
const WORKSPACE_ARTIFACT_LOCK = "scripts/run-with-workspace-artifact-lock.mjs";
const SAFE_CRABBOX_CLI_ENVIRONMENT_NAMES = [
  "HOME",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "PATH",
  "SHELL",
  "TERM",
  "TMPDIR",
  "USER",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
];
const VALID_EXECUTORS = new Set(["auto", "local", "ssh", "crabbox"]);
const SUPPORTED_VERIFICATION_COMMANDS = new Set([
  "test:diff",
  "verify:acceptance",
]);

export function parseVerificationRequest(argv) {
  const [verificationCommand, ...commandArgs] = argv;
  if (!verificationCommand || !SUPPORTED_VERIFICATION_COMMANDS.has(verificationCommand)) {
    throw new Error(
      `Verification dispatcher supports only: ${[...SUPPORTED_VERIFICATION_COMMANDS].join(", ")}.`,
    );
  }

  return { commandArgs, verificationCommand };
}

function assertSafeBlacksmithRoutingInputs(env) {
  const leaseId = readOptionalValue(
    env.MURPH_CRABBOX_LEASE_ID,
    "MURPH_CRABBOX_LEASE_ID",
  );
  const legacyPool = readOptionalValue(
    env.MURPH_CRABBOX_POOL,
    "MURPH_CRABBOX_POOL",
  );

  if (legacyPool) {
    throw new Error(
      "Blacksmith Testbox does not use Crabbox pools; set MURPH_VERIFY_EXECUTOR=crabbox for a fresh pinned Testbox.",
    );
  }

  if (leaseId) {
    throw new Error(
      "MURPH_CRABBOX_LEASE_ID is not supported for canonical verification because an arbitrary existing lease cannot prove the organization that installed its trusted entrypoint. Use a fresh pinned Testbox run.",
    );
  }
}

export function resolveVerificationExecutor({
  env = process.env,
  isExecutorAvailable = detectExecutorStack,
} = {}) {
  const requestedExecutor = (env.MURPH_VERIFY_EXECUTOR ?? "auto").trim();
  if (!VALID_EXECUTORS.has(requestedExecutor)) {
    throw new Error("MURPH_VERIFY_EXECUTOR must be auto, local, ssh, or crabbox.");
  }

  const requiresVercelDevelopmentEnvironment = readBooleanFlag(
    env.MURPH_VERIFY_REQUIRES_VERCEL_ENV,
    "MURPH_VERIFY_REQUIRES_VERCEL_ENV",
  );

  if (env.CI || env.MURPH_CRABBOX_REMOTE === "1") {
    return { executor: "local", reason: env.CI ? "ci" : "already-remote" };
  }

  if (requiresVercelDevelopmentEnvironment) {
    if (requestedExecutor === "crabbox" || requestedExecutor === "ssh") {
      throw new Error(
        `MURPH_VERIFY_REQUIRES_VERCEL_ENV=1 cannot be combined with MURPH_VERIFY_EXECUTOR=${requestedExecutor}; remote verification never forwards Vercel development credentials.`,
      );
    }
    return { executor: "local", reason: "vercel-development-env" };
  }

  if (requestedExecutor === "local") {
    return { executor: "local", reason: "explicit" };
  }

  if (requestedExecutor === "auto") {
    return { executor: "local", reason: "auto" };
  }

  if (requestedExecutor === "crabbox") {
    assertSafeBlacksmithRoutingInputs(env);
  } else {
    readSshHostAlias(env);
  }
  if (!isExecutorAvailable(requestedExecutor)) {
    const requiredStack = requestedExecutor === "crabbox"
      ? "Crabbox and Blacksmith CLIs are"
      : "Crabbox CLI is";
    throw new Error(
      `MURPH_VERIFY_EXECUTOR=${requestedExecutor} was requested, but the ${requiredStack} unavailable.`,
    );
  }

  return { executor: requestedExecutor, reason: "explicit" };
}

export function buildLocalInvocation(request) {
  return {
    args: [
      "scripts/workspace-verify.sh",
      request.verificationCommand,
      ...request.commandArgs,
    ],
    command: "bash",
  };
}

export function buildCrabboxInvocation(request) {
  const args = [
    "run",
    "--profile",
    DEFAULT_CRABBOX_PROFILE,
    "--provider",
    BLACKSMITH_PROVIDER,
    "--blacksmith-org",
    BLACKSMITH_ORG,
    "--blacksmith-ref",
    BLACKSMITH_REF,
    "--blacksmith-workflow",
    BLACKSMITH_WORKFLOW,
    "--blacksmith-job",
    BLACKSMITH_JOB,
    "--idle-timeout",
    CRABBOX_IDLE_TIMEOUT,
    "--label",
    `murph ${request.verificationCommand}`,
    "--timing-json",
  ];

  args.push(
    "--",
    TRUSTED_CRABBOX_ENTRYPOINT,
    request.verificationCommand,
    ...request.commandArgs,
  );

  return { args, command: "crabbox" };
}

export function buildSshInvocation(request, hostAlias, repoRoot) {
  const identity = buildSshWorktreeIdentity(repoRoot);
  return {
    args: [
      "run",
      "--provider",
      SSH_PROVIDER,
      "--target",
      SSH_TARGET,
      "--static-host",
      hostAlias,
      "--static-work-root",
      identity.workRoot,
      "--full-resync",
      "--preflight",
      "--preflight-tools",
      "git,rsync,node,corepack,lockf",
      "--label",
      `murph ${request.verificationCommand}`,
      "--timing-json",
      "--",
      "/bin/sh",
      SSH_VERIFICATION_ENTRYPOINT,
      request.verificationCommand,
      ...request.commandArgs,
    ],
    command: "crabbox",
    environment: {
      CRABBOX_STATIC_ID: identity.staticId,
    },
  };
}

export function buildSshWorktreeIdentity(
  repoRoot,
  runToken = randomBytes(8).toString("hex"),
) {
  if (!/^[a-f0-9]{16}$/u.test(runToken)) {
    throw new Error("Static SSH verification run token must be 16 lowercase hex characters.");
  }
  const digest = createHash("sha256")
    .update(path.resolve(repoRoot))
    .digest("hex")
    .slice(0, 16);
  return {
    staticId: `static_murph_${digest}`,
    workRoot: `${SSH_RUN_ROOT}/${digest}-${runToken}`,
  };
}

export function buildLockedRemoteDispatcherInvocation({ request, argv }) {
  return {
    args: [
      WORKSPACE_ARTIFACT_LOCK,
      `remote ${request.verificationCommand}`,
      "--",
      "node",
      "scripts/verification-dispatch.mjs",
      ...argv,
    ],
    command: "node",
  };
}

export async function runVerification(argv, env = process.env) {
  const request = parseVerificationRequest(argv);
  const resolution = resolveVerificationExecutor({ env });
  const isRemote = resolution.executor === "crabbox" ||
    resolution.executor === "ssh";

  if (isRemote && env.MURPH_WORKSPACE_ARTIFACT_LOCK_HELD !== "1") {
    process.stderr.write(
      `[verification-dispatch] command=${request.verificationCommand} executor=${resolution.executor} reason=${resolution.reason} state=waiting-for-workspace-lock\n`,
    );
    return await runChild(
      buildLockedRemoteDispatcherInvocation({ request, argv }),
      env,
    );
  }

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const remoteInvocation = resolution.executor === "crabbox"
    ? buildCrabboxInvocation(request)
    : resolution.executor === "ssh"
      ? buildSshInvocation(request, readSshHostAlias(env), repoRoot)
      : null;
  const invocation = remoteInvocation ?? buildLocalInvocation(request);

  process.stderr.write(
    `[verification-dispatch] command=${request.verificationCommand} executor=${resolution.executor} reason=${resolution.reason}\n`,
  );

  const childEnvironment = remoteInvocation
    ? {
        ...buildCrabboxCliEnvironment(env),
        ...(remoteInvocation.environment ?? {}),
      }
    : env;
  if (!remoteInvocation) {
    return await runChild(invocation, childEnvironment);
  }

  const candidate = createRemoteCandidateSnapshot(repoRoot, childEnvironment);
  process.stderr.write(
    `[verification-dispatch] candidate-tree=${candidate.tree}\n`,
  );
  try {
    return await runChild(
      { ...invocation, cwd: candidate.root },
      childEnvironment,
    );
  } finally {
    candidate.dispose();
  }
}

export function buildCrabboxCliEnvironment(env) {
  const childEnvironment = {};
  for (const name of SAFE_CRABBOX_CLI_ENVIRONMENT_NAMES) {
    const value = env[name];
    if (value === undefined || value === "") {
      continue;
    }
    if (/[\0\r\n]/u.test(value)) {
      throw new Error(`Crabbox CLI environment ${name} must not contain control characters.`);
    }
    childEnvironment[name] = value;
  }
  if (!childEnvironment.HOME || !childEnvironment.PATH) {
    throw new Error("Crabbox CLI execution requires HOME and PATH.");
  }
  return childEnvironment;
}

export function findSensitiveRemoteSyncPaths(paths) {
  return paths.filter(isSensitiveRemoteSyncPath);
}

export function createRemoteCandidateSnapshot(
  repoRoot,
  environment = process.env,
) {
  const snapshotRoot = mkdtempSync(
    path.join(os.tmpdir(), "murph-remote-candidate-"),
  );
  try {
    // This mutable-checkout pass is a fail-fast operator guard. The frozen
    // candidate below is the authority admitted for remote execution.
    assertSafeRemoteSync(repoRoot, environment);
    const candidateCommit = createCandidateCommit(repoRoot, environment);
    const baseCommit = candidateCommit
      ? readGitValue(
          repoRoot,
          ["rev-parse", `${candidateCommit}^1`],
          environment,
          "candidate base commit",
        )
      : readGitValue(
          repoRoot,
          ["rev-parse", "HEAD"],
          environment,
          "clean candidate base commit",
        );
    const candidateTree = readGitValue(
      repoRoot,
      ["rev-parse", `${candidateCommit ?? baseCommit}^{tree}`],
      environment,
      "candidate tree",
    );
    const indexTree = candidateCommit
      ? readGitValue(
          repoRoot,
          ["rev-parse", `${candidateCommit}^2^{tree}`],
          environment,
          "candidate index tree",
        )
      : candidateTree;
    const sensitivePaths = findSensitiveRemoteSyncPaths(
      listGitPaths(
        repoRoot,
        ["ls-tree", "-r", "-z", "--name-only", candidateTree],
        environment,
      ),
    );
    if (sensitivePaths.length > 0) {
      throw new Error(renderSensitiveRemoteSyncError(sensitivePaths));
    }
    assertCandidateAdditionsMatchIndex(
      repoRoot,
      { baseCommit, candidateTree, indexTree },
      environment,
    );

    runCheckedCommand(
      "git",
      ["init", "--quiet", snapshotRoot],
      { cwd: repoRoot, env: environment },
      "initialize the remote verification candidate repository",
    );
    runCheckedCommand(
      "git",
      [
        "-C",
        snapshotRoot,
        "fetch",
        "--quiet",
        "--depth=1",
        pathToFileURL(repoRoot).href,
        baseCommit,
      ],
      { cwd: repoRoot, env: environment },
      "fetch the remote verification candidate base commit",
    );
    runCheckedCommand(
      "git",
      ["checkout", "--quiet", "--detach", "FETCH_HEAD"],
      { cwd: snapshotRoot, env: environment },
      "check out the remote verification candidate base commit",
    );
    const materializedBase = readGitValue(
      snapshotRoot,
      ["rev-parse", "HEAD"],
      environment,
      "materialized base commit",
    );
    if (materializedBase !== baseCommit) {
      throw new Error(
        "Remote verification candidate materialization did not preserve the captured base.",
      );
    }
    runCheckedCommand(
      "git",
      ["rm", "--quiet", "-r", "--force", "--ignore-unmatch", "."],
      { cwd: snapshotRoot, env: environment },
      "clear the candidate worktree before materializing its frozen tree",
    );

    const candidateIndexPath = path.join(
      snapshotRoot,
      ".git",
      "candidate-index",
    );
    const candidateIndexEnvironment = {
      ...environment,
      GIT_INDEX_FILE: candidateIndexPath,
    };
    runCheckedCommand(
      "git",
      ["read-tree", candidateTree],
      { cwd: repoRoot, env: candidateIndexEnvironment },
      "read the frozen remote verification candidate tree",
    );
    runCheckedCommand(
      "git",
      [
        "checkout-index",
        "--all",
        "--force",
        `--prefix=${snapshotRoot}${path.sep}`,
      ],
      { cwd: repoRoot, env: candidateIndexEnvironment },
      "materialize the frozen remote verification candidate tree",
    );
    rmSync(candidateIndexPath, { force: true });

    runCheckedCommand(
      "git",
      ["add", "--all", "--force"],
      { cwd: snapshotRoot, env: environment },
      "index the remote verification candidate",
    );
    const materializedTree = readGitValue(
      snapshotRoot,
      ["write-tree"],
      environment,
      "materialized candidate tree",
    );
    if (materializedTree !== candidateTree) {
      throw new Error(
        "Remote verification candidate materialization changed the admitted Git tree.",
      );
    }
    assertSafeRemoteSync(snapshotRoot, environment);
    runCheckedCommand(
      "git",
      ["remote", "add", "origin", SNAPSHOT_ORIGIN],
      { cwd: snapshotRoot, env: environment },
      "bind the remote verification candidate to its public origin",
    );

    let disposed = false;
    return {
      dispose() {
        if (disposed) {
          return;
        }
        disposed = true;
        rmSync(snapshotRoot, { force: true, recursive: true });
      },
      root: snapshotRoot,
      tree: candidateTree,
    };
  } catch (error) {
    rmSync(snapshotRoot, { force: true, recursive: true });
    throw error;
  }
}

export function assertSafeRemoteSync(repoRoot, environment = process.env) {
  const unsafeStates = findUnsafeRemoteWorktreeStates(
    readGitWorktreeStates(repoRoot, environment),
  );
  if (unsafeStates.length > 0) {
    const counts = new Map();
    for (const reason of unsafeStates) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
    const summary = [...counts.entries()]
      .map(([reason, count]) => `${reason}=${count}`)
      .join(", ");
    throw new Error(
      `Remote verification sync refused ${unsafeStates.length} unauthorized Git state${unsafeStates.length === 1 ? "" : "s"} (${summary}). Fully stage intentional new source or resolve the working-tree state before remote verification.`,
    );
  }

  const cachedPaths = listGitPaths(
    repoRoot,
    ["ls-files", "--cached", "-z"],
    environment,
  );
  const sensitivePaths = findSensitiveRemoteSyncPaths(cachedPaths);
  if (sensitivePaths.length > 0) {
    throw new Error(renderSensitiveRemoteSyncError(sensitivePaths));
  }
}

export function findUnsafeRemoteWorktreeStates(entries) {
  const unmergedStates = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
  const validIndexStatuses = new Set([" ", "M", "A", "D", "R", "C", "T"]);
  const validWorktreeStatuses = new Set([" ", "M", "D", "T"]);

  return entries.flatMap(({ indexStatus, worktreeStatus }) => {
    const state = `${indexStatus}${worktreeStatus}`;
    if (state === "??") {
      return ["untracked"];
    }
    if (unmergedStates.has(state)) {
      return ["unmerged"];
    }
    if (indexStatus === " " && worktreeStatus === "A") {
      return ["intent-to-add"];
    }
    if (
      (indexStatus === "A" || indexStatus === "C") &&
      worktreeStatus !== " "
    ) {
      return ["staged-addition-changed"];
    }
    if (
      !validIndexStatuses.has(indexStatus) ||
      !validWorktreeStatuses.has(worktreeStatus)
    ) {
      return ["unsupported"];
    }
    return [];
  });
}

export function parseGitStatusPorcelainV1Z(output) {
  const entries = [];
  let offset = 0;
  while (offset < output.length) {
    if (offset + 3 > output.length || output[offset + 2] !== " ") {
      throw new Error("Unable to parse the remote verification Git status boundary.");
    }
    const indexStatus = output[offset];
    const worktreeStatus = output[offset + 1];
    const pathEnd = output.indexOf("\0", offset + 3);
    if (pathEnd === -1) {
      throw new Error("Unable to parse the remote verification Git status boundary.");
    }
    offset = pathEnd + 1;
    if (indexStatus === "R" || indexStatus === "C") {
      const originalPathEnd = output.indexOf("\0", offset);
      if (originalPathEnd === -1) {
        throw new Error("Unable to parse the remote verification Git status boundary.");
      }
      offset = originalPathEnd + 1;
    }
    entries.push({ indexStatus, worktreeStatus });
  }
  return entries;
}

function readGitWorktreeStates(repoRoot, environment) {
  const result = spawnSync(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: environment,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new Error("Unable to inspect the remote verification sync set with git status.");
  }
  return parseGitStatusPorcelainV1Z(result.stdout);
}

function listGitPaths(repoRoot, args, environment) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: environment,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error("Unable to inspect the remote verification sync set with git ls-files.");
  }
  return result.stdout.split("\0").filter(Boolean);
}

function assertCandidateAdditionsMatchIndex(
  repoRoot,
  { baseCommit, candidateTree, indexTree },
  environment,
) {
  const baseEntries = readGitTreeEntries(repoRoot, baseCommit, environment);
  const candidateEntries = readGitTreeEntries(
    repoRoot,
    candidateTree,
    environment,
  );
  const indexEntries = readGitTreeEntries(repoRoot, indexTree, environment);
  const renamedTargets = readRenamedIndexTargets(
    repoRoot,
    baseCommit,
    indexTree,
    environment,
  );
  const partiallyStagedAdditions = [];

  for (const [filePath, candidateEntry] of candidateEntries) {
    if (baseEntries.has(filePath)) {
      continue;
    }
    if (
      indexEntries.get(filePath) === candidateEntry ||
      renamedTargets.has(filePath)
    ) {
      continue;
    }
    partiallyStagedAdditions.push(filePath);
  }

  if (partiallyStagedAdditions.length > 0) {
    throw new Error(
      "Remote verification candidate capture found a new path whose current contents were not fully staged.",
    );
  }
}

function readGitTreeEntries(repoRoot, treeish, environment) {
  const result = spawnSync(
    "git",
    ["ls-tree", "-r", "-z", "--full-tree", treeish],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: environment,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new Error("Unable to inspect the frozen remote verification Git tree.");
  }

  const entries = new Map();
  for (const record of result.stdout.split("\0")) {
    if (!record) {
      continue;
    }
    const separator = record.indexOf("\t");
    if (separator < 0) {
      throw new Error("Unable to parse the frozen remote verification Git tree.");
    }
    entries.set(record.slice(separator + 1), record.slice(0, separator));
  }
  return entries;
}

function readRenamedIndexTargets(
  repoRoot,
  baseCommit,
  indexTree,
  environment,
) {
  const result = spawnSync(
    "git",
    [
      "diff-tree",
      "--no-commit-id",
      "--name-status",
      "-r",
      "-M",
      "-z",
      baseCommit,
      indexTree,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: environment,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new Error("Unable to inspect frozen remote verification renames.");
  }

  const fields = result.stdout.split("\0");
  const renamedTargets = new Set();
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!status) {
      break;
    }
    if (status.startsWith("R")) {
      index += 1;
      const target = fields[index++];
      if (!target) {
        throw new Error("Unable to parse frozen remote verification renames.");
      }
      renamedTargets.add(target);
      continue;
    }
    if (status.startsWith("C")) {
      index += 2;
      continue;
    }
    index += 1;
  }
  return renamedTargets;
}

function createCandidateCommit(repoRoot, environment) {
  const result = spawnSync(
    "git",
    ["stash", "create", "murph remote verification candidate"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: environment,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new Error("Unable to create the remote verification candidate.");
  }
  const candidateCommit = result.stdout.trim();
  return candidateCommit || null;
}

function readGitValue(repoRoot, args, environment, description) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: environment,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Unable to inspect the remote verification ${description}.`);
  }
  const value = result.stdout.trim();
  if (!value) {
    throw new Error(`Remote verification ${description} was empty.`);
  }
  return value;
}

function runCheckedCommand(command, args, options, description) {
  const result = spawnSync(command, args, {
    ...options,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Unable to ${description}.`);
  }
}

function renderSensitiveRemoteSyncError(sensitivePaths) {
  const renderedPaths = sensitivePaths
    .slice(0, 10)
    .map((filePath) => JSON.stringify(filePath))
    .join(", ");
  const remainder = sensitivePaths.length > 10
    ? ` and ${sensitivePaths.length - 10} more`
    : "";
  return `Remote verification sync refused sensitive managed paths: ${renderedPaths}${remainder}. Ignore or remove them before remote verification.`;
}

function isSensitiveRemoteSyncPath(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  const basename = segments.at(-1) ?? "";

  if (basename === ".env.example" || basename === ".dev.vars.example") {
    return false;
  }
  if (
    basename === ".env" ||
    basename.startsWith(".env.") ||
    basename.startsWith(".dev.vars") ||
    basename.startsWith(".runner.env") ||
    basename.endsWith(".local.md") ||
    basename.endsWith(".local.png")
  ) {
    return true;
  }
  if (
    segments.some((segment) =>
      segment === ".artifacts" ||
      segment === ".crabbox" ||
      segment === ".runtime" ||
      segment === ".tmp" ||
      segment === ".vercel"
    )
  ) {
    return true;
  }
  return normalized === "agent-docs/product-ideas.md" ||
    normalized === "vault" ||
    normalized.startsWith("vault/") ||
    normalized === "research-artifacts" ||
    normalized.startsWith("research-artifacts/") ||
    normalized === "source-artifacts" ||
    normalized.startsWith("source-artifacts/");
}

function detectExecutorStack(executor) {
  const environment = buildCrabboxCliEnvironment(process.env);
  if (!isCommandAvailable("crabbox", environment)) {
    return false;
  }
  return executor !== "crabbox" || isCommandAvailable("blacksmith", environment);
}

function isCommandAvailable(command, environment) {
  const result = spawnSync(command, ["--version"], {
    env: environment,
    stdio: "ignore",
  });
  return result.status === 0;
}

function readOptionalValue(value, name) {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }
  if (/[\0\r\n]/u.test(normalized)) {
    throw new Error(`${name} must not contain control characters.`);
  }
  return normalized;
}

export function readSshHostAlias(environment) {
  const hostAlias = readOptionalValue(
    environment.MURPH_VERIFY_SSH_HOST,
    "MURPH_VERIFY_SSH_HOST",
  );
  if (!hostAlias) {
    throw new Error(
      "MURPH_VERIFY_EXECUTOR=ssh requires MURPH_VERIFY_SSH_HOST to name a dedicated host in the local SSH config.",
    );
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/u.test(hostAlias)) {
    throw new Error(
      "MURPH_VERIFY_SSH_HOST must be a safe SSH host alias containing only letters, digits, dots, underscores, and hyphens.",
    );
  }
  return hostAlias;
}

function readBooleanFlag(value, name) {
  if (value === undefined || value === "" || value === "0") {
    return false;
  }
  if (value === "1") {
    return true;
  }
  throw new Error(`${name} must be 0 or 1.`);
}

function runChild(invocation, env) {
  return new Promise((resolve, reject) => {
    const useDetachedProcessGroup = process.platform !== "win32";
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      detached: useDetachedProcessGroup,
      env,
      stdio: "inherit",
    });

    const onSigint = () => {
      signalChild(child, useDetachedProcessGroup, "SIGINT");
    };
    const onSigterm = () => {
      signalChild(child, useDetachedProcessGroup, "SIGTERM");
    };
    const onSighup = () => {
      signalChild(child, useDetachedProcessGroup, "SIGHUP");
    };
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    process.once("SIGHUP", onSighup);

    const cleanup = () => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      process.off("SIGHUP", onSighup);
    };

    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      cleanup();
      if (signal === "SIGINT") {
        resolve(130);
        return;
      }
      if (signal === "SIGHUP") {
        resolve(129);
        return;
      }
      if (signal) {
        resolve(143);
        return;
      }
      resolve(code ?? 1);
    });
  });
}

function signalChild(child, useDetachedProcessGroup, signal) {
  try {
    if (useDetachedProcessGroup && child.pid) {
      process.kill(-child.pid, signal);
      return;
    }
    child.kill(signal);
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ESRCH") {
      throw error;
    }
  }
}

function isDirectEntrypoint() {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint) && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isDirectEntrypoint()) {
  try {
    process.exitCode = await runVerification(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[verification-dispatch] ${message}\n`);
    process.exitCode = 1;
  }
}
