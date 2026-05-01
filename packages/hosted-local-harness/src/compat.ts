import process from "node:process";

import { runHostedLocalCli } from "./cli.ts";

/**
 * Compatibility entrypoint for the historical root `scripts/dev-hosted-local.ts`.
 *
 * Keep this wrapper thin: the canonical surface is `hosted-local up`, and the
 * legacy script should not grow any new local-dev behavior of its own.
 */
export async function runDevHostedLocalCompatCli(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  await runHostedLocalCli(["up", ...argv], {
    env: process.env,
  });
}

/**
 * Compatibility entrypoint for `apps/cloudflare/scripts/run-hosted-local-e2e.ts`.
 *
 * The old package script prepares the hosted runner bundle before invoking this
 * file, so the compatibility default is intentionally `--no-bundle`. New callers
 * should prefer `scripts/hosted-local.ts e2e ...`, where bundle preparation is
 * owned by the harness CLI.
 */
export async function runCloudflareHostedLocalE2eCompatCli(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  await runHostedLocalCli([
    "e2e",
    ...normalizeLegacyCloudflareHostedLocalE2eArgs(argv),
  ], {
    env: process.env,
  });
}

export function normalizeLegacyCloudflareHostedLocalE2eArgs(
  argv: readonly string[],
): string[] {
  const args: string[] = [];
  let hasBundleControl = false;
  let hasScenario = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";

    if (arg === "--bundle") {
      hasBundleControl = true;
      continue;
    }

    if (arg === "--no-bundle") {
      hasBundleControl = true;
      args.push(arg);
      continue;
    }

    if (arg === "--profile") {
      args.push(arg);
      if (argv[index + 1]) {
        args.push(argv[index + 1] ?? "");
        index += 1;
      }
      continue;
    }

    args.push(arg);

    if (!arg.startsWith("-")) {
      hasScenario = true;
    }
  }

  if (!hasScenario) {
    args.unshift("all");
  }

  if (!hasBundleControl) {
    args.push("--no-bundle");
  }

  return args;
}
