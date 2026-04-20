import { afterEach, expect, it, vi } from "vitest";

import type {
  HostedExecutionCursorState,
  HostedExecutionWakeDrainResult,
  HostedWakeStatusResponse,
} from "@murphai/hosted-execution/contracts";

import type { HostedLocalDevHarness } from "./hosted-local-dev-harness.js";

const wakeUser = vi.hoisted(() => vi.fn());
const readHostedWakeStatusFromWeb = vi.hoisted(() => vi.fn());

vi.mock("@murphai/cloudflare-hosted-control/client", () => ({
  createCloudflareHostedControlClient: vi.fn(() => ({
    wakeUser,
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
      pendingIngressEventCount: 1,
    } satisfies HostedWakeStatusResponse)
    .mockResolvedValueOnce({
      cursor: buildCursorState("4"),
      pendingIngressEventCount: 0,
    } satisfies HostedWakeStatusResponse);
  wakeUser.mockResolvedValue({
    committedSeq: "4",
    requestedTargetSeq: "3",
    targetReached: true,
  } satisfies HostedExecutionWakeDrainResult);

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
    committedSeq: "4",
    requestedTargetSeq: "3",
    targetReached: true,
  });
  expect(wakeUser).toHaveBeenCalledWith(
    "member_local_telegram_reply_123",
    {
      targetCommittedSeqHint: "3",
    },
  );
});

function buildCursorState(nextSeq: string): HostedExecutionCursorState {
  return {
    committedSeq: "2",
    createdAt: "2026-04-19T08:00:00.000Z",
    nextSeq,
    snapshotRef: null,
    updatedAt: "2026-04-19T08:00:00.000Z",
    userId: "member_local_telegram_reply_123",
    version: "cursor_v1",
  };
}
