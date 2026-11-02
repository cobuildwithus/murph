import { describe, expect, it } from "vitest";

import { HOSTED_ASSISTANT_PRE_FOREGROUND_TIMING_FIELDS, readHostedAssistantTurnTimingTrace } from "../src/hosted-runtime/turn-timing-diagnostics.ts";

function readRaw(rawEvent: Record<string, unknown>) {
  return readHostedAssistantTurnTimingTrace({
    rawEvent: {
      schema: "murph.assistant-turn-timing.v1",
      type: "assistant.turn.timing",
      turnTimingStage: "reply-dispatched",
      ...rawEvent,
    },
  });
}

describe("hosted turn timing diagnostics allowlist", () => {
  it("keeps the post-result anchor, completion state, and completion interval", () => {
    expect(readRaw({
      turnTimingFinalResponseCompletedToProviderResultMs: 12,
      turnTimingFinalResponseCompletion: "observed",
      turnTimingProviderResultAtEpochMs: 1_768_046_400_000,
    })).toMatchObject({
      turnTimingFinalResponseCompletedToProviderResultMs: 12,
      turnTimingFinalResponseCompletion: "observed",
      turnTimingProviderResultAtEpochMs: 1_768_046_400_000,
    });
  });

  it.each([
    ["negative", -1],
    ["fractional", 1.5],
    ["non-finite", Number.POSITIVE_INFINITY],
    ["string", "12"],
  ])("drops a %s anchor or interval instead of coercing it", (_label, value) => {
    const details = readRaw({
      turnTimingFinalResponseCompletedToProviderResultMs: value,
      turnTimingProviderResultAtEpochMs: value,
    });
    expect(details).not.toHaveProperty("turnTimingFinalResponseCompletedToProviderResultMs");
    expect(details).not.toHaveProperty("turnTimingProviderResultAtEpochMs");
  });

  it("drops unknown completion states and unexpected payload keys", () => {
    const details = readRaw({
      responseId: "resp-synthetic",
      turnTimingFinalResponseCompletion: "turn_completed",
      usage: { outputTokens: 3 },
    });
    expect(details).not.toHaveProperty("turnTimingFinalResponseCompletion");
    expect(details).not.toHaveProperty("responseId");
    expect(details).not.toHaveProperty("usage");
  });
});

describe("persistence child timing compatibility", () => {
  it.each(["turn-delivery-finalized", "auto-reply-outcome-committed"])(
    "reads %s with bounded numbers while retaining the original anchor",
    (stage) => {
      expect(readRaw({
        turnTimingStage: stage,
        turnTimingProviderResultAtEpochMs: 1_768_046_400_000,
        turnTimingOutboxLockWaitMs: 17.5,
        turnTimingSessionPersistenceMs: 0,
        turnTimingOutcomeArtifactsMs: 40,
        turnTimingOutboxIntentCount: 2,
        turnTimingUserPersistenceMs: -1,
        turnTimingAssistantTranscriptMs: Number.NaN,
        turnTimingReceiptFinalizationMs: "12",
        turnTimingSecret: "synthetic payload must be dropped",
      })).toEqual({
        schema: "murph.assistant-turn-timing.v1",
        type: "assistant.turn.timing",
        turnTimingStage: stage,
        turnTimingProviderResultAtEpochMs: 1_768_046_400_000,
        turnTimingOutboxLockWaitMs: 17.5,
        turnTimingSessionPersistenceMs: 0,
        turnTimingOutcomeArtifactsMs: 40,
        turnTimingOutboxIntentCount: 2,
      });
    },
  );

  it("keeps legacy records sparse instead of inventing child durations", () => {
    expect(readRaw({})).toEqual({
      schema: "murph.assistant-turn-timing.v1",
      type: "assistant.turn.timing",
      turnTimingStage: "reply-dispatched",
    });
  });
});


describe("pre-foreground timing compatibility", () => {
  it.each(HOSTED_ASSISTANT_PRE_FOREGROUND_TIMING_FIELDS)("preserves finite %s and rejects invalid values", (key) => {
    expect(readRaw({ [key]: 1.25 })).toHaveProperty(key, 1.25);
    expect(readRaw({ [key]: 0 })).toHaveProperty(key, 0);
    for (const invalid of [-1, Number.NaN, Infinity, "1", null, { ms: 1 }]) {
      expect(readRaw({ [key]: invalid })).not.toHaveProperty(key);
    }
    expect(readRaw({})).not.toHaveProperty(key);
  });

  it("keeps the existing stage and ignores unapproved fields", () => {
    expect(readRaw({
      turnTimingStage: "foreground-delivery-phase-started",
      turnTimingDeviceWakeProjectionMs: 8,
      deviceWakePayload: "synthetic private content",
    })).toEqual({
      schema: "murph.assistant-turn-timing.v1",
      type: "assistant.turn.timing",
      turnTimingStage: "foreground-delivery-phase-started",
      turnTimingDeviceWakeProjectionMs: 8,
    });
  });
});
