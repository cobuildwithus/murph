import { describe, expect, it } from "vitest";

import {
  buildHostedFamilyInfoReplyText,
  parseHostedFamilyInfoChatIntent,
} from "@/src/lib/hosted-onboarding/family-chat-intent";

describe("hosted Family chat intent", () => {
  it("recognizes Murph Family product questions", () => {
    expect(parseHostedFamilyInfoChatIntent("wiesz cos o family planie?")).toBe(true);
    expect(parseHostedFamilyInfoChatIntent("how does Murph Family work?")).toBe(true);
    expect(parseHostedFamilyInfoChatIntent("czy moge zaprosic mame?")).toBe(true);
  });

  it("leaves health family-history questions for the assistant", () => {
    expect(parseHostedFamilyInfoChatIntent("my family has a history of diabetes")).toBe(false);
  });

  it("explains seats, privacy, and chat invites", () => {
    const reply = buildHostedFamilyInfoReplyText();

    expect(reply).toContain("up to 4 people total");
    expect(reply).toContain("cannot see a member's private Murph conversations");
    expect(reply).toContain("invite my mom");
  });
});
