import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const runnerStartupTimeoutMs = 20_000;

function sanitizeChildProcessEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const nextEnv = { ...env };
  delete nextEnv.NODE_V8_COVERAGE;
  delete nextEnv.NODE_OPTIONS;

  for (const key of Object.keys(nextEnv)) {
    if (key === "VITEST" || key.startsWith("VITEST_") || key.startsWith("C8_") || key.startsWith("NYC_")) {
      delete nextEnv[key];
    }
  }

  return nextEnv;
}

describe("runner:local", () => {
  const children: ReturnType<typeof spawn>[] = [];

  afterEach(async () => {
    await Promise.all(children.splice(0).map(stopChild));
  });

  it("starts the local runner command and serves /health", async () => {
    const port = await reservePort();
    const child = spawn("pnpm", ["--dir", "apps/cloudflare", "runner:local"], {
      cwd: repoRoot,
      env: sanitizeChildProcessEnv({
        ...process.env,
        PORT: String(port),
      }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);

    const response = await waitForHealth(`http://127.0.0.1:${port}/health`, child);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "cloudflare-hosted-runner-node",
    });
  }, runnerStartupTimeoutMs);
});

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Expected an ephemeral TCP port.");
  }

  const { port } = address;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  return port;
}

async function waitForHealth(url: string, child: ReturnType<typeof spawn>): Promise<Response> {
  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < runnerStartupTimeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`runner:local exited before becoming healthy (exit ${child.exitCode}).`);
    }

    try {
      return await fetch(url, {
        signal: AbortSignal.timeout(1_000),
      });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error(
    `runner:local did not become healthy within ${runnerStartupTimeoutMs}ms. Last error: ${sanitizeError(lastError)}`,
  );
}

async function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  child.kill("SIGINT");
  const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];

  if (code !== 0 && signal !== "SIGINT") {
    throw new Error(`runner:local exited unexpectedly during cleanup (code=${code}, signal=${signal}).`);
  }
}

function sanitizeError(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);

  return value.replaceAll(repoRoot, "<REDACTED_REPO_ROOT>");
}
