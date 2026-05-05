#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const lockScriptPath = path.join(repoRoot, "scripts", "run-with-workspace-artifact-lock.mjs");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

if (process.env.MURPH_HEALTH_COMMONS_GENERATED_PREPARED === "1") {
  process.exit(0);
}

const result = spawnSync(
  process.execPath,
  [
    lockScriptPath,
    "health-commons generated catalog",
    "--",
    pnpmCommand,
    "--filter",
    "@murphai/health-commons",
    "generate",
  ],
  {
    cwd: repoRoot,
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
