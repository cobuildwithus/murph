#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
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
const CRABBOX_TTL = "45m";
const TRUSTED_CRABBOX_ENTRYPOINT = "/usr/local/bin/murph-crabbox-verify";
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
const VALID_EXECUTORS = new Set(["auto", "local", "crabbox"]);
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
  isCrabboxAvailable = detectCrabboxStack,
} = {}) {
  const requestedExecutor = (env.MURPH_VERIFY_EXECUTOR ?? "auto").trim();
  if (!VALID_EXECUTORS.has(requestedExecutor)) {
    throw new Error("MURPH_VERIFY_EXECUTOR must be auto, local, or crabbox.");
  }

  const requiresVercelDevelopmentEnvironment = readBooleanFlag(
    env.MURPH_VERIFY_REQUIRES_VERCEL_ENV,
    "MURPH_VERIFY_REQUIRES_VERCEL_ENV",
  );

  if (env.CI || env.MURPH_CRABBOX_REMOTE === "1") {
    return { executor: "local", reason: env.CI ? "ci" : "already-remote" };
  }

  if (requiresVercelDevelopmentEnvironment) {
    if (requestedExecutor === "crabbox") {
      throw new Error(
        "MURPH_VERIFY_REQUIRES_VERCEL_ENV=1 cannot be combined with MURPH_VERIFY_EXECUTOR=crabbox; the default Crabbox verification lane never forwards Vercel development credentials.",
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

  assertSafeBlacksmithRoutingInputs(env);
  if (!isCrabboxAvailable()) {
    throw new Error(
      "MURPH_VERIFY_EXECUTOR=crabbox was requested, but the Crabbox and Blacksmith CLIs are unavailable.",
    );
  }

  return { executor: "crabbox", reason: "explicit" };
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
    "--ttl",
    CRABBOX_TTL,
    "--stop-after",
    "always",
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

export async function runVerification(argv, env = process.env) {
  const request = parseVerificationRequest(argv);
  const resolution = resolveVerificationExecutor({ env });
  const invocation = resolution.executor === "crabbox"
    ? buildCrabboxInvocation(request)
    : buildLocalInvocation(request);

  process.stderr.write(
    `[verification-dispatch] command=${request.verificationCommand} executor=${resolution.executor} reason=${resolution.reason}\n`,
  );

  const childEnvironment = resolution.executor === "crabbox"
    ? buildCrabboxCliEnvironment(env)
    : env;
  if (resolution.executor === "crabbox") {
    assertSafeBlacksmithSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
      childEnvironment,
    );
  }
  return await runChild(invocation, childEnvironment);
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

export function findSensitiveBlacksmithSyncPaths(paths) {
  return paths.filter(isSensitiveBlacksmithSyncPath);
}

export function assertSafeBlacksmithSync(repoRoot, environment = process.env) {
  const unsafeStates = findUnsafeBlacksmithWorktreeStates(
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
      `Blacksmith Testbox sync refused ${unsafeStates.length} unauthorized Git state${unsafeStates.length === 1 ? "" : "s"} (${summary}). Fully stage intentional new source or resolve the working-tree state before remote verification.`,
    );
  }

  const cachedPaths = listGitPaths(
    repoRoot,
    ["ls-files", "--cached", "-z"],
    environment,
  );
  const sensitivePaths = findSensitiveBlacksmithSyncPaths(cachedPaths);
  if (sensitivePaths.length > 0) {
    const renderedPaths = sensitivePaths
      .slice(0, 10)
      .map((filePath) => JSON.stringify(filePath))
      .join(", ");
    const remainder = sensitivePaths.length > 10
      ? ` and ${sensitivePaths.length - 10} more`
      : "";
    throw new Error(
      `Blacksmith Testbox sync refused sensitive managed paths: ${renderedPaths}${remainder}. Ignore or remove them before remote verification.`,
    );
  }
}

export function findUnsafeBlacksmithWorktreeStates(entries) {
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
      throw new Error("Unable to parse the Blacksmith Testbox Git status boundary.");
    }
    const indexStatus = output[offset];
    const worktreeStatus = output[offset + 1];
    const pathEnd = output.indexOf("\0", offset + 3);
    if (pathEnd === -1) {
      throw new Error("Unable to parse the Blacksmith Testbox Git status boundary.");
    }
    offset = pathEnd + 1;
    if (indexStatus === "R" || indexStatus === "C") {
      const originalPathEnd = output.indexOf("\0", offset);
      if (originalPathEnd === -1) {
        throw new Error("Unable to parse the Blacksmith Testbox Git status boundary.");
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
    throw new Error("Unable to inspect the Blacksmith Testbox sync set with git status.");
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
    throw new Error("Unable to inspect the Blacksmith Testbox sync set with git ls-files.");
  }
  return result.stdout.split("\0").filter(Boolean);
}

function isSensitiveBlacksmithSyncPath(filePath) {
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

function detectCrabboxStack() {
  const environment = buildCrabboxCliEnvironment(process.env);
  return isCommandAvailable("crabbox", environment) &&
    isCommandAvailable("blacksmith", environment);
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
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);

    const cleanup = () => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
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
