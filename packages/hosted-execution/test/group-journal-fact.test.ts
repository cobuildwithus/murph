import { describe, expect, it } from "vitest";

import {
  buildHostedExecutionGroupJournalFactRecordedWake,
} from "../src/builders.ts";
import { isHostedSystemWake } from "../src/contracts.ts";
import { parseHostedExecutionWake } from "../src/parsers.ts";
import { isHostedMailboxKind } from "../src/runtime-control.ts";

describe("journal.group-fact.recorded hosted execution wake", () => {
  it("builds and parses one bounded private Journal fact", () => {
    const input = {
      eventId: "group_journal_synthetic_001",
      journalFact: {
        date: "2026-08-31",
        factIndex: 1,
        note: "Worked in the yard for two hours.",
        noteType: "journal-factor",
        title: "Yard work",
      },
      memberId: "member_synthetic_001",
      occurredAt: "2026-08-31T18:00:00.000Z",
    } as const;
    const expectedWake = {
      eventId: input.eventId,
      journalFact: input.journalFact,
      kind: "journal.group-fact.recorded",
      occurredAt: input.occurredAt,
      userId: input.memberId,
    } as const;

    expect(buildHostedExecutionGroupJournalFactRecordedWake(input))
      .toEqual(expectedWake);
    expect(parseHostedExecutionWake(expectedWake)).toEqual(expectedWake);
    expect(isHostedSystemWake(expectedWake)).toBe(true);
    expect(isHostedMailboxKind(expectedWake.kind)).toBe(true);
  });

  it("rejects extra fields and invalid note types", () => {
    const base = {
      eventId: "group_journal_synthetic_001",
      kind: "journal.group-fact.recorded",
      occurredAt: "2026-08-31T18:00:00.000Z",
      userId: "member_synthetic_001",
    } as const;
    expect(() => parseHostedExecutionWake({
      ...base,
      journalFact: {
        date: "2026-08-31",
        factIndex: 1,
        note: "Worked in the yard.",
        noteType: "private-note",
        title: "Yard work",
      },
    })).toThrow(/note type is invalid/u);
    expect(() => parseHostedExecutionWake({
      ...base,
      journalFact: {
        date: "2026-08-31",
        extra: true,
        factIndex: 1,
        note: "Worked in the yard.",
        noteType: "journal-factor",
        title: "Yard work",
      },
    })).toThrow(/invalid fields/u);
  });
});
