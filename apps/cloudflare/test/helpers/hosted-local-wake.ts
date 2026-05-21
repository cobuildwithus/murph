import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedExecutionWake,
} from "@murphai/hosted-execution/contracts";
import type { HostedRuntimeEnsureExecutionResponse } from "@murphai/hosted-execution/orchestration-control";
import {
  parseHostedRuntimeEnsureExecutionRequest,
  parseHostedRuntimeEnsureExecutionResponse,
} from "@murphai/hosted-execution/parsers";
import {
  appendHostedExecutionWakeForTest,
  type HostedMailboxAppendForTestResponse,
} from "#hosted-web-testing";

import type { HostedLocalDevHarness } from "./hosted-local-dev-harness.js";
import {
  createHostedWebCallbackSignatureHeaders,
  readHostedWebCallbackSigningEnvironment,
} from "../../src/web-callback-auth.ts";

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

export async function wakeHostedWorker(input: {
  harness: HostedLocalDevHarness;
  userId: string;
}): Promise<HostedRuntimeEnsureExecutionResponse> {
  const path = `/internal/users/${encodeURIComponent(input.userId)}/runtime/ensure-execution`;
  const url = new URL(path, `${input.harness.workerBaseUrl}/`);
  const requestBody = JSON.stringify(parseHostedRuntimeEnsureExecutionRequest({
    orchestrationAttemptId: `hosted-local-wake:${input.userId}`,
    reason: "nudge",
  }));
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    [HOSTED_EXECUTION_USER_ID_HEADER]: input.userId,
  });
  const callbackSigning = readHostedWebCallbackSigningEnvironment(
    input.harness.workerRuntimeEnv ?? input.harness.runtimeEnv,
  );
  const signatureHeaders = await createHostedWebCallbackSignatureHeaders({
    environment: callbackSigning,
    method: "POST",
    path: url.pathname,
    payload: requestBody,
    search: url.search,
    userId: input.userId,
  });
  for (const [key, value] of Object.entries(signatureHeaders)) {
    headers.set(key, value);
  }

  const response = await fetchHostedLocalWorkerControl(input.harness, url, {
    body: requestBody,
    headers,
    method: "POST",
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  return parseHostedRuntimeEnsureExecutionResponse(await response.json());
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

async function fetchHostedLocalWorkerControl(
  harness: HostedLocalDevHarness,
  url: URL,
  init: RequestInit,
): Promise<Response> {
  for (let attempt = 0; attempt <= HOSTED_LOCAL_WORKER_RESTART_MAX_RETRIES; attempt += 1) {
    const response = await fetch(url, init);

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
      method: init.method ?? "GET",
      status: response.status,
      url: String(url),
    }));
  }

  throw new Error(formatHostedLocalWorkerControlFailure({
    body: "Exceeded local worker restart retries.",
    harness,
    method: init.method ?? "GET",
    status: 503,
    url: String(url),
  }));
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
