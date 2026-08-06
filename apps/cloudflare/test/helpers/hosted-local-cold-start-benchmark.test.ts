import { describe, expect, it } from "vitest";

import {
  assertEstablishedR2ColdStartAttempt,
  assertSingleSuccessfulColdStartAttempt,
} from "./hosted-local-cold-start-benchmark.js";

const validRestoreBreakdown = {
  schemaVersion: 1,
  boot: { restoreWasCold: true },
  restore: {
    encryptedBytes: 128,
    objectFetchMs: 12,
    plainBytes: 512,
  },
} as const;

const validMeasuredRuntimeLogs = [
  {
    attemptId: "attempt-success",
    component: "mailbox",
    level: "info",
    phase: "wake.running",
    redactedJson: null,
  },
];

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

  it("accepts one measured cold v2 restore after setup logs were excluded", () => {
    expect(() => assertEstablishedR2ColdStartAttempt({
      expectedEncryptedBytes: 128,
      expectedPlainBytes: 512,
      runtimeLogs: validMeasuredRuntimeLogs,
      successfulAttemptId: "attempt-success",
      trace: {
        phaseBreakdown: validRestoreBreakdown,
        runtimeAttemptId: "attempt-success",
      },
    })).not.toThrow();
  });

  it("rejects a missing cold restore trace", () => {
    expect(() => assertEstablishedR2ColdStartAttempt({
      expectedEncryptedBytes: 128,
      expectedPlainBytes: 512,
      runtimeLogs: validMeasuredRuntimeLogs,
      successfulAttemptId: "attempt-success",
      trace: {
        phaseBreakdown: null,
        runtimeAttemptId: "attempt-success",
      },
    })).toThrow("did not prove a cold restore");
  });

  it("rejects a cross-attempt latency trace", () => {
    expect(() => assertEstablishedR2ColdStartAttempt({
      expectedEncryptedBytes: 128,
      expectedPlainBytes: 512,
      runtimeLogs: validMeasuredRuntimeLogs,
      successfulAttemptId: "attempt-success",
      trace: {
        phaseBreakdown: validRestoreBreakdown,
        runtimeAttemptId: "attempt-other",
      },
    })).toThrow("belongs to another runtime attempt");
  });

  it("rejects a retry inside the measured window", () => {
    expect(() => assertEstablishedR2ColdStartAttempt({
      expectedEncryptedBytes: 128,
      expectedPlainBytes: 512,
      runtimeLogs: [
        ...validMeasuredRuntimeLogs,
        {
          attemptId: "attempt-retry",
          component: "runtime",
          level: "info",
          phase: "wake.running",
          redactedJson: null,
        },
      ],
      successfulAttemptId: "attempt-success",
      trace: {
        phaseBreakdown: validRestoreBreakdown,
        runtimeAttemptId: "attempt-success",
      },
    })).toThrow("more than one runtime attempt");
  });
});
