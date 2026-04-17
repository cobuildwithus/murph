import { describe, expect, it } from "vitest";

import type { HostedEmailConfig } from "../src/hosted-email/config.ts";
import {
  formatHostedEmailAddress,
  isHostedEmailPublicSenderAddress,
  parseHostedEmailRouteCandidate,
} from "../src/hosted-email/route-addressing.ts";
import {
  createHostedEmailRouteToken,
  deriveStableHostedEmailKey,
  parseHostedEmailRouteToken,
} from "../src/hosted-email/route-crypto.ts";

const hostedEmailConfig: HostedEmailConfig = {
  defaultSubject: "Murph update",
  domain: "example.com",
  fromAddress: "assistant@example.com",
  localPart: "assistant",
  signingSecret: "top-secret",
};

describe("hosted email route addressing", () => {
  it("treats the configured public sender as a dedicated identity", () => {
    expect(isHostedEmailPublicSenderAddress("assistant@example.com", hostedEmailConfig)).toBe(true);
    expect(isHostedEmailPublicSenderAddress("assistant+alias@example.com", hostedEmailConfig)).toBe(false);
  });

  it("parses both explicit alias addresses and bare route details", () => {
    expect(
      parseHostedEmailRouteCandidate("assistant+u-route-123@example.com", hostedEmailConfig),
    ).toEqual({
      address: "assistant+u-route-123@example.com",
      detail: "u-route-123",
    });

    expect(parseHostedEmailRouteCandidate("u-route-123", hostedEmailConfig)).toEqual({
      address: "assistant+u-route-123@example.com",
      detail: "u-route-123",
    });
  });

  it("formats alias addresses from the configured local part and domain", () => {
    expect(formatHostedEmailAddress(hostedEmailConfig, "u-route-123")).toBe(
      "assistant+u-route-123@example.com",
    );
  });

  it("formats and parses reply aliases with mixed-case config", () => {
    const mixedCaseConfig: HostedEmailConfig = {
      defaultSubject: "Murph update",
      domain: "Reply.Example.COM",
      fromAddress: "Murph@Reply.Example.COM",
      localPart: "Murph",
      signingSecret: "top-secret",
    };

    expect(formatHostedEmailAddress(mixedCaseConfig, "u-test-token")).toBe(
      "murph+u-test-token@reply.example.com",
    );
    expect(parseHostedEmailRouteCandidate("Murph+u-test-token@Reply.Example.COM", mixedCaseConfig))
      .toEqual({
        address: "murph+u-test-token@reply.example.com",
        detail: "u-test-token",
      });
  });
});

describe("hosted email route crypto", () => {
  it("round-trips user alias tokens", async () => {
    const aliasKey = await deriveStableHostedEmailKey("top-secret", "user:user-123");
    const token = await createHostedEmailRouteToken({
      aliasKey,
      secret: "top-secret",
    });

    await expect(parseHostedEmailRouteToken({ secret: "top-secret", token })).resolves.toEqual({
      aliasKey,
    });
  });

  it("rejects tampered alias tokens", async () => {
    const aliasKey = await deriveStableHostedEmailKey("top-secret", "user:user-123");
    const token = await createHostedEmailRouteToken({
      aliasKey,
      secret: "top-secret",
    });
    const tampered = `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`;

    await expect(
      parseHostedEmailRouteToken({ secret: "top-secret", token: tampered }),
    ).resolves.toBeNull();
  });

  it("rejects legacy non-user alias token scopes", async () => {
    await expect(
      parseHostedEmailRouteToken({
        secret: "top-secret",
        token: "t-legacyreplykey123-0123456789abcdef0123456789abcdef",
      }),
    ).resolves.toBeNull();
  });
});
