import { describe, expect, it } from "vitest";

import {
  normalizeHostedPendingGroupSetupRosterHandles,
  resolveHostedPendingGroupSetupRosterEvidence,
} from "@/src/lib/hosted-groups/pending-group-setup-roster";

const prisma = {} as never;

describe("normalizeHostedPendingGroupSetupRosterHandles", () => {
  it("keeps unique active humans and excludes Murph or departed handles", () => {
    expect(normalizeHostedPendingGroupSetupRosterHandles([
      { handle: "+15550000001", isMe: false, status: "active" },
      { handle: "+15550000001", isMe: false, status: null },
      { handle: "+15550000002", isMe: true, status: "active" },
      { handle: "+15550000003", isMe: false, status: "removed" },
      { handle: "person@example.test", isMe: false, status: null },
    ])).toEqual(["+15550000001", "person@example.test"]);
  });

  it("fails closed instead of matching from a partial oversized roster", () => {
    expect(normalizeHostedPendingGroupSetupRosterHandles(
      Array.from({ length: 33 }, (_, index) => ({
        handle: `+1555000${String(index).padStart(4, "0")}`,
        isMe: false,
        status: "active",
      })),
    )).toBeNull();
  });
});

describe("resolveHostedPendingGroupSetupRosterEvidence", () => {
  it("projects only resolved member ids from one canonical group read", async () => {
    const result = await resolveHostedPendingGroupSetupRosterEvidence({
      chatId: "chat_family",
      prisma,
    }, {
      getChatSummary: async () => ({
        handles: [
          { handle: "+15550000001", isMe: false, status: "active" },
          { handle: "+15550000002", isMe: false, status: "active" },
        ],
        isGroup: true,
      }),
      lookupMember: async ({ handle }) => (
        handle.endsWith("1")
          ? ({ core: { id: "member_parent" } } as never)
          : null
      ),
    });

    expect(result).toEqual({
      memberIds: ["member_parent"],
      status: "available",
    });
  });

  it("preserves sender-only fallback when optional roster evidence is unavailable", async () => {
    const result = await resolveHostedPendingGroupSetupRosterEvidence({
      chatId: "chat_family",
      prisma,
    }, {
      getChatSummary: async () => {
        throw new Error("provider unavailable");
      },
    });

    expect(result).toEqual({ memberIds: [], status: "unavailable" });
  });
});
