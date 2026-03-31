import { spawn } from "node:child_process";
import { access, readdir, rm } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HOSTED_WEB_SMOKE_DIST_DIR, createHostedWebSmokeEnvironment } from "../next-artifacts";

const requestTimeoutMs = 30_000;
const serverReadyTimeoutMs = 90_000;
const serverReadyPollIntervalMs = 250;

async function main(): Promise<void> {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const packageDir = path.resolve(scriptDir, "..");
  const repoRoot = path.resolve(packageDir, "../..");
  const distDir = path.join(packageDir, HOSTED_WEB_SMOKE_DIST_DIR);
  const port = await reserveTcpPort();
  await rm(distDir, { force: true, recursive: true });
  const child = spawn(
    "pnpm",
    [
      "--dir",
      packageDir,
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: repoRoot,
      env: createHostedWebSmokeEnvironment(process.env),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let combinedOutput = "";
  const captureChunk = (chunk: Buffer | string) => {
    combinedOutput += chunk.toString();
    if (combinedOutput.length > 24_000) {
      combinedOutput = combinedOutput.slice(-24_000);
    }
  };

  child.stdout.on("data", captureChunk);
  child.stderr.on("data", captureChunk);

  try {
    await waitForHealthyServer(port, child, () => combinedOutput);
    await assertRequestStatus(port, "GET", "/");
    await assertRequestStatus(port, "HEAD", "/");
    await assertRequestStatus(port, "GET", "/");
    await assertDevArtifacts(distDir);
  } finally {
    child.kill("SIGINT");
    await waitForChildExit(child).catch(() => {
      child.kill("SIGKILL");
    });
  }
}

async function waitForHealthyServer(
  port: number,
  child: ReturnType<typeof spawn>,
  readOutput: () => string,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < serverReadyTimeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`apps/web dev exited early with code ${child.exitCode}\n${readOutput()}`);
    }

    try {
      const response = await request(port, "GET", "/");
      if (response.statusCode === 200) {
        return;
      }
    } catch {
      // Wait for the server to finish booting.
    }

    await sleep(serverReadyPollIntervalMs);
  }

  throw new Error(`Timed out waiting for apps/web dev to boot.\n${readOutput()}`);
}

async function assertRequestStatus(
  port: number,
  method: "GET" | "HEAD",
  pathname: string,
): Promise<void> {
  const response = await request(port, method, pathname);

  if (response.statusCode !== 200) {
    throw new Error(`${method} ${pathname} returned ${response.statusCode}`);
  }
}

async function assertDevArtifacts(distDir: string): Promise<void> {
  await access(distDir);
  const artifactPaths = await listRelativePaths(distDir);
  const hasRouteTypes = artifactPaths.some((entry) => entry.endsWith("types/routes.d.ts"));
  const hasTurbopackCache = artifactPaths.some((entry) => entry.includes("turbopack"));

  if (!hasRouteTypes) {
    throw new Error(`apps/web dev smoke did not materialize route types under ${distDir}`);
  }

  if (!hasTurbopackCache) {
    throw new Error(`apps/web dev smoke did not materialize a Turbopack cache under ${distDir}`);
  }
}

async function listRelativePaths(rootDir: string, currentDir = rootDir): Promise<string[]> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const relativePaths: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, absolutePath).replace(/\\/g, "/");

    relativePaths.push(relativePath);

    if (entry.isDirectory()) {
      relativePaths.push(...await listRelativePaths(rootDir, absolutePath));
    }
  }

  return relativePaths;
}

async function request(
  port: number,
  method: "GET" | "HEAD",
  pathname: string,
): Promise<{ statusCode: number | undefined }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        method,
        path: pathname,
        port,
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve({ statusCode: response.statusCode }));
      },
    );

    req.setTimeout(requestTimeoutMs, () => {
      req.destroy(new Error(`${method} ${pathname} timed out after ${requestTimeoutMs}ms`));
    });
    req.on("error", reject);
    req.end();
  });
}

async function reserveTcpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to reserve a TCP port for apps/web dev smoke.")));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
    server.on("error", reject);
  });
}

async function waitForChildExit(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  return new Promise((resolve, reject) => {
    child.once("exit", () => resolve());
    child.once("error", reject);
  });
}

async function sleep(durationMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
