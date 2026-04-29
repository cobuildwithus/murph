#!/usr/bin/env node

import { spawn } from "node:child_process";
import { watch } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const contentRoot = path.join(repoRoot, "packages", "health-commons", "content");
const generatorScript = path.join(repoRoot, "scripts", "ensure-health-commons-generated.mjs");
const debounceMs = readPositiveIntegerEnv(process.env.MURPH_HEALTH_COMMONS_WATCH_DEBOUNCE_MS, 300);
const skipInitialGenerate = process.env.MURPH_HEALTH_COMMONS_WATCH_SKIP_INITIAL === "1";

let debounceTimer = null;
let running = false;
let rerunRequested = false;
let activeChild = null;
let watcher = null;
let stopping = false;

installShutdownHandlers();

try {
  watcher = watch(contentRoot, { recursive: true }, (_eventType, fileName) => {
    if (!isMarkdownContentChange(fileName)) {
      return;
    }

    scheduleGenerate(`change: ${formatWatchFileName(fileName)}`);
  });
} catch (error) {
  console.error(formatError("Unable to watch Health Commons content markdown", error));
  process.exit(1);
}

console.error("[health-commons:watch] watching packages/health-commons/content/**/*.md");
if (skipInitialGenerate) {
  console.error("[health-commons:watch] initial generate skipped");
} else {
  void runGenerate("initial");
}

function scheduleGenerate(reason) {
  rerunRequested = true;

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void drainGenerateQueue(reason);
  }, debounceMs);
}

async function drainGenerateQueue(reason) {
  if (running || stopping) {
    return;
  }

  while (rerunRequested && !stopping) {
    rerunRequested = false;
    await runGenerate(reason);
    reason = "queued change";
  }
}

function runGenerate(reason) {
  running = true;
  console.error(`[health-commons:watch] generating (${reason})`);

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [generatorScript], {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    });

    activeChild = child;

    child.on("error", (error) => {
      activeChild = null;
      running = false;
      console.error(formatError("Health Commons generate failed to start", error));
      void drainGenerateQueue("queued change");
      resolve();
    });

    child.on("exit", (code, signal) => {
      activeChild = null;
      running = false;

      if (signal) {
        console.error(`[health-commons:watch] generate stopped by ${signal}`);
      } else if (code === 0) {
        console.error("[health-commons:watch] generate complete");
      } else {
        console.error(`[health-commons:watch] generate failed with exit code ${code ?? 1}`);
      }

      void drainGenerateQueue("queued change");
      resolve();
    });
  });
}

function isMarkdownContentChange(fileName) {
  if (fileName === null || fileName === undefined) {
    return true;
  }

  return formatWatchFileName(fileName).endsWith(".md");
}

function formatWatchFileName(fileName) {
  if (Buffer.isBuffer(fileName)) {
    return fileName.toString("utf8").replaceAll(path.sep, "/");
  }

  return String(fileName).replaceAll(path.sep, "/");
}

function installShutdownHandlers() {
  const shutdown = (signal) => {
    stopping = true;

    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    watcher?.close();

    if (activeChild && !activeChild.killed) {
      activeChild.kill(signal);
      return;
    }

    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

function readPositiveIntegerEnv(value, fallback) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatError(prefix, error) {
  const detail = error instanceof Error ? error.message : String(error);
  return `[health-commons:watch] ${prefix}: ${detail}`;
}
