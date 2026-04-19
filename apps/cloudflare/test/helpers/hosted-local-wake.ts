import {
  type HostedExecutionWakeDrainResult,
  type HostedExecutionWake,
  type HostedWakeAppendResponse,
  type HostedWakeStatusResponse,
} from "@murphai/hosted-execution/contracts";
import {
  appendHostedExecutionWakeForTest,
} from "#hosted-web-testing";

import { createCloudflareHostedControlClient } from "@murphai/cloudflare-hosted-control/client";

import { TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON } from "../hosted-execution-fixtures.js";
import { readHostedWakeStatusFromWeb } from "../../src/web-control-plane.ts";
import type { HostedLocalDevHarness } from "./hosted-local-dev-harness.js";

const DEFAULT_HOSTED_WEB_CALLBACK_SIGNING_KEY_ID = "v1";
const DEFAULT_TIMEOUT_MS = 120_000;
const HOSTED_LOCAL_WORKER_RESTART_BODY = "Your worker restarted mid-request.";
const HOSTED_LOCAL_WORKER_RESTART_MAX_RETRIES = 4;

export async function appendHostedWakeAndWakeWorker(input: {
  environment?: NodeJS.ProcessEnv;
  wake: HostedExecutionWake;
  harness: HostedLocalDevHarness;
  timeoutMs?: number;
  userId: string;
}): Promise<{
  append: HostedWakeAppendResponse;
  wakeResult: HostedExecutionWakeDrainResult;
}> {
  const append = await appendHostedWake(input);
  const wakeResult = await wakeHostedWorker({
    harness: input.harness,
    targetSeqHint: append.wake.seq,
    userId: input.userId,
  });

  return {
    append,
    wakeResult,
  };
}

export async function appendHostedWake(input: {
  environment?: NodeJS.ProcessEnv;
  wake: HostedExecutionWake;
  harness: HostedLocalDevHarness;
  timeoutMs?: number;
  userId: string;
}): Promise<HostedWakeAppendResponse> {
  return await appendHostedExecutionWakeForTest({
    environment: input.environment,
    wake: input.wake,
  });
}

function createHostedLocalCloudflareControlClient(
  harness: HostedLocalDevHarness,
) {
  return createCloudflareHostedControlClient({
    allowHttpLocalhost: true,
    baseUrl: harness.workerBaseUrl,
    fetchImpl: async (input, init) => {
      for (let attempt = 0; attempt <= HOSTED_LOCAL_WORKER_RESTART_MAX_RETRIES; attempt += 1) {
        const response = await fetch(input, init);

        if (response.ok) {
          return response;
        }

        const body = await response.text();
        if (
          shouldRetryHostedLocalWorkerRestart({
            attempt,
            body,
            status: response.status,
          })
        ) {
          await sleep(250 * (attempt + 1));
          continue;
        }

        throw new Error(formatHostedLocalWorkerControlFailure({
          body,
          harness,
          method: init?.method ?? "GET",
          status: response.status,
          url: String(input),
        }));
      }

      throw new Error(formatHostedLocalWorkerControlFailure({
        body: "Exceeded local worker restart retries.",
        harness,
        method: init?.method ?? "GET",
        status: 503,
        url: String(input),
      }));
    },
    getBearerToken: async () => harness.oidcToken,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
}

export async function wakeHostedWorker(input: {
  harness: HostedLocalDevHarness;
  targetSeqHint?: string | null;
  userId: string;
}): Promise<HostedExecutionWakeDrainResult> {
  await createHostedLocalCloudflareControlClient(input.harness).nudgeUserRunner(input.userId);

  const targetSeqHint = input.targetSeqHint ?? null;
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < DEFAULT_TIMEOUT_MS) {
    const status = await readHostedWakeStatus(input);
    const targetReached = targetSeqHint === null
      ? status.pendingWakeCount === 0
      : BigInt(status.cursor.committedSeq) >= BigInt(targetSeqHint);

    if (targetReached) {
      return {
        committedSeq: status.cursor.committedSeq,
        requestedTargetSeq: targetSeqHint,
        targetReached: true,
      };
    }

    await sleep(100);
  }

  const status = await readHostedWakeStatus(input);
  return {
    committedSeq: status.cursor.committedSeq,
    requestedTargetSeq: targetSeqHint,
    targetReached: targetSeqHint === null
      ? status.pendingWakeCount === 0
      : BigInt(status.cursor.committedSeq) >= BigInt(targetSeqHint),
  };
}

export async function wakeHostedWorkerForLatestPendingWake(input: {
  harness: HostedLocalDevHarness;
  timeoutMs?: number;
  userId: string;
}): Promise<HostedExecutionWakeDrainResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();
  let lastResult: HostedExecutionWakeDrainResult | null = null;

  while ((Date.now() - startedAt) < timeoutMs) {
    const status = await readHostedWakeStatus(input);

    if (status.pendingWakeCount > 0) {
      const targetSeqHint = deriveLatestPendingWakeSeq(status);
      lastResult = await wakeHostedWorker({
        harness: input.harness,
        targetSeqHint,
        userId: input.userId,
      });
      await sleep(100);
      continue;
    }

    if (lastResult) {
      return lastResult;
    }

    await sleep(100);
  }

  if (lastResult) {
    return lastResult;
  }

  return await wakeHostedWorker({
    harness: input.harness,
    userId: input.userId,
  });
}

function deriveLatestPendingWakeSeq(status: HostedWakeStatusResponse): string {
  const latestPendingSeq = BigInt(status.cursor.nextSeq) - 1n;
  return latestPendingSeq.toString();
}

async function readHostedWakeStatus(input: {
  harness: HostedLocalDevHarness;
  userId: string;
}): Promise<HostedWakeStatusResponse> {
  return await readHostedWakeStatusFromWeb({
    baseUrl: input.harness.webBaseUrl,
    boundUserId: input.userId,
    callbackSigning: {
      keyId: DEFAULT_HOSTED_WEB_CALLBACK_SIGNING_KEY_ID,
      privateKeyJwkJson: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
    },
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
}

function formatHostedLocalWorkerControlFailure(input: {
  body: string;
  harness: HostedLocalDevHarness;
  method: string;
  status: number;
  url: string;
}): string {
  const details = [
    `${input.method} ${input.url} failed with HTTP ${input.status}.`,
    `body: ${input.body}`,
  ];
  const stdout = input.harness.stdoutTail();
  const stderr = input.harness.stderrTail();

  if (stdout) {
    details.push(`stdout:\n${stdout}`);
  }

  if (stderr) {
    details.push(`stderr:\n${stderr}`);
  }

  return details.join("\n\n");
}

function shouldRetryHostedLocalWorkerRestart(input: {
  attempt: number;
  body: string;
  status: number;
}): boolean {
  return input.status === 503
    && input.body.includes(HOSTED_LOCAL_WORKER_RESTART_BODY)
    && input.attempt < HOSTED_LOCAL_WORKER_RESTART_MAX_RETRIES;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
