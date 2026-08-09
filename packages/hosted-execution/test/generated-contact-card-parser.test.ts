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
    containerMemberId: "member_group",
    threadId: "chat_group_1",
  },
  chatId: "chat_group_1",
};

const parse = (request: unknown) =>
  parseHostedRuntimeGroupToolRequest(request, {
    privateMediaDeliveryOrigin: PRIVATE_MEDIA_ORIGIN,
  });

describe("generated contact-card runtime request", () => {
  it("accepts the canonical variant with optional exact group authority", () => {
    expect(parse({ action: "share_contact_card" })).toEqual({
      action: "share_contact_card",
    });
    expect(parse({
      action: "share_contact_card",
      linqThread: LINQ_THREAD,
    })).toEqual({
      action: "share_contact_card",
      linqThread: LINQ_THREAD,
    });
  });

  it("accepts only the complete bound personalized variant", () => {
    expect(parse({
      action: "share_contact_card",
      contactCardImageUrl: CONTACT_CARD_IMAGE_URL,
      contactCardShareKey: "asst_input_abc123",
      directLinqChatId: "chat_direct_1",
    })).toEqual({
      action: "share_contact_card",
      contactCardImageUrl: CONTACT_CARD_IMAGE_URL,
      contactCardShareKey: "asst_input_abc123",
      directLinqChatId: "chat_direct_1",
    });
  });

  it.each([
    {
      label: "image without a share key or direct chat",
      request: {
        action: "share_contact_card",
        contactCardImageUrl: CONTACT_CARD_IMAGE_URL,
      },
    },
    {
      label: "image and share key without a direct chat",
      request: {
        action: "share_contact_card",
        contactCardImageUrl: CONTACT_CARD_IMAGE_URL,
        contactCardShareKey: "asst_input_abc123",
      },
    },
    {
      label: "share key and direct chat without an image",
      request: {
        action: "share_contact_card",
        contactCardShareKey: "asst_input_abc123",
        directLinqChatId: "chat_direct_1",
      },
    },
    {
      label: "personalized fields mixed with group authority",
      request: {
        action: "share_contact_card",
        contactCardImageUrl: CONTACT_CARD_IMAGE_URL,
        contactCardShareKey: "asst_input_abc123",
        directLinqChatId: "chat_direct_1",
        linqThread: LINQ_THREAD,
      },
    },
  ])("rejects $label", ({ request }) => {
    expect(() => parse(request)).toThrow(/must be either canonical/u);
  });

  it("bounds both trusted-host identifiers", () => {
    expect(() => parse({
      action: "share_contact_card",
      contactCardImageUrl: CONTACT_CARD_IMAGE_URL,
      contactCardShareKey: "a".repeat(201),
      directLinqChatId: "chat_direct_1",
    })).toThrow(/contactCardShareKey/u);

    expect(() => parse({
      action: "share_contact_card",
      contactCardImageUrl: CONTACT_CARD_IMAGE_URL,
      contactCardShareKey: "asst_input_abc123",
      directLinqChatId: "c".repeat(201),
    })).toThrow(/directLinqChatId/u);
  });

  it("rejects untrusted image origins and model-only fields", () => {
    expect(() => parse({
      action: "share_contact_card",
      contactCardImageUrl: "https://example.invalid/avatar.png",
      contactCardShareKey: "asst_input_abc123",
      directLinqChatId: "chat_direct_1",
    })).toThrow(/contactCardImageUrl is invalid/u);

    expect(() => parse({
      action: "share_contact_card",
      avatarPrompt: "model-only field",
    })).toThrow(/avatarPrompt is not allowed/u);
  });
});
