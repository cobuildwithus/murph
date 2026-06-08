import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  HOSTED_RUNTIME_ENSURE_PROCESSING_TIMEOUT_MS_HEADER,
  MIN_HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS,
  type HostedExecutionWake,
} from "@murphai/hosted-execution/contracts";
import type { HostedRuntimeEnsureProcessingResponse } from "@murphai/hosted-execution/orchestration-control";
import {
  parseHostedRuntimeEnsureProcessingRequest,
  parseHostedRuntimeEnsureProcessingResponse,
} from "@murphai/hosted-execution/parsers";
import {
  buildCloudflareHostedControlRuntimeEnsureProcessingPath,
} from "@murphai/cloudflare-hosted-control/routes";
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
const HOSTED_LOCAL_RETRY_LATER_INITIAL_DELAY_MS = 250;
const HOSTED_LOCAL_RETRY_LATER_MAX_DELAY_MS = 2_000;

export async function appendHostedWakeAndWakeWorker(input: {
  environment?: NodeJS.ProcessEnv;
  wake: HostedExecutionWake;
  harness: HostedLocalDevHarness;
  timeoutMs?: number;
  userId: string;
}): Promise<{
  append: HostedMailboxAppendForTestResponse;
  wakeResult: HostedRuntimeEnsureProcessingResponse;
}> {
  const append = await appendHostedWake(input);
  const wakeResult = await wakeHostedWorkerForLatestPendingWake({
    harness: input.harness,
    timeoutMs: input.timeoutMs,
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
  timeoutMs?: number;
  userId: string;
}): Promise<HostedRuntimeEnsureProcessingResponse> {
  const timeoutMs = normalizeHostedLocalWakeTimeoutMs(input.timeoutMs);
  const path = buildCloudflareHostedControlRuntimeEnsureProcessingPath(input.userId);
  const url = new URL(path, `${input.harness.workerBaseUrl}/`);
  const requestBody = JSON.stringify(parseHostedRuntimeEnsureProcessingRequest({
    orchestrationAttemptId: `hosted-local-wake:${input.userId}`,
  }));
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    [HOSTED_EXECUTION_USER_ID_HEADER]: input.userId,
    [HOSTED_RUNTIME_ENSURE_PROCESSING_TIMEOUT_MS_HEADER]:
      String(toHostedRuntimeProcessingTimeoutHeaderMs(timeoutMs)),
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
    signal: AbortSignal.timeout(timeoutMs),
  });

  return parseHostedRuntimeEnsureProcessingResponse(await response.json());
}

export async function wakeHostedWorkerForLatestPendingWake(input: {
  harness: HostedLocalDevHarness;
  timeoutMs?: number;
  userId: string;
}): Promise<HostedRuntimeEnsureProcessingResponse> {
  const timeoutMs = normalizeHostedLocalWakeTimeoutMs(input.timeoutMs);
  const deadlineMs = Date.now() + timeoutMs;
  let lastRetryAt: string | null = null;
  let retryLaterCount = 0;

  while (true) {
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 0) {
      throw new Error(formatHostedLocalWakeTimeout(lastRetryAt));
    }

    const response = await wakeHostedWorker({
      harness: input.harness,
      timeoutMs: remainingMs,
      userId: input.userId,
    });

    if (response.kind === "runtime_processing_accepted") {
      return response;
    }

    lastRetryAt = response.retryAt;
    const retryDelayMs = computeHostedLocalRetryLaterDelayMs({
      deadlineMs,
      retryAt: response.retryAt,
      retryLaterCount,
    });
    retryLaterCount += 1;
    if (retryDelayMs <= 0) {
      continue;
    }
    await sleep(retryDelayMs);
  }
}

function normalizeHostedLocalWakeTimeoutMs(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("Hosted local wake timeoutMs must be a positive integer.");
  }
  return timeoutMs;
}

function toHostedRuntimeProcessingTimeoutHeaderMs(timeoutMs: number): number {
  return Math.max(timeoutMs, MIN_HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS);
}

function computeHostedLocalRetryLaterDelayMs(input: {
  deadlineMs: number;
  retryAt: string;
  retryLaterCount: number;
}): number {
  const remainingMs = input.deadlineMs - Date.now();
  if (remainingMs <= 0) {
    return 0;
  }

  const backoffDelayMs = Math.min(
    HOSTED_LOCAL_RETRY_LATER_MAX_DELAY_MS,
    HOSTED_LOCAL_RETRY_LATER_INITIAL_DELAY_MS * (2 ** Math.min(input.retryLaterCount, 3)),
  );
  const retryAtMs = Date.parse(input.retryAt);
  const retryAtDelayMs = Number.isFinite(retryAtMs)
    ? retryAtMs - Date.now()
    : Number.NaN;
  const retryDelayMs = Number.isFinite(retryAtDelayMs) && retryAtDelayMs > 0
    ? Math.max(
      Math.min(retryAtDelayMs, HOSTED_LOCAL_RETRY_LATER_MAX_DELAY_MS),
      backoffDelayMs,
    )
    : backoffDelayMs;

  return Math.min(
    retryDelayMs,
    remainingMs,
  );
}

function formatHostedLocalWakeTimeout(lastRetryAt: string | null): string {
  return lastRetryAt
    ? `Timed out waiting for hosted runtime processing to be accepted after retry_later at ${lastRetryAt}.`
    : "Timed out waiting for hosted runtime processing to be accepted.";
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

function formatHostedLocalWorkerControlNetworkFailure(input: {
  error: unknown;
  harness: HostedLocalDevHarness;
  method: string;
  url: string;
}): string {
  const details = [
    `${input.method} ${input.url} failed before an HTTP response was received.`,
    input.error instanceof Error ? input.error.message : String(input.error),
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
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      throw new Error(formatHostedLocalWorkerControlNetworkFailure({
        error,
        harness,
        method: init.method ?? "GET",
        url: String(url),
      }));
    }

    if (response.ok) {
      return response;
    }

    let body: string;
    try {
      body = await response.text();
    } catch (error) {
      throw new Error(formatHostedLocalWorkerControlNetworkFailure({
        error,
        harness,
        method: init.method ?? "GET",
        url: String(url),
      }));
    }
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
