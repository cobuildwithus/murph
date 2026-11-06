import { describe, expect, it } from "vitest";

import { buildHostedExecutionMealPhotoCapturedWake } from "../src/builders.ts";
import { isHostedSystemWake } from "../src/contracts.ts";
import { parseHostedExecutionWake } from "../src/parsers.ts";
import { isHostedMailboxKind } from "../src/runtime-control.ts";

const CAPTURED_AT = "2026-07-12T21:15:00.000Z";
const CAPTURE_ID = "a".repeat(64);
const SHA256 = "b".repeat(64);

describe("meal-photo.captured hosted execution wake", () => {
  it.each([undefined, "2f1c1fdc-c7b0-4d90-b902-8e6295959243", CAPTURE_ID])("round-trips legacy and upload-linked wakes (%s)", uploadId => {
    const wake = buildHostedExecutionMealPhotoCapturedWake({
      ...(uploadId === undefined ? {} : { uploadId }),
      byteLength: 1024,
      captureId: CAPTURE_ID,
      capturedAt: CAPTURED_AT,
      directRoute: {
        channel: "linq",
        threadId: "linq_home_thread",
      },
      eventId: "meal-photo:enrollment:capture",
      mealPhotoKey: "meal_photo_opaque_key",
      memberId: "member_synthetic_001",
      occurredAt: CAPTURED_AT,
      sha256: SHA256,
    });

    expect(parseHostedExecutionWake(wake)).toEqual(wake);
    for (const invalid of [null, "", "x".repeat(129), 123]) {
      expect(() => parseHostedExecutionWake({ ...wake, mealPhoto: { ...wake.mealPhoto, uploadId: invalid } })).toThrow();
    }
    expect(isHostedSystemWake(wake)).toBe(true);
    expect(isHostedMailboxKind(wake.kind)).toBe(true);
  });

  it("rejects drifted timestamps and malformed integrity metadata", () => {
    expect(() =>
      buildHostedExecutionMealPhotoCapturedWake({
        byteLength: 1024,
        captureId: CAPTURE_ID,
        capturedAt: CAPTURED_AT,
        directRoute: {
          channel: "linq",
          threadId: "linq_home_thread",
        },
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
