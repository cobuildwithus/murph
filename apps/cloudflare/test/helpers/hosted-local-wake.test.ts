import { afterEach, expect, it, vi } from "vitest";

import {
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";

import type { HostedLocalDevHarness } from "./hosted-local-dev-harness.js";
import {
  TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
} from "../hosted-execution-fixtures.ts";
import {
  wakeHostedWorkerForLatestPendingWake,
} from "./hosted-local-wake.ts";

afterEach(() => {
  vi.clearAllMocks();
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
    reason: "nudge",
  });

  const headers = init.headers as Headers;
  expect(headers.get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe(
    "member_local_telegram_reply_123",
  );
  expect(headers.get(HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER)).toBe("v1");
  expect(headers.get(HOSTED_EXECUTION_NONCE_HEADER)).toBeTruthy();
  expect(headers.get(HOSTED_EXECUTION_SIGNATURE_HEADER)).toBeTruthy();
  expect(headers.get(HOSTED_EXECUTION_TIMESTAMP_HEADER)).toBeTruthy();
});
