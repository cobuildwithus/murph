import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildHostedExecutionMemberActivatedDispatch,
} from "@murphai/hosted-execution";

import { repoRoot } from "../vitest.shared.js";
import {
  terminateChildProcess,
  waitForHealthyHttpEndpoint,
} from "../../../scripts/dev-hosted-local/runtime.ts";

const workerPort = 8912;
const workerBaseUrl = `http://127.0.0.1:${workerPort}`;
const userId = "member_duplicate_commit_local_e2e";
const activationDispatch = buildHostedExecutionMemberActivatedDispatch({
  eventId: `member.activated:stripe.invoice.paid:${userId}:evt_duplicate_local_e2e`,
  firstContact: {
    channel: "linq",
    identityId: `linq:${userId}`,
    threadId: `thread:${userId}`,
    threadIsDirect: true,
  },
  memberId: userId,
  memberChannels: {
    email: false,
    linq: true,
    telegram: false,
  },
  occurredAt: new Date().toISOString(),
});

let workerPersistDir: string | null = null;
let workerStdout = "";
let workerStderr = "";

describe("hosted local duplicate commit e2e", () => {
  let workerChild: ChildProcess | null = null;

  beforeAll(async () => {
    workerPersistDir = await mkdtemp(path.join(os.tmpdir(), "murph-hosted-duplicate-commit-e2e-"));
    workerChild = spawn("pnpm", [
      "--dir",
      "apps/cloudflare",
      "exec",
      "wrangler",
      "dev",
      "--config",
      "./test/workers/wrangler.vitest.jsonc",
      "--ip",
      "127.0.0.1",
      "--port",
      String(workerPort),
      "--local-protocol",
      "http",
      "--persist-to",
      workerPersistDir,
    ], {
      cwd: repoRoot,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    workerChild.stdout?.setEncoding("utf8");
    workerChild.stderr?.setEncoding("utf8");
    workerChild.stdout?.on("data", (chunk: string) => {
      workerStdout += chunk;
    });
    workerChild.stderr?.on("data", (chunk: string) => {
      workerStderr += chunk;
    });

    try {
      await waitForHealthyHttpEndpoint({
        host: "127.0.0.1",
        label: "cloudflare-test-worker",
        path: "/health",
        port: workerPort,
        protocol: "http",
      });
    } catch (error) {
      throw new Error([
        error instanceof Error ? error.message : String(error),
        `stdout tail: ${tail(workerStdout)}`,
        `stderr tail: ${tail(workerStderr)}`,
      ].join("\n"));
    }
  });

  afterAll(async () => {
    if (workerChild?.pid) {
      const exitPromise = new Promise<void>((resolve) => {
        workerChild?.once("exit", () => resolve());
        setTimeout(resolve, 15_000).unref();
      });

      terminateChildProcess(workerChild, "SIGTERM");
      await exitPromise;
    }

    if (workerPersistDir) {
      await rm(workerPersistDir, { force: true, recursive: true });
    }
  });

  it("accepts a live duplicate committed activation when the assistant delivery fingerprint matches but the effect id rotates", async () => {
    await postJson("/__test/runner/pause", {
      eventId: activationDispatch.eventId,
    });

    const dispatchPromise = postJson("/__test/dispatch-with-outcome", activationDispatch);

    await waitForRunnerPauseEntry(activationDispatch.eventId);
    await postJson("/__test/seed-duplicate-commit", {
      eventId: activationDispatch.eventId,
      userId,
    });
    await postJson("/__test/runner/release", {
      eventId: activationDispatch.eventId,
    });

    const dispatchResult = await dispatchPromise;
    expect(dispatchResult).toMatchObject({
      event: {
        eventId: activationDispatch.eventId,
        state: "completed",
      },
      status: {
        lastEventId: activationDispatch.eventId,
        pendingEventCount: 0,
        retryingEventId: null,
        userId,
      },
    });

    const finalStatus = await getJson(`/__test/status?userId=${encodeURIComponent(userId)}`);
    expect(finalStatus).toMatchObject({
      lastEventId: activationDispatch.eventId,
      pendingEventCount: 0,
      retryingEventId: null,
      userId,
    });

    await postJson("/__test/runner/clear", {
      eventId: activationDispatch.eventId,
    });
  });
});

async function postJson(pathname: string, body: unknown) {
  const response = await requestJson({
    body,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
    pathname,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error([
      `POST ${pathname} failed with HTTP ${response.status}.`,
      `body: ${response.rawBody}`,
      `stdout tail: ${tail(workerStdout)}`,
      `stderr tail: ${tail(workerStderr)}`,
    ].join("\n"));
  }

  return response.json;
}

async function getJson(pathname: string) {
  const response = await requestJson({
    method: "GET",
    pathname,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error([
      `GET ${pathname} failed with HTTP ${response.status}.`,
      `body: ${response.rawBody}`,
      `stdout tail: ${tail(workerStdout)}`,
      `stderr tail: ${tail(workerStderr)}`,
    ].join("\n"));
  }

  return response.json;
}

async function waitForRunnerPauseEntry(eventId: string): Promise<void> {
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < 180_000) {
    const state = await getJson(
      `/__test/runner/pause?eventId=${encodeURIComponent(eventId)}`,
    ) as {
      entered?: boolean;
      hasRequest?: boolean;
    };

    if (state.entered === true && state.hasRequest === true) {
      return;
    }

    await sleep(250);
  }

  throw new Error([
    `Timed out waiting for the paused runner commit for ${eventId}.`,
    `stdout tail: ${tail(workerStdout)}`,
    `stderr tail: ${tail(workerStderr)}`,
  ].join("\n"));
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function requestJson(input: {
  body?: unknown;
  headers?: Record<string, string>;
  method: "GET" | "POST";
  pathname: string;
}): Promise<{
  json: unknown;
  rawBody: string;
  status: number;
}> {
  const url = new URL(input.pathname, `${workerBaseUrl}/`);

  return await new Promise((resolve, reject) => {
    const request = http.request(url, {
      agent: false,
      headers: input.headers,
      method: input.method,
    }, (response) => {
      response.setEncoding("utf8");
      let rawBody = "";
      response.on("data", (chunk: string) => {
        rawBody += chunk;
      });
      response.on("end", () => {
        try {
          resolve({
            json: rawBody.length === 0 ? null : JSON.parse(rawBody),
            rawBody,
            status: response.statusCode ?? 0,
          });
        } catch (error) {
          reject(new Error([
            `Failed to parse JSON from ${input.method} ${input.pathname}.`,
            error instanceof Error ? error.message : String(error),
            `body: ${rawBody}`,
          ].join("\n")));
        }
      });
    });

    request.on("error", reject);

    if (input.body !== undefined) {
      request.write(JSON.stringify(input.body));
    }

    request.end();
  });
}

function tail(value: string, maxChars: number = 2_000): string {
  if (value.length <= maxChars) {
    return value;
  }

  return value.slice(value.length - maxChars);
}
