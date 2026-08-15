import { describe, expect, it, vi } from "vitest";

import {
  claimHostedPendingGroupSetupForParticipantsTx,
  selectHostedPendingGroupSetupCandidate,
  type HostedPendingGroupSetupCandidate,
} from "@/src/lib/hosted-groups/pending-group-setup";
import {
  HOSTED_RUNTIME_PENDING_GROUP_SETUP_ROOM_CONTEXT_MAX_BYTES,
  parseHostedRuntimePendingGroupSetupInput,
} from "@murphai/hosted-execution/pending-group-setup";

function candidate(
  ownerMemberId: string,
  id = `setup_${ownerMemberId}`,
): HostedPendingGroupSetupCandidate {
  return { id, ownerMemberId };
}

describe("selectHostedPendingGroupSetupCandidate", () => {
  it("refuses to select from an oversized partial roster at the claim boundary", async () => {
    await expect(claimHostedPendingGroupSetupForParticipantsTx({
      occurredAt: new Date("2026-07-29T18:01:00.000Z"),
      participantMemberIds: Array.from(
        { length: 33 },
        (_, index) => `member_${index}`,
      ),
      recipientPhoneLookupKeys: ["line_lookup_key"],
      senderMemberId: "member_0",
      tx: {} as never,
    })).resolves.toEqual({
      kind: "none",
      reason: "no_candidates",
    });
  });

  it("distinguishes a non-managed recipient line from bounded live facts", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const queryRaw = vi.fn().mockResolvedValue([]);

    await expect(claimHostedPendingGroupSetupForParticipantsTx({
      occurredAt: new Date("2026-07-29T18:01:00.000Z"),
      participantMemberIds: ["member_owner"],
      recipientPhoneLookupKeys: ["line_lookup_key"],
      senderMemberId: "member_owner",
      tx: {
        $queryRaw: queryRaw,
        hostedLinqLine: { findMany },
      } as never,
    })).resolves.toEqual({
      kind: "none",
      reason: "recipient_line_unmanaged",
    });
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(findMany).toHaveBeenCalledOnce();
  });

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

describe("pending group setup payload", () => {
  it("accepts ownership-only setup and normalizes bounded explicit setup", () => {
    expect(parseHostedRuntimePendingGroupSetupInput({})).toEqual({});
    expect(parseHostedRuntimePendingGroupSetupInput({
      roomContextMarkdown: "  Keep the room low-key.  ",
      style: {
        personality: {
          humor: 2,
          push: null,
        },
        tone: "casual",
      },
    })).toEqual({
      roomContextMarkdown: "Keep the room low-key.",
      style: {
        personality: {
          humor: 2,
          push: null,
        },
        tone: "casual",
      },
    });
  });

  it("rejects unknown settings, raw participant handles, and unsafe text", () => {
    expect(() => parseHostedRuntimePendingGroupSetupInput({
      unexpected: true,
    })).toThrow(/unrecognized key/iu);
    expect(() => parseHostedRuntimePendingGroupSetupInput({
      style: { personality: { humor: 99 } },
    })).toThrow();
    for (const roomContextMarkdown of [
      "Ask +15555550123 about it.",
      "Ask (555) 123-4567 about it.",
      "Ask 555-123-4567 about it.",
      "Ask +1 (555) 123-4567 about it.",
      "Ask +44 20 7946 0958 about it.",
      "Ask 555.123.4567 about it.",
      "Ask member@example.test about it.",
      "Ask participant:secret-handle about it.",
      "Ask Sender #123 about it.",
      "Unsafe\u0000text",
    ]) {
      expect(() => parseHostedRuntimePendingGroupSetupInput({
        roomContextMarkdown,
      })).toThrow();
    }
    expect(parseHostedRuntimePendingGroupSetupInput({
      roomContextMarkdown:
        "The trip starts 2026-07-29; keep replies to 3 bullets.",
    })).toEqual({
      roomContextMarkdown:
        "The trip starts 2026-07-29; keep replies to 3 bullets.",
    });
    expect(() => parseHostedRuntimePendingGroupSetupInput({
      roomContextMarkdown:
        "x".repeat(HOSTED_RUNTIME_PENDING_GROUP_SETUP_ROOM_CONTEXT_MAX_BYTES + 1),
    })).toThrow(/UTF-8 byte limit/u);
  });
});
