#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const BLACKSMITH_PROVIDER = "blacksmith-testbox";
const DEFAULT_CRABBOX_PROFILE = "murph-verification";
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

export function resolveBlacksmithTarget(env) {
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
      "Blacksmith Testbox does not use Crabbox pools; set MURPH_CRABBOX_BLACKSMITH=1 for a fresh Testbox or MURPH_CRABBOX_LEASE_ID for an existing Testbox.",
    );
  }

  if (leaseId) {
    return { kind: "lease", value: leaseId };
  }
  return null;
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
    return { executor: "local", reason: env.CI ? "ci" : "already-remote", target: null };
  }

  if (requiresVercelDevelopmentEnvironment) {
    if (requestedExecutor === "crabbox") {
      throw new Error(
        "MURPH_VERIFY_REQUIRES_VERCEL_ENV=1 cannot be combined with MURPH_VERIFY_EXECUTOR=crabbox; the default Crabbox verification lane never forwards Vercel development credentials.",
      );
    }
    return { executor: "local", reason: "vercel-development-env", target: null };
  }

  if (requestedExecutor === "local") {
    return { executor: "local", reason: "explicit", target: null };
  }

  const codexThreadId = env.CODEX_THREAD_ID?.trim();
  if (requestedExecutor === "auto" && !codexThreadId) {
    return { executor: "local", reason: "non-codex", target: null };
  }

  const target = resolveBlacksmithTarget(env);
  const blacksmithEnabled = readBooleanFlag(
    env.MURPH_CRABBOX_BLACKSMITH,
    "MURPH_CRABBOX_BLACKSMITH",
  );
  if (
    requestedExecutor === "auto" &&
    !blacksmithEnabled &&
    !target
  ) {
    return { executor: "local", reason: "no-blacksmith-config", target: null };
  }
  if (!isCrabboxAvailable()) {
    if (requestedExecutor === "crabbox") {
      throw new Error(
        "MURPH_VERIFY_EXECUTOR=crabbox was requested, but the Crabbox and Blacksmith CLIs are unavailable.",
      );
    }
    return { executor: "local", reason: "crabbox-unavailable", target: null };
  }

  return {
    executor: "crabbox",
    reason: requestedExecutor === "crabbox" ? "explicit" : "codex-auto",
    target,
  };
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

export function buildCrabboxInvocation(request, target, env = process.env) {
  const profile = readOptionalValue(
    env.MURPH_CRABBOX_PROFILE,
    "MURPH_CRABBOX_PROFILE",
  ) ?? DEFAULT_CRABBOX_PROFILE;
  const args = [
    "run",
    "--profile",
    profile,
    "--provider",
    BLACKSMITH_PROVIDER,
    "--label",
    `murph ${request.verificationCommand}`,
    "--timing-json",
  ];

  if (target) {
    args.push("--id", target.value);
  }

  args.push(
    "--",
    "node",
    "scripts/crabbox/run-verification.mjs",
    request.verificationCommand,
    ...request.commandArgs,
  );

  return { args, command: "crabbox" };
}

export async function runVerification(argv, env = process.env) {
  const request = parseVerificationRequest(argv);
  const resolution = resolveVerificationExecutor({ env });
  const invocation = resolution.executor === "crabbox"
    ? buildCrabboxInvocation(request, resolution.target, env)
    : buildLocalInvocation(request);

  const targetLabel = resolution.executor === "crabbox"
    ? ` target=${resolution.target?.kind ?? "one-shot"}`
    : "";
  process.stderr.write(
    `[verification-dispatch] command=${request.verificationCommand} executor=${resolution.executor} reason=${resolution.reason}${targetLabel}\n`,
  );

  const childEnvironment = resolution.executor === "crabbox"
    ? buildCrabboxCliEnvironment(env)
    : env;
  if (resolution.executor === "crabbox") {
    assertSafeBlacksmithSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    );
  }
  return await runChild(invocation, childEnvironment);
}

export function buildCrabboxCliEnvironment(env) {
  const childEnvironment = { ...env };
  delete childEnvironment.CRABBOX_ENV_ALLOW;
  delete childEnvironment.MURPH_CRABBOX_NO_FORWARD;
  return childEnvironment;
}

export function findSensitiveBlacksmithSyncPaths(paths) {
  return paths.filter(isSensitiveBlacksmithSyncPath);
}

export function assertSafeBlacksmithSync(repoRoot) {
  const untrackedPaths = listGitPaths(
    repoRoot,
    ["ls-files", "--others", "--exclude-standard", "-z"],
  );
  if (untrackedPaths.length > 0) {
    throw new Error(
      `Blacksmith Testbox sync refused ${untrackedPaths.length} untracked non-ignored path${untrackedPaths.length === 1 ? "" : "s"}. Stage intended source files or ignore local-only files before remote verification.`,
    );
  }

  const cachedPaths = listGitPaths(repoRoot, ["ls-files", "--cached", "-z"]);
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

function listGitPaths(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
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
  return isCommandAvailable("crabbox") && isCommandAvailable("blacksmith");
}

function isCommandAvailable(command) {
  const result = spawnSync(command, ["--version"], {
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
