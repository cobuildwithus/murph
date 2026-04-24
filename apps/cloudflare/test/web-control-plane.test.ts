import { describe, expect, it, vi } from "vitest";

import {
  acquireHostedRunFromWeb,
  commitHostedRunToWeb,
  HostedWebControlPlaneResponseError,
  isHostedRunStaleRunnerAcquireError,
} from "../src/web-control-plane.ts";

describe("commitHostedRunToWeb", () => {
  it("rejects commit requests that omit finalizeRequired", async () => {
    const fetchImpl = vi.fn();

    await expect(
      commitHostedRunToWeb({
        baseUrl: "https://hosted.example",
        // @ts-expect-error intentional runtime-boundary check for missing finalizeRequired
        body: {
          expectedCursorVersion: "4",
          outputCommittedSeq: "25",
          preparedSnapshotRef: null,
          runId: "run-1",
          runToken: "run-token-1",
        },
        boundUserId: "user-1",
        callbackSigning: null,
        fetchImpl,
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow("Hosted run commit finalizeRequired must be provided explicitly.");

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("acquireHostedRunFromWeb", () => {
  it.each([404, 410])(
    "classifies stale missing-member acquire responses with HTTP %s as terminal runner state",
    async (status) => {
      const fetchImpl = vi.fn(async () => Response.json({
        error: {
          code: "HOSTED_RUN_STALE_RUNNER_USER",
          details: {
            boundary: "hosted-run.acquire",
            condition: "stale_runner_missing_hosted_member",
          },
          message: "Hosted runner is bound to a member that no longer exists in the hosted web database.",
          retryable: false,
        },
      }, { status }));

      let caught: unknown;
      try {
        await acquireHostedRunFromWeb({
          baseUrl: "https://hosted.example",
          boundUserId: "member_deleted",
          callbackSigning: null,
          fetchImpl,
          timeoutMs: 1_000,
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(HostedWebControlPlaneResponseError);
      expect(caught).toMatchObject({
        errorCode: "HOSTED_RUN_STALE_RUNNER_USER",
        retryable: false,
        status,
      });
      expect(isHostedRunStaleRunnerAcquireError(caught)).toBe(true);
    },
  );

  it("does not classify retryable acquire failures as stale runner state", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      error: {
        code: "HOSTED_RUN_ACQUIRE_TEMPORARILY_UNAVAILABLE",
        message: "Try again.",
        retryable: true,
      },
    }, { status: 503 }));

    let caught: unknown;
    try {
      await acquireHostedRunFromWeb({
        baseUrl: "https://hosted.example",
        boundUserId: "member_123",
        callbackSigning: null,
        fetchImpl,
        timeoutMs: 1_000,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HostedWebControlPlaneResponseError);
    expect(caught).toMatchObject({
      errorCode: "HOSTED_RUN_ACQUIRE_TEMPORARILY_UNAVAILABLE",
      retryable: true,
      status: 503,
    });
    expect(isHostedRunStaleRunnerAcquireError(caught)).toBe(false);
  });
});
