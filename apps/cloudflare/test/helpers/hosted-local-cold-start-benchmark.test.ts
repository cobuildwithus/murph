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
    replaySafeReadMaxAttempt: 1,
  },
} as const;

const validMeasuredRuntimeLogs = [
  {
    attemptId: "attempt-success",
    component: "mailbox",
    level: "info",
    phase: "import",
    redactedJson: null,
  },
] as const;

describe("hosted local cold-start benchmark integrity", () => {
  it("accepts one failure-free runtime attempt", () => {
    expect(() =>
      assertSingleSuccessfulColdStartAttempt([
        { attemptId: "attempt-success", level: "info", phase: "invoke" },
        { attemptId: "attempt-success", level: "info", phase: "idle" },
      ], "attempt-success", "1")
    ).not.toThrow();
  });

  it("rejects a failed attempt followed by a successful retry", () => {
    expect(() =>
      assertSingleSuccessfulColdStartAttempt([
        { attemptId: "attempt-failed", level: "error", phase: "invoke" },
        { attemptId: "attempt-success", level: "info", phase: "idle" },
      ], "attempt-success", "1")
    ).toThrow("failed runtime phase");
  });

  it("rejects a warning-level runtime error phase", () => {
    expect(() =>
      assertSingleSuccessfulColdStartAttempt([
        { attemptId: "attempt-success", level: "warn", phase: "error" },
        { attemptId: "attempt-success", level: "info", phase: "idle" },
      ], "attempt-success", "1")
    ).toThrow("failed runtime phase");
  });

  it("rejects multiple attempts even when failure logs are unavailable", () => {
    expect(() =>
      assertSingleSuccessfulColdStartAttempt([
        { attemptId: "attempt-retried", level: "warn", phase: "invoke" },
        { attemptId: "attempt-success", level: "info", phase: "idle" },
      ], "attempt-success", "1")
    ).toThrow("more than one runtime attempt");
  });

  it("rejects a recovered fresh generation before target-specific validation", () => {
    expect(() =>
      assertSingleSuccessfulColdStartAttempt(
        validMeasuredRuntimeLogs,
        "attempt-success",
        "2",
      )
    ).toThrow("recovered fresh runtime generation");
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
      workspaceWriteFenceGeneration: "1",
    })).not.toThrow();
  });

  it("rejects a replay-safe restore retry inside the measured attempt", () => {
    expect(() => assertEstablishedR2ColdStartAttempt({
      expectedEncryptedBytes: 128,
      expectedPlainBytes: 512,
      runtimeLogs: validMeasuredRuntimeLogs,
      successfulAttemptId: "attempt-success",
      trace: {
        phaseBreakdown: {
          ...validRestoreBreakdown,
          restore: {
            ...validRestoreBreakdown.restore,
            replaySafeReadMaxAttempt: 2,
          },
        },
        runtimeAttemptId: "attempt-success",
      },
      workspaceWriteFenceGeneration: "1",
    })).toThrow("recovered workspace snapshot restore");
  });

  it("rejects a successful runtime after an earlier fresh generation", () => {
    expect(() => assertEstablishedR2ColdStartAttempt({
      expectedEncryptedBytes: 128,
      expectedPlainBytes: 512,
      runtimeLogs: validMeasuredRuntimeLogs,
      successfulAttemptId: "attempt-success",
      trace: {
        phaseBreakdown: validRestoreBreakdown,
        runtimeAttemptId: "attempt-success",
      },
      workspaceWriteFenceGeneration: "2",
    })).toThrow("recovered fresh runtime generation");
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
      workspaceWriteFenceGeneration: "1",
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
      workspaceWriteFenceGeneration: "1",
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
          phase: "invoke",
          redactedJson: null,
        },
      ],
      successfulAttemptId: "attempt-success",
      trace: {
        phaseBreakdown: validRestoreBreakdown,
        runtimeAttemptId: "attempt-success",
      },
      workspaceWriteFenceGeneration: "1",
    })).toThrow("more than one runtime attempt");
  });
});
