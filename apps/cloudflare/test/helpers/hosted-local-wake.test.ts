import { afterEach, expect, it, vi } from "vitest";

import type { HostedRuntimeEnsureExecutionResponse } from "@murphai/hosted-execution/orchestration-control";

import type { HostedLocalDevHarness } from "./hosted-local-dev-harness.js";

const ensureRuntimeExecution = vi.hoisted(() => vi.fn());

vi.mock("@murphai/cloudflare-hosted-control/client", () => ({
  createCloudflareHostedControlClient: vi.fn(() => ({
    ensureRuntimeExecution,
  })),
}));

import {
  wakeHostedWorkerForLatestPendingWake,
} from "./hosted-local-wake.ts";

afterEach(() => {
  vi.clearAllMocks();
});

it("ensures workspace execution without polling old hosted-run status", async () => {
  ensureRuntimeExecution.mockResolvedValue({
    kind: "runtime_wake_sent",
    recommendedRecheckAt: "2026-04-27T00:00:10.000Z",
    runtimeAttemptId: "runtime-attempt-test",
  } satisfies HostedRuntimeEnsureExecutionResponse);

  await expect(wakeHostedWorkerForLatestPendingWake({
    harness: {
      oidcToken: "token",
      webBaseUrl: "https://web.example.test",
      workerBaseUrl: "https://worker.example.test",
    } as HostedLocalDevHarness,
    userId: "member_local_telegram_reply_123",
  })).resolves.toEqual({
    kind: "runtime_wake_sent",
    recommendedRecheckAt: "2026-04-27T00:00:10.000Z",
    runtimeAttemptId: "runtime-attempt-test",
  });

  expect(ensureRuntimeExecution).toHaveBeenCalledWith(
    "member_local_telegram_reply_123",
    {
      orchestrationAttemptId: "hosted-local-wake:member_local_telegram_reply_123",
      reason: "nudge",
    },
  );
});
