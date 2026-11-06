import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// A fresh container pays the Codex binary's first-launch file reads on the
// first real app-server start: production `initialize` takes ~1.8s p50 on the
// first launch versus ~0.15s on a relaunch in the same container. One
// throwaway app-server `initialize` during workspace restore moves that cost
// off the member's turn. It shares nothing with real turns: scratch CODEX_HOME,
// no credentials, analytics off, no thread, killed as soon as it answers.

const HOSTED_CONTAINER_CODEX_BINARY_WARMUP_TIMEOUT_MS = 20_000;
const HOSTED_CONTAINER_CODEX_BINARY_WARMUP_EXIT_WAIT_MS = 2_000;

export type HostedContainerCodexBinaryWarmupOutcome =
  | "aborted"
  | "failed"
  | "ready"
  | "timed_out";

export async function warmHostedContainerCodexBinary(input: {
  codexCommand?: string;
  executablePath: string;
  modelCatalogJsonPath: string;
  signal: AbortSignal;
  timeoutMs?: number;
}): Promise<{ elapsedMs: number; outcome: HostedContainerCodexBinaryWarmupOutcome }> {
  const startedAt = Date.now();
  let outcome: HostedContainerCodexBinaryWarmupOutcome = "aborted";
  let scratchRoot: string | null = null;
  try {
    if (!input.signal.aborted) {
      scratchRoot = await mkdtemp(path.join(tmpdir(), "murph-codex-warmup-"));
      const codexHome = path.join(scratchRoot, "codex-home");
      await mkdir(codexHome, { mode: 0o700 });
      await writeFile(path.join(codexHome, "config.toml"), [
        `model_catalog_json = ${JSON.stringify(input.modelCatalogJsonPath)}`,
        "check_for_update_on_startup = false",
        "[analytics]",
        "enabled = false",
        "[features]",
        "plugins = false",
        "[history]",
        'persistence = "none"',
        "",
      ].join("\n"), { mode: 0o600 });
      outcome = await initializeThrowawayCodexAppServer({
        codexCommand: input.codexCommand ?? "codex",
        codexHome,
        executablePath: input.executablePath,
        scratchRoot,
        signal: input.signal,
        timeoutMs: input.timeoutMs ?? HOSTED_CONTAINER_CODEX_BINARY_WARMUP_TIMEOUT_MS,
      });
    }
  } catch {
    outcome = "failed";
  } finally {
    if (scratchRoot) {
      await rm(scratchRoot, { force: true, recursive: true }).catch(() => undefined);
    }
  }
  return { elapsedMs: Date.now() - startedAt, outcome };
}

async function initializeThrowawayCodexAppServer(input: {
  codexCommand: string;
  codexHome: string;
  executablePath: string;
  scratchRoot: string;
  signal: AbortSignal;
  timeoutMs: number;
}): Promise<HostedContainerCodexBinaryWarmupOutcome> {
  const child = spawn(input.codexCommand, ["app-server"], {
    cwd: input.scratchRoot,
    // Own process group, so one kill also reaps anything it started.
    detached: true,
    // Only what the binary needs to start: no supervisor env, no credentials.
    env: {
      CODEX_HOME: input.codexHome,
      HOME: input.scratchRoot,
      PATH: input.executablePath,
      TMPDIR: input.scratchRoot,
    },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const closed = new Promise<void>((resolve) => {
    child.once("close", () => resolve());
    child.once("error", () => resolve());
  });
  const killChild = (): void => {
    try {
      if (child.pid !== undefined) {
        process.kill(-child.pid, "SIGKILL");
      }
    } catch {
      // Already gone.
    }
  };
  process.once("exit", killChild);

  let settle: (outcome: HostedContainerCodexBinaryWarmupOutcome) => void = () => {};
  const outcome = new Promise<HostedContainerCodexBinaryWarmupOutcome>((resolve) => {
    settle = resolve;
  });
  const abort = (): void => settle("aborted");
  input.signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => settle("timed_out"), input.timeoutMs);
  timeout.unref();
  child.once("error", () => settle("failed"));
  child.once("exit", () => settle("failed"));
  child.stdin.on("error", () => settle("failed"));
  child.stdout.on("error", () => settle("failed"));
  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
    const lines = stdout.split("\n");
    stdout = lines.pop() ?? "";
    if (lines.some(isInitializeResponseLine)) {
      settle("ready");
    }
  });
  child.stdin.write(`${JSON.stringify({
    id: 1,
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      capabilities: { experimentalApi: true },
      clientInfo: { name: "murph", title: "Murph", version: "warmup" },
    },
  })}\n`);

  try {
    return await outcome;
  } finally {
    clearTimeout(timeout);
    input.signal.removeEventListener("abort", abort);
    killChild();
    await Promise.race([
      closed,
      new Promise((resolve) => {
        setTimeout(resolve, HOSTED_CONTAINER_CODEX_BINARY_WARMUP_EXIT_WAIT_MS).unref();
      }),
    ]);
    process.removeListener("exit", killChild);
  }
}

function isInitializeResponseLine(line: string): boolean {
  try {
    const parsed = JSON.parse(line) as unknown;
    return typeof parsed === "object" && parsed !== null && (parsed as { id?: unknown }).id === 1;
  } catch {
    return false;
  }
}
