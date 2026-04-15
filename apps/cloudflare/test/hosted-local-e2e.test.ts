import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildCloudflareHostedControlUserStatusPath,
} from "@murphai/cloudflare-hosted-control/routes";
import {
  buildHostedExecutionMemberActivatedDispatch,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionDispatchResult,
  parseHostedExecutionUserStatus,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_EXECUTION_DISPATCH_PATH,
} from "@murphai/hosted-execution/routes";

import { runSmokeHostedDeploy } from "../scripts/smoke-hosted-deploy.shared.js";
import { repoRoot } from "../vitest.shared.js";
import { resolveHostedLocalDevConfig } from "../../../scripts/dev-hosted-local/config.ts";
import {
  terminateChildProcess,
  waitForHealthyHttpEndpoint,
} from "../../../scripts/dev-hosted-local/runtime.ts";
import { resolveVercelOidcToken } from "../../../scripts/dev-hosted-local/vercel.ts";

const nextEnvPath = path.join(repoRoot, "apps/web/next-env.d.ts");
const userId = `member_local_e2e_${Date.now()}`;
const activationDispatch = buildHostedExecutionMemberActivatedDispatch({
  eventId: `member.activated:local:${userId}:evt_local_e2e`,
  memberId: userId,
  memberChannels: {
    email: false,
    linq: false,
    telegram: false,
  },
  occurredAt: new Date().toISOString(),
});
const devEnv: NodeJS.ProcessEnv = {
  ...process.env,
  MURPH_DEV_SKIP_PRISMA_MIGRATE: "1",
  MURPH_DEV_WEB_PORT: "3212",
  MURPH_DEV_WORKER_PORT: "8901",
  NEXT_DIST_DIR_MODE: "smoke",
};
const devConfig = resolveHostedLocalDevConfig(devEnv);
const workerBaseUrl = `${devConfig.workerProtocol}://${devConfig.workerHost}:${devConfig.workerPort}`;
const webBaseUrl = `http://${devConfig.webHost}:${devConfig.webPort}`;
let devStdout = "";
let devStderr = "";
let oidcToken = "";
let workerPersistDir: string | null = null;
let originalNextEnvContents: string | null = null;

describe("hosted local end-to-end", () => {
  let devChild: ChildProcess | null = null;

  beforeAll(async () => {
    originalNextEnvContents = await readFile(nextEnvPath, "utf8");
    workerPersistDir = await mkdtemp(path.join(os.tmpdir(), "murph-hosted-local-e2e-"));
    const runtimeEnv: NodeJS.ProcessEnv = {
      ...devEnv,
      MURPH_DEV_CF_PERSIST_DIR: workerPersistDir,
    };
    devChild = spawn("pnpm", ["dev"], {
      cwd: repoRoot,
      detached: process.platform !== "win32",
      env: runtimeEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    devChild.stdout?.setEncoding("utf8");
    devChild.stderr?.setEncoding("utf8");
    devChild.stdout?.on("data", (chunk: string) => {
      devStdout += chunk;
    });
    devChild.stderr?.on("data", (chunk: string) => {
      devStderr += chunk;
    });

    try {
      oidcToken = await resolveVercelOidcToken(runtimeEnv);
      await Promise.all([
        waitForHealthyHttpEndpoint({
          host: devConfig.workerHost,
          label: "cloudflare",
          path: "/health",
          port: devConfig.workerPort,
          protocol: devConfig.workerProtocol,
        }),
        waitForHealthyHttpEndpoint({
          host: devConfig.webHost,
          label: "web",
          path: "/",
          port: devConfig.webPort,
          protocol: "http",
        }),
      ]);
    } catch (error) {
      throw new Error([
        error instanceof Error ? error.message : String(error),
        `stdout tail: ${tail(devStdout)}`,
        `stderr tail: ${tail(devStderr)}`,
      ].join("\n"));
    }
  });

  afterAll(async () => {
    if (devChild?.pid) {
      const exitPromise = new Promise<void>((resolve) => {
        devChild?.once("exit", () => resolve());
        setTimeout(resolve, 15_000).unref();
      });

      terminateChildProcess(devChild, "SIGTERM");

      await exitPromise;
    }

    if (originalNextEnvContents !== null) {
      await writeFile(nextEnvPath, originalNextEnvContents, "utf8");
    }

    if (workerPersistDir) {
      await rm(workerPersistDir, { force: true, recursive: true });
    }
  });

  it("bootstraps a member and completes a follow-up manual run through the live local stack", async () => {
    const activationResponse = await sendControlRequest(
      HOSTED_EXECUTION_DISPATCH_PATH,
      {
        body: JSON.stringify(activationDispatch),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      },
    );
    const activationResult = parseHostedExecutionDispatchResult(await activationResponse.json());
    expect(activationResult.event.eventId).toBe(activationDispatch.eventId);

    const activatedStatus = await waitForHostedCompletion(userId);
    expect(activatedStatus.bundleRef).not.toBeNull();
    expect(activatedStatus.lastError).toBeNull();
    expect(activatedStatus.pendingEventCount).toBe(0);

    await runSmokeHostedDeploy({
      log() {},
      source: {
        HOSTED_EXECUTION_SMOKE_OIDC_TOKEN: oidcToken,
        HOSTED_EXECUTION_SMOKE_STATUS_POLL_INTERVAL_MS: "1000",
        HOSTED_EXECUTION_SMOKE_STATUS_TIMEOUT_MS: "180000",
        HOSTED_EXECUTION_SMOKE_USER_ID: userId,
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: workerBaseUrl,
      },
    });

    const finalStatus = await readUserStatus(userId);
    expect(finalStatus.bundleRef).not.toBeNull();
    expect(finalStatus.lastError).toBeNull();
    expect(finalStatus.pendingEventCount).toBe(0);
  });

  async function sendControlRequest(routePath: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(new URL(routePath, `${workerBaseUrl}/`), {
      ...init,
      headers: {
        authorization: `Bearer ${oidcToken}`,
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error([
        `${init?.method ?? "GET"} ${routePath} failed with HTTP ${response.status}.`,
        `stdout tail: ${tail(devStdout)}`,
        `stderr tail: ${tail(devStderr)}`,
      ].join("\n"));
    }

    return response;
  }
});

async function readUserStatus(userId: string) {
  const response = await fetch(
    new URL(buildCloudflareHostedControlUserStatusPath(userId), `${workerBaseUrl}/`),
    {
      headers: {
        authorization: `Bearer ${oidcToken}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`GET status failed with HTTP ${response.status}.`);
  }

  return parseHostedExecutionUserStatus(await response.json());
}

async function waitForHostedCompletion(userId: string) {
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < 180_000) {
    const status = await readUserStatus(userId);

    if (
      status.pendingEventCount === 0
      && !status.inFlight
      && status.bundleRef !== null
      && status.lastError === null
    ) {
      return status;
    }

    await sleep(1_000);
  }

  throw new Error([
    `Timed out waiting for hosted completion for ${userId}.`,
    `stdout tail: ${tail(devStdout)}`,
    `stderr tail: ${tail(devStderr)}`,
  ].join("\n"));
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function tail(value: string, maxChars: number = 2_000): string {
  if (value.length <= maxChars) {
    return value;
  }

  return value.slice(value.length - maxChars);
}
