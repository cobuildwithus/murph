import { afterEach, expect, it, vi } from "vitest";

import type {
  HostedExecutionCursorState,
  HostedWakeStatusResponse,
} from "@murphai/hosted-execution/contracts";

import type { HostedLocalDevHarness } from "./hosted-local-dev-harness.js";

const nudgeUserRunner = vi.hoisted(() => vi.fn());
const readHostedWakeStatusFromWeb = vi.hoisted(() => vi.fn());

vi.mock("@murphai/cloudflare-hosted-control/client", () => ({
  createCloudflareHostedControlClient: vi.fn(() => ({
    nudgeUserRunner,
  })),
}));

vi.mock("../../src/web-control-plane.ts", () => ({
  readHostedWakeStatusFromWeb,
}));

import {
  wakeHostedWorkerForLatestPendingWake,
} from "./hosted-local-wake.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("targets the latest pending wake sequence when draining hosted wakes", async () => {
  vi.useFakeTimers();

  readHostedWakeStatusFromWeb
    .mockResolvedValueOnce({
      cursor: buildCursorState("4"),
      pendingWakeCount: 1,
    } satisfies HostedWakeStatusResponse)
    .mockResolvedValueOnce({
      cursor: buildCursorState("4", "3"),
      pendingWakeCount: 0,
    } satisfies HostedWakeStatusResponse)
    .mockResolvedValueOnce({
      cursor: buildCursorState("4", "3"),
      pendingWakeCount: 0,
    } satisfies HostedWakeStatusResponse);
  const resultPromise = wakeHostedWorkerForLatestPendingWake({
    harness: {
      oidcToken: "token",
      webBaseUrl: "https://web.example.test",
      workerBaseUrl: "https://worker.example.test",
    } as HostedLocalDevHarness,
    userId: "member_local_telegram_reply_123",
  });

  await vi.advanceTimersByTimeAsync(100);

  await expect(resultPromise).resolves.toEqual({
    committedSeq: "3",
    requestedTargetSeq: "3",
    targetReached: true,
  });
  expect(nudgeUserRunner).toHaveBeenCalledWith("member_local_telegram_reply_123");
});

function buildCursorState(nextSeq: string, committedSeq = "2"): HostedExecutionCursorState {
  return {
    committedSeq,
    createdAt: "2026-04-19T08:00:00.000Z",
    nextSeq,
    snapshotRef: null,
    updatedAt: "2026-04-19T08:00:00.000Z",
    userId: "member_local_telegram_reply_123",
    version: "cursor_v1",
  };
}
