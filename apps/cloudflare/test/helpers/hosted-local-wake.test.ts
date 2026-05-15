import { afterEach, expect, it, vi } from "vitest";

import type { HostedRunnerNudgeResult } from "@murphai/hosted-execution/runtime-control";

import type { HostedLocalDevHarness } from "./hosted-local-dev-harness.js";

const nudgeUserRunner = vi.hoisted(() => vi.fn());

vi.mock("@murphai/cloudflare-hosted-control/client", () => ({
  createCloudflareHostedControlClient: vi.fn(() => ({
    nudgeUserRunner,
  })),
}));

import {
  wakeHostedWorkerForLatestPendingWake,
} from "./hosted-local-wake.ts";

afterEach(() => {
  vi.clearAllMocks();
});

it("nudges the workspace runner without polling old hosted-run status", async () => {
  nudgeUserRunner.mockResolvedValue({
    accepted: true,
    alarmScheduled: true,
    kind: "processing-ensured",
    inFlight: false,
    leaseGeneration: "1",
    nextAlarmAt: "2026-04-27T00:00:00.000Z",
  } satisfies HostedRunnerNudgeResult);

  await expect(wakeHostedWorkerForLatestPendingWake({
    harness: {
      oidcToken: "token",
      webBaseUrl: "https://web.example.test",
      workerBaseUrl: "https://worker.example.test",
    } as HostedLocalDevHarness,
    userId: "member_local_telegram_reply_123",
  })).resolves.toEqual({
    accepted: true,
    alarmScheduled: true,
    kind: "processing-ensured",
    inFlight: false,
    leaseGeneration: "1",
    nextAlarmAt: "2026-04-27T00:00:00.000Z",
  });

  expect(nudgeUserRunner).toHaveBeenCalledWith("member_local_telegram_reply_123");
});
