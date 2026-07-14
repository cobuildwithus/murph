#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const lanes = new Set(["package", "web", "workspace-build", "watch"]);
const budgetFlags = new Set([
  "--builders",
  "--checkers",
  "--singlethreaded",
]);

/**
 * @param {string[]} argv
 * @returns {{ lane: "package" | "web" | "workspace-build" | "watch", args: string[] }}
 */
export function parseTypeScriptRunnerArgs(argv) {
  const [lane, ...args] = argv;

  if (!lane || !lanes.has(lane)) {
    throw new Error(
      "Usage: run-typescript.mjs <package|web|workspace-build|watch> [tsc args...]",
    );
  }

  if (args[0] === "--") {
    throw new Error("Pass TypeScript arguments directly without a leading -- separator.");
  }

  return { lane, args };
}

/**
 * @param {"package" | "web" | "workspace-build" | "watch"} lane
 * @param {string[]} callerArgs
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @returns {{
 *   args: string[];
 *   budget: {
 *     lane: "package" | "web" | "workspace-build" | "watch";
 *     profile: "default" | "shared";
 *     mode: "checkers" | "single-threaded";
 *     checkers: number | null;
 *     builders: number | null;
 *   };
 * }}
 */
export function buildTypeScriptInvocation(lane, callerArgs, env = {}) {
  if (!lanes.has(lane)) {
    throw new Error(`Unknown TypeScript lane: ${lane}`);
  }

  rejectCallerBudgetFlags(callerArgs);
  const sharedProfile = readSharedProfile(env.MURPH_VERIFY_SHARED_HOST);
  const profile = sharedProfile ? "shared" : "default";
  const args = [...callerArgs];
  let mode = "checkers";
  let checkers = null;
  let builders = null;

  if (lane === "package") {
    mode = readPackageMode(env.MURPH_TSC_PACKAGE_MODE);

    if (mode === "single-threaded") {
      if (env.MURPH_TSC_PACKAGE_CHECKERS !== undefined) {
        throw new Error(
          "MURPH_TSC_PACKAGE_CHECKERS cannot be set when MURPH_TSC_PACKAGE_MODE=single-threaded.",
        );
      }
      args.push("--singleThreaded");
      checkers = 1;
      builders = containsBuildFlag(callerArgs) ? 1 : null;
    } else {
      checkers = readOptionalPositiveInteger(
        "MURPH_TSC_PACKAGE_CHECKERS",
        env.MURPH_TSC_PACKAGE_CHECKERS,
      ) ?? (sharedProfile ? 1 : null);
      if (checkers !== null) {
        args.push("--checkers", String(checkers));
      }
    }

    if (
      mode === "checkers"
      && sharedProfile
      && containsBuildFlag(callerArgs)
    ) {
      builders = 1;
      args.push("--builders", "1");
    }
  } else if (lane === "web") {
    checkers = readOptionalPositiveInteger(
      "MURPH_TSC_WEB_CHECKERS",
      env.MURPH_TSC_WEB_CHECKERS,
    ) ?? (sharedProfile ? 2 : null);
    if (checkers !== null) {
      args.push("--checkers", String(checkers));
    }
  } else if (lane === "workspace-build") {
    builders = readOptionalPositiveInteger(
      "MURPH_TSC_BUILDERS",
      env.MURPH_TSC_BUILDERS,
    ) ?? (sharedProfile ? 2 : null);
    checkers = readOptionalPositiveInteger(
      "MURPH_TSC_BUILD_CHECKERS",
      env.MURPH_TSC_BUILD_CHECKERS,
    ) ?? (sharedProfile ? 1 : null);
    if (builders !== null) {
      args.push("--builders", String(builders));
    }
    if (checkers !== null) {
      args.push("--checkers", String(checkers));
    }
  } else {
    checkers = readOptionalPositiveInteger(
      "MURPH_TSC_WEB_WATCH_CHECKERS",
      env.MURPH_TSC_WEB_WATCH_CHECKERS,
    ) ?? 1;
    args.push("--checkers", String(checkers));
  }

  return {
    args,
    budget: { lane, profile, mode, checkers, builders },
  };
}

/**
 * @param {{
 *   lane: "package" | "web" | "workspace-build" | "watch";
 *   profile: "default" | "shared";
 *   mode: "checkers" | "single-threaded";
 *   checkers: number | null;
 *   builders: number | null;
 * }} budget
 */
export function formatTypeScriptBudget(budget) {
  const parts = [
    "[typescript]",
    `lane=${budget.lane}`,
    `profile=${budget.profile}`,
    `mode=${budget.mode}`,
    `checkers=${budget.checkers ?? "default"}`,
  ];

  if (budget.lane === "package" || budget.lane === "workspace-build") {
    parts.push(`builders=${budget.builders ?? "default"}`);
  }

  return parts.join(" ");
}

/**
 * @param {string} [repoRoot]
 * @returns {{ compilerPath: string, version: string }}
 */
export function resolveRootTypeScriptCompiler(repoRoot = defaultRepoRoot) {
  const requireFromRoot = createRequire(path.join(repoRoot, "package.json"));
  const packageJsonPath = requireFromRoot.resolve("typescript/package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const version = packageJson.version;
  const compilerRelativePath = typeof packageJson.bin === "string"
    ? packageJson.bin
    : packageJson.bin?.tsc;

  if (typeof version !== "string" || !/^7(?:\.|$)/.test(version)) {
    throw new Error(`The root TypeScript compiler must be version 7; found ${version ?? "unknown"}.`);
  }
  if (typeof compilerRelativePath !== "string" || compilerRelativePath.length === 0) {
    throw new Error("The root TypeScript package does not declare a tsc binary.");
  }

  return {
    compilerPath: path.resolve(path.dirname(packageJsonPath), compilerRelativePath),
    version,
  };
}

/** @param {string[]} args */
export function containsBuildFlag(args) {
  return args.some((arg) => arg === "-b" || arg.toLowerCase() === "--build");
}

/** @param {string[]} args */
function rejectCallerBudgetFlags(args) {
  for (const arg of args) {
    const flag = arg.split("=", 1)[0]?.toLowerCase();
    if (flag && budgetFlags.has(flag)) {
      throw new Error(
        `${arg} is managed by run-typescript.mjs; configure the selected lane with MURPH_TSC_* variables.`,
      );
    }
  }
}

/** @param {string | undefined} value */
function readSharedProfile(value) {
  if (value === undefined || value === "0") {
    return false;
  }
  if (value === "1") {
    return true;
  }
  throw new Error("MURPH_VERIFY_SHARED_HOST must be 0 or 1 when set.");
}

/** @param {string | undefined} value */
function readPackageMode(value) {
  if (value === undefined || value === "checkers") {
    return "checkers";
  }
  if (value === "single-threaded") {
    return value;
  }
  throw new Error(
    "MURPH_TSC_PACKAGE_MODE must be checkers or single-threaded when set.",
  );
}

/**
 * @param {string} name
 * @param {string | undefined} value
 */
function readOptionalPositiveInteger(name, value) {
  if (value === undefined) {
    return null;
  }
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a safe positive integer.`);
  }
  return parsed;
}

async function main() {
  try {
    const invocation = parseTypeScriptRunnerArgs(process.argv.slice(2));
    const configured = buildTypeScriptInvocation(
      invocation.lane,
      invocation.args,
      process.env,
    );
    const compiler = resolveRootTypeScriptCompiler();

    if (process.env.MURPH_TSC_BUDGET_ANNOUNCED !== "1") {
      console.error(formatTypeScriptBudget(configured.budget));
    }

    const result = await runCompiler(
      compiler.compilerPath,
      configured.args,
    );

    if (result.signal) {
      process.kill(process.pid, result.signal);
      return 1;
    }
    return result.status ?? 1;
  } catch (error) {
    console.error(
      `[typescript] ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

/**
 * @param {string} compilerPath
 * @param {string[]} args
 * @returns {Promise<{ status: number | null, signal: NodeJS.Signals | null }>}
 */
function runCompiler(compilerPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [compilerPath, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    const forwardedSignals = ["SIGINT", "SIGTERM", "SIGHUP"];
    const forwarders = forwardedSignals.map((signal) => {
      const forward = () => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill(signal);
        }
      };
      process.once(signal, forward);
      return [signal, forward];
    });
    const cleanUp = () => {
      for (const [signal, forward] of forwarders) {
        process.off(signal, forward);
      }
    };

    child.once("error", (error) => {
      cleanUp();
      reject(error);
    });
    child.once("exit", (status, signal) => {
      cleanUp();
      resolve({ status, signal });
    });
  });
}

const entryPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (entryPath === import.meta.url) {
  process.exit(await main());
}
