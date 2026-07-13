import { describe, expect, it, vi } from "vitest";

import {
  createHostedPostCommitDeadline,
  waitForHostedPostCommitOperation,
} from "@/src/lib/hosted-onboarding/bounded-post-commit";

describe("hosted post-commit deadlines", () => {
  it("aborts the in-flight operation when the deadline expires", async () => {
    vi.useFakeTimers();
    try {
      let activeOperations = 0;
      let operationCalled = false;
      let operationSignal = new AbortController().signal;
      const result = waitForHostedPostCommitOperation({
        deadlineMs: createHostedPostCommitDeadline(100),
        operation: (signal) => {
          operationCalled = true;
          operationSignal = signal;
          activeOperations += 1;
          return new Promise<never>((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              activeOperations -= 1;
              reject(signal.reason);
            }, { once: true });
          });
        },
      });
      const rejected = expect(result).rejects.toMatchObject({ name: "TimeoutError" });

      await vi.advanceTimersByTimeAsync(100);

      await rejected;
      expect(operationCalled).toBe(true);
      expect(operationSignal.aborted).toBe(true);
      expect(activeOperations).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
