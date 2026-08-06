import { describe, expect, it } from "vitest";

import {
  assertSingleSuccessfulColdStartAttempt,
} from "./hosted-local-cold-start-benchmark.js";

describe("hosted local cold-start benchmark integrity", () => {
  it("accepts one failure-free runtime attempt", () => {
    expect(() =>
      assertSingleSuccessfulColdStartAttempt([
        { attemptId: "attempt-success", level: "info", phase: "started" },
        { attemptId: "attempt-success", level: "info", phase: "completed" },
      ], "attempt-success")
    ).not.toThrow();
  });

  it("rejects a failed attempt followed by a successful retry", () => {
    expect(() =>
      assertSingleSuccessfulColdStartAttempt([
        { attemptId: "attempt-failed", level: "error", phase: "failed" },
        { attemptId: "attempt-success", level: "info", phase: "completed" },
      ], "attempt-success")
    ).toThrow("failed runtime phase");
  });

  it("rejects multiple attempts even when failure logs are unavailable", () => {
    expect(() =>
      assertSingleSuccessfulColdStartAttempt([
        { attemptId: "attempt-retried", level: "warn", phase: "started" },
        { attemptId: "attempt-success", level: "info", phase: "completed" },
      ], "attempt-success")
    ).toThrow("more than one runtime attempt");
  });
});
