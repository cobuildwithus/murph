import { describe, expect, it } from "vitest";

import { buildHostedExecutionMealPhotoCapturedWake } from "../src/builders.ts";
import { isHostedSystemWake } from "../src/contracts.ts";
import { parseHostedExecutionWake } from "../src/parsers.ts";
import { isHostedMailboxKind } from "../src/runtime-control.ts";

const CAPTURED_AT = "2026-07-12T21:15:00.000Z";
const CAPTURE_ID = "a".repeat(64);
const SHA256 = "b".repeat(64);

describe("meal-photo.captured hosted execution wake", () => {
  it("builds and parses a typed system mailbox wake", () => {
    const wake = buildHostedExecutionMealPhotoCapturedWake({
      byteLength: 1024,
      captureId: CAPTURE_ID,
      capturedAt: CAPTURED_AT,
      eventId: "meal-photo:enrollment:capture",
      mealPhotoKey: "meal_photo_opaque_key",
      memberId: "member_synthetic_001",
      occurredAt: CAPTURED_AT,
      sha256: SHA256,
    });

    expect(parseHostedExecutionWake(wake)).toEqual(wake);
    expect(isHostedSystemWake(wake)).toBe(true);
    expect(isHostedMailboxKind(wake.kind)).toBe(true);
  });

  it("rejects copied recipient state in meal capture wakes", () => {
    expect(() => parseHostedExecutionWake({
      ...buildHostedExecutionMealPhotoCapturedWake({
        byteLength: 1024,
        captureId: CAPTURE_ID,
        capturedAt: CAPTURED_AT,
        eventId: "meal-photo:enrollment:capture-with-route",
        mealPhotoKey: "meal_photo_opaque_key",
        memberId: "member_synthetic_001",
        occurredAt: CAPTURED_AT,
        sha256: SHA256,
      }),
      directRoute: {
        channel: "linq",
        threadId: "stale-route",
      },
    })).toThrow(/unsupported field "directRoute"/u);
  });

  it("rejects drifted timestamps and malformed integrity metadata", () => {
    expect(() =>
      buildHostedExecutionMealPhotoCapturedWake({
        byteLength: 1024,
        captureId: CAPTURE_ID,
        capturedAt: CAPTURED_AT,
        eventId: "meal-photo:enrollment:capture",
        mealPhotoKey: "meal_photo_opaque_key",
        memberId: "member_synthetic_001",
        occurredAt: "2026-07-12T21:16:00.000Z",
        sha256: SHA256,
      })
    ).toThrow(/occurredAt must match capturedAt/u);

    expect(() =>
      parseHostedExecutionWake({
        eventId: "meal-photo:enrollment:capture",
        kind: "meal-photo.captured",
        mealPhoto: {
          byteLength: 1024,
          captureId: "not-a-digest",
          capturedAt: CAPTURED_AT,
          mealPhotoKey: "meal_photo_opaque_key",
          sha256: SHA256,
        },
        occurredAt: CAPTURED_AT,
        userId: "member_synthetic_001",
      })
    ).toThrow(/captureId/u);
  });
});
