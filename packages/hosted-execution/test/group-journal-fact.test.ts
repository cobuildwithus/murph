import { describe, expect, it } from "vitest";

import { buildHostedExecutionGroupJournalFactRecordedWake } from "../src/builders.ts";
import { isHostedSystemWake } from "../src/contracts.ts";
import { parseHostedExecutionWake } from "../src/parsers.ts";
import {
  parseHostedRuntimeGroupToolRequest,
  parseHostedRuntimeGroupToolResponse,
} from "../src/parsers/runtime-control.ts";
import { isHostedMailboxKind } from "../src/runtime-control.ts";

const origin = {
  assistantInputId: `ain_${"a".repeat(32)}`,
  kind: "accepted_input",
  sessionId: "session-group",
} as const;

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

    expect(buildHostedExecutionGroupJournalFactRecordedWake(input)).toEqual(
      expectedWake,
    );
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
    expect(() =>
      parseHostedExecutionWake({
        ...base,
        journalFact: {
          date: "2026-08-31",
          factIndex: 1,
          note: "Worked in the yard.",
          noteType: "private-note",
          title: "Yard work",
        },
      }),
    ).toThrow(/note type is invalid/u);
    expect(() =>
      parseHostedExecutionWake({
        ...base,
        journalFact: {
          date: "2026-08-31",
          extra: true,
          factIndex: 1,
          note: "Worked in the yard.",
          noteType: "journal-factor",
          title: "Yard work",
        },
      }),
    ).toThrow(/invalid fields/u);
  });
});

describe("group Journal runtime-control wire", () => {
  it("parses every Journal request action used by the hosted group route", () => {
    const journalFact = {
      date: "2026-08-31",
      factIndex: 1,
      note: "Worked in the yard for two hours.",
      noteType: "journal-factor",
      title: "Yard work",
    } as const;

    expect(
      parseHostedRuntimeGroupToolRequest({
        action: "record_current_sender_journal_fact",
        confidence: "high",
        journalFact,
        origin,
        privateQuestion: "Can I save yard work in your private Journal?",
      }),
    ).toEqual({
      action: "record_current_sender_journal_fact",
      confidence: "high",
      journalFact,
      origin,
      privateQuestion: "Can I save yard work in your private Journal?",
    });
    expect(
      parseHostedRuntimeGroupToolRequest({
        action: "set_current_sender_journal_capture",
        enabled: false,
        origin,
        scope: "group",
      }),
    ).toEqual({
      action: "set_current_sender_journal_capture",
      enabled: false,
      origin,
      scope: "group",
    });
    expect(
      parseHostedRuntimeGroupToolRequest({
        action: "set_journal_capture",
        enabled: true,
      }),
    ).toEqual({
      action: "set_journal_capture",
      enabled: true,
    });
  });

  it("parses every Journal response action used by the hosted group route", () => {
    expect(
      parseHostedRuntimeGroupToolResponse({
        action: "record_current_sender_journal_fact",
        result: { status: "handled" },
      }),
    ).toEqual({
      action: "record_current_sender_journal_fact",
      result: { status: "handled" },
    });
    expect(
      parseHostedRuntimeGroupToolResponse({
        action: "set_current_sender_journal_capture",
        result: {
          status: "unavailable",
          unavailableReason: "member_unavailable",
        },
      }),
    ).toEqual({
      action: "set_current_sender_journal_capture",
      result: {
        status: "unavailable",
        unavailableReason: "member_unavailable",
      },
    });
    expect(
      parseHostedRuntimeGroupToolResponse({
        action: "set_journal_capture",
        result: { enabled: true, status: "updated" },
      }),
    ).toEqual({
      action: "set_journal_capture",
      result: { enabled: true, status: "updated" },
    });
  });

  it("rejects malformed Journal action fields at the wire boundary", () => {
    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "set_journal_capture",
        enabled: "yes",
      }),
    ).toThrow(/enabled must be a boolean/u);
    expect(() =>
      parseHostedRuntimeGroupToolRequest({
        action: "record_current_sender_journal_fact",
        confidence: "low",
        journalFact: {},
        origin,
        privateQuestion: "Can I save this?",
      }),
    ).toThrow(/confidence is not supported/u);
  });
});
