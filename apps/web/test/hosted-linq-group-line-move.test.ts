import { describe, expect, it } from "vitest";
import { hostedLinqGroupMoveAudience } from "@/src/lib/hosted-routing/linq-group-line-move-ingress";
import { isExactGameChat, normalizeGameChatMoveAudience } from "@/src/lib/game/chat-membership";
import { createHostedPhoneLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { linqRoster } from "./support/linq-roster";
const sourcePhone = "+15555550100", targetPhone = "+15555550200";
const cleanup = { schema: "murph.linq-group-line-move.v1", sourceChatId: "synthetic-source-chat", sourcePhone, targetPhone } as const;

describe("group move complete audience and overlap normalization", () => {
  it.each([2, 3, 10])("keeps %s human players exact under either provider self representation", count => {
    const people = Array.from({ length: count }, (_, i) => `+15555550${String(i + 301).padStart(3, "0")}`);
    for (const bothSelf of [false, true]) for (const currentPhone of [sourcePhone, targetPhone]) {
      const chat = linqRoster({ isGroup: true, handlesComplete: true, handles: [
        { handle: sourcePhone, isMe: bothSelf || currentPhone === sourcePhone, status: "active" },
        { handle: targetPhone, isMe: bothSelf || currentPhone === targetPhone, status: "active" },
        ...people.map(handle => ({ handle, isMe: false, status: "active" })),
      ] });
      const normalize = (value: typeof chat) => normalizeGameChatMoveAudience(value, [sourcePhone, targetPhone], createHostedPhoneLookupKey(currentPhone)!);
      expect(isExactGameChat(normalize(chat), people)).toBe(true);
      expect(isExactGameChat(normalize({ ...chat, handlesComplete: false }), people)).toBe(false);
      expect(isExactGameChat(normalize({ ...chat, handles: [...chat.handles, { handle: "outside@example.test", isMe: false, status: "active" }] }), people)).toBe(false);
      expect(isExactGameChat(normalize({ ...chat, handles: [...chat.handles, { handle: "+15555550999", isMe: true, status: "active" }] }), people)).toBe(false);
      const afterLeave = { ...chat, handles: chat.handles.filter(handle => handle.handle !== (currentPhone === sourcePhone ? targetPhone : sourcePhone)) };
      expect(isExactGameChat(normalize(afterLeave), people)).toBe(true);
      expect(normalizeGameChatMoveAudience(chat, [], "unused")).toBe(chat);
    }
  });
  it("compares handles rather than member identities and refuses incomplete or oversized evidence", () => {
    const chat = linqRoster({ isGroup: true, handlesComplete: true, handles: [
      { handle: sourcePhone, isMe: true, status: "active" }, { handle: targetPhone, isMe: true, status: "active" },
      { handle: "unknown@example.test", isMe: false, status: "active" }, { handle: "+15555550987", isMe: false, status: "active" },
      { handle: "inactive@example.test", isMe: false, status: "inactive" },
    ] });
    expect(hostedLinqGroupMoveAudience(chat, cleanup)).toEqual(["email:unknown@example.test", "phone:+15555550987"]);
    expect(hostedLinqGroupMoveAudience({ ...chat, handlesComplete: false }, cleanup)).toBeNull();
    expect(hostedLinqGroupMoveAudience({ ...chat, handles: Array(33).fill(chat.handles[0]) }, cleanup)).toBeNull();
  });
});
