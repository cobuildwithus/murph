import { execFileSync, spawn } from "node:child_process";

import { repoRoot } from "../../../scripts/dev-hosted-local/constants.ts";
import {
  cleanupHostedRunnerContainers,
  sleep,
} from "../../../scripts/dev-hosted-local/runtime.ts";

const hostedLocalE2eFiles = [
  "apps/cloudflare/test/hosted-local-duplicate-commit-e2e.test.ts",
  "apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts",
  "apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts",
  "apps/cloudflare/test/hosted-local-telegram-first-contact-e2e.test.ts",
] as const;

const hostedLocalProcessPatterns = [
  "scripts/dev-hosted-local.ts",
  "apps/cloudflare/scripts/dev-worker.ts",
  "wrangler dev --ip 127.0.0.1 --port",
] as const;

async function main(): Promise<void> {
  for (const file of hostedLocalE2eFiles) {
    await cleanupHostedLocalProcesses();
    await runVitestFile(file);
    await cleanupHostedLocalProcesses();
  }
}

async function cleanupHostedLocalProcesses(): Promise<void> {
  for (const pattern of hostedLocalProcessPatterns) {
    terminateMatchingProcesses("-TERM", pattern);
  }

  await sleep(1_000);

  for (const pattern of hostedLocalProcessPatterns) {
    terminateMatchingProcesses("-KILL", pattern);
  }

  await cleanupHostedRunnerContainers({
    cwd: repoRoot,
    env: process.env,
    ignoreErrors: true,
  });
}

function terminateMatchingProcesses(
  signal: "-KILL" | "-TERM",
  pattern: string,
): void {
  try {
    execFileSync("pkill", [signal, "-f", pattern], {
      cwd: repoRoot,
      stdio: "ignore",
    });
  } catch {
    // pkill exits non-zero when no processes match.
  }
}

async function runVitestFile(file: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("pnpm", [
      "exec",
      "vitest",
      "run",
      "--config",
      "apps/cloudflare/vitest.e2e.config.ts",
      file,
      "--no-coverage",
    ], {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(
        signal
          ? `Hosted local e2e file ${file} exited with signal ${signal}.`
          : `Hosted local e2e file ${file} exited with code ${code ?? "unknown"}.`,
      ));
    });
  });
}

await main();
