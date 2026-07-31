import { describe, expect, it } from "vitest";

import {
  buildHostedExecutionEnvironmentVoiceCapturedWake,
} from "../src/builders.ts";
import { isHostedSystemWake } from "../src/contracts.ts";
import { parseHostedExecutionWake } from "../src/parsers.ts";
import { isHostedMailboxKind } from "../src/runtime-control.ts";

const CAPTURED_AT = "2026-07-30T12:00:00.000Z";
const CAPTURE_ID = "a".repeat(64);
const SHA256 = "b".repeat(64);

describe("environment-voice.captured hosted execution wake", () => {
  it("builds and parses a bounded typed system mailbox wake", () => {
    const wake = buildHostedExecutionEnvironmentVoiceCapturedWake({
      audioKey: "c".repeat(40),
      byteLength: 64_000,
      captureId: CAPTURE_ID,
      capturedAt: CAPTURED_AT,
      contentType: "audio/webm",
      durationMs: 120_000,
      eventId: `environment-voice:${CAPTURE_ID}`,
      memberId: "member_synthetic_001",
      occurredAt: CAPTURED_AT,
      sha256: SHA256,
    });

    expect(parseHostedExecutionWake(wake)).toEqual(wake);
    expect(isHostedSystemWake(wake)).toBe(true);
    expect(isHostedMailboxKind(wake.kind)).toBe(true);
  });

  it("rejects unsupported formats and duration drift", () => {
    expect(() =>
      parseHostedExecutionWake({
        environmentVoice: {
          audioKey: "c".repeat(40),
          byteLength: 64_000,
          captureId: CAPTURE_ID,
          capturedAt: CAPTURED_AT,
          contentType: "audio/wav",
          durationMs: 120_000,
          sha256: SHA256,
        },
        eventId: `environment-voice:${CAPTURE_ID}`,
        kind: "environment-voice.captured",
        occurredAt: CAPTURED_AT,
        userId: "member_synthetic_001",
      })
    ).toThrow(/contentType/u);

    expect(() =>
      parseHostedExecutionWake(
        buildHostedExecutionEnvironmentVoiceCapturedWake({
          audioKey: "c".repeat(40),
          byteLength: 64_000,
          captureId: CAPTURE_ID,
          capturedAt: CAPTURED_AT,
          contentType: "audio/webm",
          durationMs: 180_001,
          eventId: `environment-voice:${CAPTURE_ID}`,
          memberId: "member_synthetic_001",
          occurredAt: CAPTURED_AT,
          sha256: SHA256,
        }),
      )
    ).toThrow(/durationMs/u);
  });
});
