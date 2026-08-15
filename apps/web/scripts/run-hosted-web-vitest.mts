import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { hostedWebVitestProjectSpecs } from "../vitest-project-specs.mjs";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(appDir, "../..");
const testDir = path.join(appDir, "test");

function hasExplicitProject(args: readonly string[]): boolean {
  return args.some((arg) => arg === "--project" || arg.startsWith("--project="));
}

function resolveCandidatePaths(fileArg: string, cwd: string): Set<string> {
  if (path.isAbsolute(fileArg)) {
    return new Set([path.normalize(fileArg)]);
  }

  return new Set([
    path.resolve(cwd, fileArg),
    path.resolve(repoRoot, fileArg),
    path.resolve(appDir, fileArg),
    path.resolve(testDir, fileArg),
  ]);
}

export function resolveHostedWebVitestProject(
  callerArgs: readonly string[],
  cwd = process.cwd(),
): string | undefined {
  if (hasExplicitProject(callerArgs)) {
    return undefined;
  }

  const fileArgs = callerArgs.filter(
    (arg) => !arg.startsWith("-") && /\.test\.(?:ts|tsx)$/u.test(arg),
  );
  // A file-shaped token after an option may be that option's value rather
  // than a positional test filter. Stay broad unless the exact file is the
  // first argument and no second file-shaped token makes the intent ambiguous.
  if (fileArgs.length !== 1 || callerArgs[0] !== fileArgs[0]) {
    return undefined;
  }

  const candidatePaths = resolveCandidatePaths(fileArgs[0], cwd);

  for (const { fileNames, name } of hostedWebVitestProjectSpecs) {
    if (
      fileNames.some((fileName) =>
        candidatePaths.has(path.resolve(testDir, fileName))
      )
    ) {
      return name;
    }
  }

  return undefined;
}

export function buildHostedWebVitestArgs(
  callerArgs: readonly string[],
  cwd = process.cwd(),
): string[] {
  const normalizedCallerArgs = callerArgs[0] === "--"
    ? callerArgs.slice(1)
    : [...callerArgs];
  const args = [
    "run",
    "--config",
    "apps/web/vitest.workspace.ts",
    "--no-coverage",
  ];
  const project = resolveHostedWebVitestProject(normalizedCallerArgs, cwd);

  if (project) {
    args.push("--project", project);
  }

  args.push(...normalizedCallerArgs);
  return args;
}

async function runHostedWebVitest(callerArgs: readonly string[]): Promise<number> {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(
    command,
    ["exec", "vitest", ...buildHostedWebVitestArgs(callerArgs)],
    {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    },
  );

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (status) => resolve(status ?? 1));
  });
}

async function main(): Promise<void> {
  try {
    process.exitCode = await runHostedWebVitest(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[hosted-web-vitest] ${message}`);
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (entryPath === import.meta.url) {
  void main();
}
