import { describe, expect, it } from "vitest";

import { parseHostedRuntimeGroupToolRequest } from "../src/parsers.ts";

const PRIVATE_MEDIA_ORIGIN =
  "https://murph-hosted.cobuildwithus.workers.dev";
const CONTACT_CARD_IMAGE_URL =
  `${PRIVATE_MEDIA_ORIGIN}/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/group-avatar.jpg?exp=2000000000`;
const LINQ_THREAD = {
  authority: {
    accountLookupKey: "hplk_current_line",
    channel: "linq" as const,
    containerMemberId: "member_personal",
    threadId: "chat_direct_1",
  },
  chatId: "chat_direct_1",
};

describe("generated contact-card runtime request", () => {
  it("accepts only a private generated image URL with exact thread authority", () => {
    expect(parseHostedRuntimeGroupToolRequest({
      action: "share_contact_card",
      contactCardImageUrl: CONTACT_CARD_IMAGE_URL,
      linqThread: LINQ_THREAD,
    }, {
      privateMediaDeliveryOrigin: PRIVATE_MEDIA_ORIGIN,
    })).toEqual({
      action: "share_contact_card",
      contactCardImageUrl: CONTACT_CARD_IMAGE_URL,
      linqThread: LINQ_THREAD,
    });
  });

  it("rejects untrusted image origins and model-supplied extra fields", () => {
    expect(() => parseHostedRuntimeGroupToolRequest({
      action: "share_contact_card",
      contactCardImageUrl: "https://example.invalid/avatar.png",
      linqThread: LINQ_THREAD,
    }, {
      privateMediaDeliveryOrigin: PRIVATE_MEDIA_ORIGIN,
    })).toThrow(/contactCardImageUrl is invalid/u);

    expect(() => parseHostedRuntimeGroupToolRequest({
      action: "share_contact_card",
      avatarPrompt: "model-only field",
    })).toThrow(/avatarPrompt is not allowed/u);
  });
});
