import { describe, expect, it } from "vitest";

import {
  HOSTED_PENDING_GROUP_SETUP_ROOM_CONTEXT_MAX_BYTES,
  normalizeHostedPendingGroupSetupPayload,
  selectHostedPendingGroupSetupCandidate,
  type HostedPendingGroupSetupCandidate,
} from "@/src/lib/hosted-groups/pending-group-setup";

function candidate(
  ownerMemberId: string,
  id = `setup_${ownerMemberId}`,
): HostedPendingGroupSetupCandidate {
  return { id, ownerMemberId };
}

describe("selectHostedPendingGroupSetupCandidate", () => {
  it("selects the only roster-matched pending setup even when someone else speaks first", () => {
    expect(selectHostedPendingGroupSetupCandidate({
      candidates: [candidate("parent")],
      senderMemberId: "child",
    })).toEqual({
      candidate: candidate("parent"),
      kind: "selected",
      reason: "only_candidate",
    });
  });

  it("uses the current sender's setup to break a real conflict", () => {
    expect(selectHostedPendingGroupSetupCandidate({
      candidates: [candidate("parent_a"), candidate("parent_b")],
      senderMemberId: "parent_b",
    })).toEqual({
      candidate: candidate("parent_b"),
      kind: "selected",
      reason: "sender_wins_conflict",
    });
  });

  it("does not guess when several participants prepared the room and the sender did not", () => {
    expect(selectHostedPendingGroupSetupCandidate({
      candidates: [candidate("parent_a"), candidate("parent_b")],
      senderMemberId: "child",
    })).toEqual({
      kind: "none",
      reason: "ambiguous",
    });
  });

  it("deduplicates candidate owners before applying the conflict rule", () => {
    expect(selectHostedPendingGroupSetupCandidate({
      candidates: [
        candidate("parent", "setup_old"),
        candidate("parent", "setup_duplicate"),
      ],
      senderMemberId: "child",
    })).toEqual({
      candidate: candidate("parent", "setup_old"),
      kind: "selected",
      reason: "only_candidate",
    });
  });

  it("returns no candidate when the roster has no active pending setup", () => {
    expect(selectHostedPendingGroupSetupCandidate({
      candidates: [],
      senderMemberId: "member",
    })).toEqual({
      kind: "none",
      reason: "no_candidates",
    });
  });
});

describe("normalizeHostedPendingGroupSetupPayload", () => {
  it("accepts sparse existing style settings plus compact room context", () => {
    expect(normalizeHostedPendingGroupSetupPayload({
      roomContextMarkdown: "  ## Explicit setup\n\n- Let the family lead.  ",
      schemaVersion: 1,
      style: {
        personality: {
          detail: 2,
          humor: 1,
          unhinged: 0,
        },
        tone: "casual",
      },
    })).toEqual({
      roomContextMarkdown: "## Explicit setup\n\n- Let the family lead.",
      schemaVersion: 1,
      style: {
        personality: {
          detail: 2,
          humor: 1,
          unhinged: 0,
        },
        tone: "casual",
      },
    });
  });

  it("allows a context-only setup without copying the owner's private style", () => {
    expect(normalizeHostedPendingGroupSetupPayload({
      roomContextMarkdown: "This is a low-key family introduction.",
      schemaVersion: 1,
    })).toEqual({
      roomContextMarkdown: "This is a low-key family introduction.",
      schemaVersion: 1,
    });
  });

  it("rejects an empty setup", () => {
    expect(() => normalizeHostedPendingGroupSetupPayload({
      schemaVersion: 1,
    })).toThrow("requires style or room context");
  });

  it("rejects unknown fields instead of persisting accidental parallel state", () => {
    expect(() => normalizeHostedPendingGroupSetupPayload({
      instructions: "hidden alternate prompt",
      schemaVersion: 1,
    })).toThrow();
  });

  it("rejects invalid personality values through the existing score contract", () => {
    expect(() => normalizeHostedPendingGroupSetupPayload({
      schemaVersion: 1,
      style: {
        personality: {
          humor: 99,
        },
      },
    })).toThrow();
  });

  it("bounds the encrypted context before it can reach a future room-model write", () => {
    expect(() => normalizeHostedPendingGroupSetupPayload({
      roomContextMarkdown: "x".repeat(
        HOSTED_PENDING_GROUP_SETUP_ROOM_CONTEXT_MAX_BYTES + 1,
      ),
      schemaVersion: 1,
    })).toThrow("room context is too large");
  });
});
