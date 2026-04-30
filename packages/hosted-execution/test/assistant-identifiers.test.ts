import { describe, expect, it } from "vitest";

import {
  createHostedAssistantConversationIdentifierBlind,
  hashHostedAssistantConversationIdentifier,
  hashNullableHostedAssistantConversationIdentifier,
} from "../src/assistant-identifiers.ts";

const HOSTED_ASSISTANT_IDENTIFIER_PATTERN = /^hid_[0-9a-f]{32}$/u;

describe("hosted assistant conversation identifiers", () => {
  it("derives stable blinded identifiers for one hosted member", () => {
    const firstBlind = createHostedAssistantConversationIdentifierBlind({
      secret: "hbidx:phone:v1:test",
      userId: "member_identifier_test",
    });
    const secondBlind = createHostedAssistantConversationIdentifierBlind({
      secret: "hbidx:phone:v1:test",
      userId: "member_identifier_test",
    });

    expect(hashHostedAssistantConversationIdentifier(
      firstBlind,
      " +15550100001 ",
    )).toBe(hashHostedAssistantConversationIdentifier(
      secondBlind,
      "+15550100001",
    ));
    expect(hashHostedAssistantConversationIdentifier(
      firstBlind,
      "+15550100001",
    )).toMatch(HOSTED_ASSISTANT_IDENTIFIER_PATTERN);
  });

  it("scopes the same conversation identifier value per hosted member", () => {
    const firstBlind = createHostedAssistantConversationIdentifierBlind({
      secret: "hbidx:phone:v1:test",
      userId: "member_identifier_first",
    });
    const secondBlind = createHostedAssistantConversationIdentifierBlind({
      secret: "hbidx:phone:v1:test",
      userId: "member_identifier_second",
    });

    expect(hashHostedAssistantConversationIdentifier(
      firstBlind,
      "chat_home_123",
    )).not.toBe(hashHostedAssistantConversationIdentifier(
      secondBlind,
      "chat_home_123",
    ));
  });

  it("keeps nullable identifiers nullable while hashing non-empty values", () => {
    const blind = createHostedAssistantConversationIdentifierBlind({
      secret: "hbidx:phone:v1:test",
      userId: "member_identifier_nullable",
    });

    expect(hashNullableHostedAssistantConversationIdentifier(blind, null)).toBeNull();
    expect(hashNullableHostedAssistantConversationIdentifier(blind, "   ")).toBeNull();
    expect(hashNullableHostedAssistantConversationIdentifier(
      blind,
      "hbidx:phone:v1:lookup",
    )).toMatch(HOSTED_ASSISTANT_IDENTIFIER_PATTERN);
  });

  it("requires and incorporates secret-derived member routing material", () => {
    const firstBlind = createHostedAssistantConversationIdentifierBlind({
      secret: "hbidx:phone:v1:first",
      userId: "member_identifier_secret",
    });
    const secondBlind = createHostedAssistantConversationIdentifierBlind({
      secret: "hbidx:phone:v1:second",
      userId: "member_identifier_secret",
    });

    expect(hashHostedAssistantConversationIdentifier(
      firstBlind,
      "chat_home_123",
    )).not.toBe(hashHostedAssistantConversationIdentifier(
      secondBlind,
      "chat_home_123",
    ));
    expect(() =>
      createHostedAssistantConversationIdentifierBlind({
        secret: " ",
        userId: "member_identifier_secret",
      })
    ).toThrow(/secret material/u);
  });
});
