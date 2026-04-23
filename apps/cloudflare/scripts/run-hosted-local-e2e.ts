import { spawn } from "node:child_process";

import { repoRoot } from "../../../scripts/dev-hosted-local/constants.ts";
import {
  cleanupHostedRunnerContainers,
} from "../../../scripts/dev-hosted-local/runtime.ts";

const hostedLocalFullStackE2eFiles = [
  "apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts",
  "apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts",
  "apps/cloudflare/test/hosted-local-telegram-first-contact-e2e.test.ts",
] as const;

async function main(): Promise<void> {
  try {
    await runVitestFiles(hostedLocalFullStackE2eFiles);
  } finally {
    await cleanupHostedRunnerContainers({
      cwd: repoRoot,
      env: process.env,
      ignoreErrors: true,
    });
  }
}

async function runVitestFiles(files: readonly string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("pnpm", [
      "exec",
      "vitest",
      "run",
      "--config",
      "apps/cloudflare/vitest.e2e.config.ts",
      ...files,
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
          ? `Hosted local full-stack e2e suite exited with signal ${signal}.`
          : `Hosted local full-stack e2e suite exited with code ${code ?? "unknown"}.`,
      ));
    });
  });
}

await main();
