import { afterEach, expect, it, vi } from "vitest";

import {
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
  HOSTED_RUNTIME_ENSURE_PROCESSING_TIMEOUT_MS_HEADER,
} from "@murphai/hosted-execution/contracts";
import type { HostedRuntimeEnsureProcessingResponse } from "@murphai/hosted-execution/orchestration-control";

import type { HostedLocalDevHarness } from "./hosted-local-dev-harness.js";
import {
  TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
} from "../hosted-execution-fixtures.ts";
import {
  wakeHostedWorkerForLatestPendingWake,
} from "./hosted-local-wake.ts";

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("ensures workspace processing through the signed callback-only control route", async () => {
  const fetchMock = vi.fn(async () => Response.json({
    action: "woken",
    kind: "runtime_processing_accepted",
    recommendedRecheckAt: "2026-04-27T00:00:10.000Z",
    runtimeAttemptId: "runtime-attempt-test",
  }));
  vi.stubGlobal("fetch", fetchMock);

  await expect(wakeHostedWorkerForLatestPendingWake({
    harness: {
      runtimeEnv: {
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK:
          TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      },
      stderrTail: () => "",
      stdoutTail: () => "",
      workerBaseUrl: "https://worker.example.test",
    } as HostedLocalDevHarness,
    timeoutMs: 5_000,
    userId: "member_local_telegram_reply_123",
  })).resolves.toEqual({
    action: "woken",
    kind: "runtime_processing_accepted",
    recommendedRecheckAt: "2026-04-27T00:00:10.000Z",
    runtimeAttemptId: "runtime-attempt-test",
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
  expect(String(url)).toBe(
    "https://worker.example.test/internal/users/member_local_telegram_reply_123/runtime/ensure-processing",
  );
  expect(init.method).toBe("POST");
  expect(JSON.parse(String(init.body))).toEqual({
    orchestrationAttemptId: "hosted-local-wake:member_local_telegram_reply_123",
  });

  const headers = init.headers as Headers;
  expect(headers.get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe(
    "member_local_telegram_reply_123",
  );
  expect(headers.get(HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER)).toBe("v1");
  expect(headers.get(HOSTED_EXECUTION_NONCE_HEADER)).toBeTruthy();
  expect(headers.get(HOSTED_EXECUTION_SIGNATURE_HEADER)).toBeTruthy();
  expect(headers.get(HOSTED_EXECUTION_TIMESTAMP_HEADER)).toBeTruthy();
  const commandTimeoutMs = Number(
    headers.get(HOSTED_RUNTIME_ENSURE_PROCESSING_TIMEOUT_MS_HEADER),
  );
  expect(Number.isFinite(commandTimeoutMs)).toBe(true);
  expect(commandTimeoutMs).toBeGreaterThan(0);
  expect(commandTimeoutMs).toBeLessThanOrEqual(5_000);
});

it("retries retry_later responses until processing is accepted", async () => {
  const retryAt = new Date(Date.now() - 1_000).toISOString();
  const acceptedResponse: HostedRuntimeEnsureProcessingResponse = {
    action: "woken",
    kind: "runtime_processing_accepted",
    recommendedRecheckAt: "2026-04-27T00:00:10.000Z",
    runtimeAttemptId: "runtime-attempt-test",
  };
  const responses: HostedRuntimeEnsureProcessingResponse[] = [
    {
      kind: "retry_later",
      retryAt,
    },
    {
      kind: "retry_later",
      retryAt,
    },
    acceptedResponse,
  ];
  const fetchMock = vi.fn(async () => {
    const response = responses.shift();
    if (!response) {
      throw new Error("Unexpected hosted local wake request.");
    }
    return Response.json(response);
  });
  vi.stubGlobal("fetch", fetchMock);

  await expect(wakeHostedWorkerForLatestPendingWake({
    harness: {
      runtimeEnv: {
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK:
          TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      },
      stderrTail: () => "",
      stdoutTail: () => "",
      workerBaseUrl: "https://worker.example.test",
    } as HostedLocalDevHarness,
    timeoutMs: 5_000,
    userId: "member_local_retry_123",
  })).resolves.toEqual(acceptedResponse);

  expect(fetchMock).toHaveBeenCalledTimes(3);
  for (const call of fetchMock.mock.calls) {
    const [url, init] = call as [URL, RequestInit];
    expect(String(url)).toBe(
      "https://worker.example.test/internal/users/member_local_retry_123/runtime/ensure-processing",
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      orchestrationAttemptId: "hosted-local-wake:member_local_retry_123",
    });

    const headers = init.headers as Headers;
    expect(headers.get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe(
      "member_local_retry_123",
    );
    expect(headers.get(HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER)).toBe("v1");
    expect(headers.get(HOSTED_EXECUTION_NONCE_HEADER)).toBeTruthy();
    expect(headers.get(HOSTED_EXECUTION_SIGNATURE_HEADER)).toBeTruthy();
    expect(headers.get(HOSTED_EXECUTION_TIMESTAMP_HEADER)).toBeTruthy();
    const commandTimeoutMs = Number(
      headers.get(HOSTED_RUNTIME_ENSURE_PROCESSING_TIMEOUT_MS_HEADER),
    );
    expect(Number.isFinite(commandTimeoutMs)).toBe(true);
    expect(commandTimeoutMs).toBeGreaterThan(0);
    expect(commandTimeoutMs).toBeLessThanOrEqual(5_000);
  }
});

it("backs off stale retry_later responses instead of spinning requests", async () => {
  const retryAt = new Date(Date.now() - 1_000).toISOString();
  const acceptedResponse: HostedRuntimeEnsureProcessingResponse = {
    action: "woken",
    kind: "runtime_processing_accepted",
    recommendedRecheckAt: "2026-04-27T00:00:10.000Z",
    runtimeAttemptId: "runtime-attempt-test",
  };
  const responses: HostedRuntimeEnsureProcessingResponse[] = [
    {
      kind: "retry_later",
      retryAt,
    },
    acceptedResponse,
  ];
  const fetchMock = vi.fn(async () => {
    const response = responses.shift();
    if (!response) {
      throw new Error("Unexpected hosted local wake request.");
    }
    return Response.json(response);
  });
  vi.stubGlobal("fetch", fetchMock);

  const wakePromise = wakeHostedWorkerForLatestPendingWake({
    harness: {
      runtimeEnv: {
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK:
          TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      },
      stderrTail: () => "",
      stdoutTail: () => "",
      workerBaseUrl: "https://worker.example.test",
    } as HostedLocalDevHarness,
    timeoutMs: 5_000,
    userId: "member_local_retry_backoff_123",
  });

  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await expect(wakePromise).resolves.toEqual(acceptedResponse);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("stops retrying retry_later responses when the wake timeout expires", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
  const retryAt = new Date(Date.now() + 60_000).toISOString();
  const fetchMock = vi.fn(async () => Response.json({
    kind: "retry_later",
    retryAt,
  }));
  vi.stubGlobal("fetch", fetchMock);

  const wakePromise = wakeHostedWorkerForLatestPendingWake({
    harness: {
      runtimeEnv: {
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK:
          TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      },
      stderrTail: () => "",
      stdoutTail: () => "",
      workerBaseUrl: "https://worker.example.test",
    } as HostedLocalDevHarness,
    timeoutMs: 50,
    userId: "member_local_timeout_123",
  });
  const expectedRejection = expect(wakePromise).rejects.toThrow(
    `Timed out waiting for hosted runtime processing to be accepted after retry_later at ${retryAt}.`,
  );

  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(50);
  await expectedRejection;

  expect(fetchMock).toHaveBeenCalledTimes(1);
});
