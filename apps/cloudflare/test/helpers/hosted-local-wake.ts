import type { HostedExecutionWake } from "@murphai/hosted-execution/contracts";
import type { HostedRuntimeEnsureExecutionResponse } from "@murphai/hosted-execution/orchestration-control";
import {
  appendHostedExecutionWakeForTest,
  type HostedMailboxAppendForTestResponse,
} from "#hosted-web-testing";

import { createCloudflareHostedControlClient } from "@murphai/cloudflare-hosted-control/client";

import type { HostedLocalDevHarness } from "./hosted-local-dev-harness.js";

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
  append: HostedMailboxAppendForTestResponse;
  wakeResult: HostedRuntimeEnsureExecutionResponse;
}> {
  const append = await appendHostedWake(input);
  const wakeResult = await wakeHostedWorker({
    harness: input.harness,
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
}): Promise<HostedMailboxAppendForTestResponse> {
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
  userId: string;
}): Promise<HostedRuntimeEnsureExecutionResponse> {
  return await createHostedLocalCloudflareControlClient(input.harness)
    .ensureRuntimeExecution(input.userId, {
      orchestrationAttemptId: `hosted-local-wake:${input.userId}`,
      reason: "nudge",
    });
}

export async function wakeHostedWorkerForLatestPendingWake(input: {
  harness: HostedLocalDevHarness;
  timeoutMs?: number;
  userId: string;
}): Promise<HostedRuntimeEnsureExecutionResponse> {
  void input.timeoutMs;
  return await wakeHostedWorker({
    harness: input.harness,
    userId: input.userId,
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
