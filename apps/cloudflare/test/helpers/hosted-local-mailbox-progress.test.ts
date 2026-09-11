import { describe, expect, it } from "vitest";

import {
  hasImportedHostedSystemWakeStorm,
  hasSuccessfulHostedSystemContinuation,
  type HostedSystemContinuationLog,
} from "./hosted-local-mailbox-progress.ts";

describe("seeded system wake import proof", () => {
  const ready = {
    expectedImportedSeq: "8",
    redactedStatus: {
      hostedMailboxSystemImportedSeq: "8",
      hostedMailboxRetryableBlockedCount: 0,
    },
    systemLane: { importedSeq: "8", lag: "0" },
  };

  it.each(["8", "9", "100", "9007199254740993"])(
    "accepts an imported frontier at or beyond the seed: %s",
    (sequence) => {
      expect(hasImportedHostedSystemWakeStorm({
        ...ready,
        redactedStatus: { ...ready.redactedStatus, hostedMailboxSystemImportedSeq: sequence },
        systemLane: { ...ready.systemLane, importedSeq: sequence },
      })).toBe(true);
    },
  );

  it.each([undefined, null, "", "7", "-1", "8.0", "08", "invalid", 8])(
    "rejects a missing, malformed, or insufficient frontier: %s",
    (sequence) => {
      expect(hasImportedHostedSystemWakeStorm({
        ...ready,
        systemLane: { ...ready.systemLane, importedSeq: sequence },
      })).toBe(false);
      expect(hasImportedHostedSystemWakeStorm({
        ...ready,
        redactedStatus: { ...ready.redactedStatus, hostedMailboxSystemImportedSeq: sequence },
      })).toBe(false);
    },
  );

  it("compares sequence frontiers beyond safe integer precision", () => {
    expect(hasImportedHostedSystemWakeStorm({
      ...ready,
      expectedImportedSeq: "9007199254740993",
      redactedStatus: { ...ready.redactedStatus, hostedMailboxSystemImportedSeq: "9007199254740993" },
      systemLane: { ...ready.systemLane, importedSeq: "9007199254740992" },
    })).toBe(false);
  });

  it("keeps missing status, backlog, and retryable errors outside the log proof", () => {
    expect(hasImportedHostedSystemWakeStorm({ ...ready, systemLane: undefined })).toBe(false);
    expect(hasImportedHostedSystemWakeStorm({ ...ready, redactedStatus: null })).toBe(false);
    expect(hasImportedHostedSystemWakeStorm({ ...ready, redactedStatus: {} })).toBe(false);
    expect(hasImportedHostedSystemWakeStorm({
      ...ready,
      systemLane: { ...ready.systemLane, lag: "1" },
    })).toBe(false);
    expect(hasImportedHostedSystemWakeStorm({
      ...ready,
      redactedStatus: { ...ready.redactedStatus, hostedMailboxRetryableBlockedCount: 1 },
    })).toBe(false);
  });
});

describe("durable system continuation evidence after provider start", () => {
  const providerStartedAt = new Date("2026-01-01T00:00:01.000Z");
  const validLog: HostedSystemContinuationLog = {
    at: providerStartedAt.toISOString(),
    attemptId: "retained-owner",
    eventCode: "mailbox.system_processed",
    redactedJson: {
      recordFailed: 0,
      status: "recorded",
      wakeKind: "member.action.requested",
    },
  };
  const observe = (logs: HostedSystemContinuationLog[]) =>
    hasSuccessfulHostedSystemContinuation({
      expectedWakeKinds: ["member.action.requested"],
      logs,
      providerStartedAt,
    });

  it.each(["retained-owner", "successor-owner"])(
    "accepts successful same-user progress from %s",
    (attemptId) => {
      expect(observe([{ ...validLog, attemptId }])).toBe(true);
      expect(observe([{
        ...validLog,
        attemptId,
        redactedJson: { ...validLog.redactedJson, status: "processed" },
      }])).toBe(true);
    },
  );

  it("rejects absent attempts and stale or missing evidence", () => {
    expect(observe([{ ...validLog, attemptId: null }])).toBe(false);
    expect(observe([{ ...validLog, at: "2026-01-01T00:00:00.999Z" }])).toBe(false);
    expect(observe([{ ...validLog, at: "invalid" }])).toBe(false);
    expect(observe([])).toBe(false);
  });

  it("requires a seeded successful wake without recording failures", () => {
    expect(observe([{ ...validLog, eventCode: "mailbox.imported" }])).toBe(false);
    expect(observe([{ ...validLog, redactedJson: null }])).toBe(false);
    for (const change of [
      { wakeKind: "runtime.manual-requested" },
      { status: "retryable_failed" },
      { status: "recording" },
      { recordFailed: 1 },
    ]) {
      expect(observe([{
        ...validLog,
        redactedJson: { ...validLog.redactedJson, ...change },
      }])).toBe(false);
    }
  });
});
