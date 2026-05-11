import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  markHostedBrowserVaultRefreshFailed,
  readHostedBrowserVaultRefreshState,
} from "@murphai/assistant-runtime";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";

import {
  createHostedRunnerChildLauncherDirectories,
  createHostedRunnerChildProcessEnv,
  resolveHostedRunnerTsxImportSpecifier,
} from "../runner-child-launcher.ts";

const BROWSER_VAULT_BACKGROUND_MAX_MS = 30_000;

export interface BrowserVaultBackgroundRefreshInput {
  internalWorkerProxyToken: string;
  localInternalProxyBaseUrl: string | null;
  userId: string;
  vaultRoot: string;
}

interface BrowserVaultBackgroundRefreshActive {
  abortController: AbortController;
  child: ChildProcess;
  timeout: ReturnType<typeof setTimeout>;
  userId: string;
}

export class BrowserVaultBackgroundRefreshManager {
  private active: BrowserVaultBackgroundRefreshActive | null = null;
  private generation = 0;

  abort(reason: string): void {
    this.generation += 1;
    const active = this.active;
    if (!active) {
      return;
    }
    clearTimeout(active.timeout);
    active.abortController.abort(new Error(reason));
    this.active = null;
  }

  async scheduleIfDirty(input: BrowserVaultBackgroundRefreshInput): Promise<void> {
    if (!input.internalWorkerProxyToken) {
      return;
    }
    const generation = this.generation;
    if (!(await browserVaultRefreshStateAllowsSchedule(input.vaultRoot))) {
      return;
    }
    if (generation !== this.generation) {
      return;
    }
    if (this.active?.userId === input.userId) {
      return;
    }
    this.abort("browser-vault background refresh superseded");
    const nextGeneration = this.generation;
    const active = await startBackgroundRefreshChild(
      input,
      () => nextGeneration === this.generation,
    );
    if (!active) {
      return;
    }
    if (nextGeneration !== this.generation) {
      clearTimeout(active.timeout);
      active.abortController.abort(new Error("browser-vault background refresh superseded before start"));
      return;
    }
    active.child.once("close", () => {
      clearTimeout(active.timeout);
      if (this.active === active) {
        this.active = null;
      }
    });
    this.active = active;
  }
}

async function startBackgroundRefreshChild(
  input: BrowserVaultBackgroundRefreshInput,
  shouldStart: () => boolean,
): Promise<BrowserVaultBackgroundRefreshActive | null> {
  const childEntry = resolveBrowserVaultBackgroundChildEntry();
  const isTypeScriptChild = childEntry.endsWith(".ts");
  const launcherRoot = path.dirname(path.resolve(input.vaultRoot));
  const launcherDirectories = await createHostedRunnerChildLauncherDirectories(launcherRoot);
  if (!shouldStart()) {
    return null;
  }
  const child = spawn(
    process.execPath,
    isTypeScriptChild
      ? ["--import", resolveHostedRunnerTsxImportSpecifier(), childEntry]
      : [childEntry],
    {
      cwd: launcherRoot,
      detached: process.platform !== "win32",
      env: createHostedRunnerChildProcessEnv({
        forwardedEnv: {},
        isTypeScriptChild,
        launcherDirectories,
      }),
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort(new Error("browser-vault background refresh timed out"));
    void markHostedBrowserVaultRefreshFailed({ vaultRoot: input.vaultRoot })
      .catch(() => undefined);
  }, BROWSER_VAULT_BACKGROUND_MAX_MS);
  abortController.signal.addEventListener("abort", () => {
    terminateChildProcess(child.pid);
    child.kill("SIGKILL");
  }, { once: true });
  child.once("close", () => {
    if (abortController.signal.aborted) {
      return;
    }
    abortController.abort(new Error("browser-vault background refresh child exited"));
  });
  child.once("error", (error) => {
    emitHostedExecutionStructuredLog({
      component: "container",
      error,
      level: "warn",
      message: "Hosted browser-vault background refresh child failed to start.",
      phase: "container.ready",
      userId: input.userId,
    });
  });
  child.stdin?.end(JSON.stringify(input));
  return {
    abortController,
    child,
    timeout,
    userId: input.userId,
  };
}

async function browserVaultRefreshStateAllowsSchedule(vaultRoot: string): Promise<boolean> {
  try {
    const state = await readHostedBrowserVaultRefreshState({ vaultRoot });
    if (!state.dirty) {
      return false;
    }
    return !state.nextAttemptAt || Date.parse(state.nextAttemptAt) <= Date.now();
  } catch {
    return false;
  }
}

function resolveBrowserVaultBackgroundChildEntry(): string {
  const builtPath = fileURLToPath(new URL("./background-child.js", import.meta.url));
  if (existsSync(builtPath)) {
    return builtPath;
  }
  return fileURLToPath(new URL("./background-child.ts", import.meta.url));
}

function terminateChildProcess(pid: number | undefined): void {
  if (typeof pid !== "number" || process.platform === "win32") {
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // best-effort abort only
  }
}
