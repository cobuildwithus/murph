import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { repoRoot } from "./constants.ts";
import { runCommand, throwIfAbortSignalAborted } from "./runtime.ts";

const PREFLIGHT_TIMEOUT_MS = 30_000;

/** Only execution-location variables are needed; no hosted credentials enter this check. */
export async function preflightHostedLocalTemporalWorker(input: {
  env: NodeJS.ProcessEnv;
  packageDir: string;
  signal?: AbortSignal;
}): Promise<void> {
  throwIfAbortSignalAborted(input.signal);
  const env: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SystemRoot"]) {
    if (input.env[name] !== undefined) env[name] = input.env[name];
  }
  const signal = AbortSignal.any([
    AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS),
    ...(input.signal ? [input.signal] : []),
  ]);
  const directory = await mkdtemp(path.join(tmpdir(), "murph-temporal-preflight-"));
  try {
    const fixturesPath = path.join(directory, "fixtures.json");
    const commandOptions = { cwd: repoRoot, env, name: "setup" as const, signal };
    await runCommand(process.execPath, [
      "--import", "tsx", "scripts/temporal-compatibility-producer-fixtures.ts",
      "--output", fixturesPath,
    ], commandOptions);
    await runCommand("pnpm", [
      "--dir", input.packageDir, "temporal:check-reconciliation-compatibility",
      "--fixtures", fixturesPath,
    ], commandOptions);
  } catch (cause) {
    throwIfAbortSignalAborted(input.signal);
    throw new Error(
      "Hosted-local Temporal compatibility preflight failed. Update the external worker package and its installed dependencies; it must provide temporal:check-reconciliation-compatibility and accept this checkout's reconciliation facts. No stack services were started.",
      { cause },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
