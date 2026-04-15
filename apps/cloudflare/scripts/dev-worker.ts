import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function normalizePnpmScriptArgs(argv: readonly string[]): string[] {
  return argv[0] === "--" ? [...argv.slice(1)] : [...argv];
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  await runPnpm(["runner:bundle"]);
  await runPnpm(["exec", "wrangler", "dev", ...normalizePnpmScriptArgs(argv)]);
}

async function runPnpm(args: string[]): Promise<void> {
  const child = spawn("pnpm", args, {
    cwd: appDir,
    env: process.env,
    stdio: "inherit",
  });

  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          signal
            ? `pnpm ${args.join(" ")} exited with signal ${signal}.`
            : `pnpm ${args.join(" ")} exited with code ${code ?? "unknown"}.`,
        ),
      );
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
