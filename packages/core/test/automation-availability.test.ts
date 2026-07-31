import { describe, expect, it } from "vitest";

import {
  AVAILABILITY_CONFLICT_BLOCK_END,
  AVAILABILITY_CONFLICT_BLOCK_INSTRUCTION,
  AVAILABILITY_CONFLICT_BLOCK_START,
  parseAutomationAvailabilityConflictBlock,
  readAutomationAvailabilityCalendarAuthorization,
  replaceAutomationAvailabilityConflictSnapshot,
  shouldSkipAutomationOccurrenceForAvailability,
  splitAutomationAvailabilityConflictBlock,
  stripAutomationAvailabilityConflictBlock,
} from "../src/automation-availability.ts";

const BASE_INSTRUCTIONS = [
  "Send one flexible reminder.",
  "Availability conflict policy: skip-when-busy",
  "Availability source policy: calendar-only",
  "Availability calendar account: googlecalendar / account-1",
].join("\n");

const CONFLICT_BLOCK = [
  AVAILABILITY_CONFLICT_BLOCK_START,
  "Availability conflict snapshot:",
  "- generatedAt: 2026-07-30T03:00:00.000Z",
  "- expiresAt: 2026-08-06T03:00:00.000Z",
  AVAILABILITY_CONFLICT_BLOCK_INSTRUCTION,
  "- 2026-07-30T14:00:00.000Z / 2026-07-30T15:00:00.000Z",
  "- 2026-07-31T14:00:00.000Z / 2026-07-31T15:00:00.000Z",
  AVAILABILITY_CONFLICT_BLOCK_END,
].join("\n");

describe("automation availability conflicts", () => {
  it("requires one exact flexible policy, calendar source, and account binding", () => {
    expect(
      readAutomationAvailabilityCalendarAuthorization(BASE_INSTRUCTIONS),
    ).toEqual({
      account: "account-1",
      toolkit: "googlecalendar",
    });
    expect(
      readAutomationAvailabilityCalendarAuthorization(
        BASE_INSTRUCTIONS.replace(
          "Availability conflict policy: skip-when-busy",
          "Availability conflict policy: fixed",
        ),
      ),
    ).toBeNull();
    expect(
      readAutomationAvailabilityCalendarAuthorization(
        BASE_INSTRUCTIONS.replace(
          "Availability calendar account: googlecalendar / account-1",
          "",
        ),
      ),
    ).toBeNull();
  });

  it("parses canonical bounded snapshots and strips only the owned suffix", () => {
    const instructions = `${BASE_INSTRUCTIONS}\n\n${CONFLICT_BLOCK}`;
    expect(
      parseAutomationAvailabilityConflictBlock(CONFLICT_BLOCK, {
        enforceFreshGeneratedAt: true,
        now: new Date("2026-07-30T04:00:00.000Z"),
      }),
    ).toMatchObject({
      expiresAt: "2026-08-06T03:00:00.000Z",
      generatedAt: "2026-07-30T03:00:00.000Z",
    });
    expect(stripAutomationAvailabilityConflictBlock(instructions)).toBe(
      BASE_INSTRUCTIONS,
    );
    const emptySnapshotInstructions =
      replaceAutomationAvailabilityConflictSnapshot({
      busyIntervals: [],
      expiresAt: "2026-08-06T03:00:00.000Z",
      generatedAt: "2026-07-30T03:00:00.000Z",
      instructions,
      now: new Date("2026-07-30T04:00:00.000Z"),
    });
    const emptySnapshotBlock =
      splitAutomationAvailabilityConflictBlock(emptySnapshotInstructions).block;
    expect(
      parseAutomationAvailabilityConflictBlock(emptySnapshotBlock ?? ""),
    ).toMatchObject({
      busyIntervals: [],
      generatedAt: "2026-07-30T03:00:00.000Z",
    });
  });

  it("skips only authorized occurrences inside an unexpired interval", () => {
    const instructions = `${BASE_INSTRUCTIONS}\n\n${CONFLICT_BLOCK}`;
    expect(shouldSkipAutomationOccurrenceForAvailability({
      instructions,
      occurrenceAt: "2026-07-30T14:30:00.000Z",
    })).toBe(true);
    expect(shouldSkipAutomationOccurrenceForAvailability({
      instructions,
      occurrenceAt: "2026-07-30T15:00:00.000Z",
    })).toBe(false);
    expect(shouldSkipAutomationOccurrenceForAvailability({
      instructions: instructions.replace(
        "Availability conflict policy: skip-when-busy",
        "Availability conflict policy: fixed",
      ),
      occurrenceAt: "2026-07-30T14:30:00.000Z",
    })).toBe(false);
    expect(shouldSkipAutomationOccurrenceForAvailability({
      instructions: instructions.replace(
        "Availability source policy: calendar-only",
        "Availability source policy: removed",
      ),
      occurrenceAt: "2026-07-30T14:30:00.000Z",
    })).toBe(false);
    expect(shouldSkipAutomationOccurrenceForAvailability({
      instructions,
      occurrenceAt: "2026-07-31T14:30:00.000Z",
    })).toBe(false);
  });
});
