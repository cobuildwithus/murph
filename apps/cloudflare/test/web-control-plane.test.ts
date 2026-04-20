import { describe, expect, it, vi } from "vitest";

import { commitHostedRunToWeb } from "../src/web-control-plane.ts";

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
