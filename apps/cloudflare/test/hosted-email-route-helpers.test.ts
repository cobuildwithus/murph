import { describe, expect, it } from "vitest";

import type { HostedEmailConfig } from "../src/hosted-email/config.ts";
import {
  formatHostedEmailAddress,
  isHostedEmailPublicBootstrapAddress,
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
  publicAddress: "mail@mail.withmurph.ai",
  signingSecret: "top-secret",
};

describe("hosted email route addressing", () => {
  it("treats the configured public sender as a dedicated identity", () => {
    expect(isHostedEmailPublicSenderAddress("assistant@example.com", hostedEmailConfig)).toBe(true);
    expect(isHostedEmailPublicSenderAddress("assistant+alias@example.com", hostedEmailConfig)).toBe(false);
  });

  it("keeps the unauthenticated bootstrap recipient separate from the sender identity", () => {
    expect(isHostedEmailPublicBootstrapAddress(
      "MAIL@mail.withmurph.ai",
      hostedEmailConfig,
    )).toBe(true);
    expect(isHostedEmailPublicBootstrapAddress(
      "assistant@example.com",
      hostedEmailConfig,
    )).toBe(false);
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

    expect(aliasKey).toMatch(/^[0-9a-f]{32}$/u);
    expect(token).toMatch(/^u2-[0-9a-z]{25}-[0-9a-z]{25}$/u);
    expect(formatHostedEmailAddress(hostedEmailConfig, token).split("@")[0]).toHaveLength(64);
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

  it("round-trips maximum 128-bit alias key tokens", async () => {
    const aliasKey = "f".repeat(32);
    const token = await createHostedEmailRouteToken({
      aliasKey,
      secret: "top-secret",
    });

    expect(token).toMatch(/^u2-[0-9a-z]{25}-[0-9a-z]{25}$/u);
    await expect(parseHostedEmailRouteToken({ secret: "top-secret", token })).resolves.toEqual({
      aliasKey,
    });
  });

  it("rejects base36 alias segments outside the 128-bit range", async () => {
    const overflowAliasKey = (2n ** 128n).toString(36).padStart(25, "0");
    expect(overflowAliasKey).toHaveLength(25);

    await expect(
      parseHostedEmailRouteToken({
        secret: "top-secret",
        token: `u2-${overflowAliasKey}-${"0".repeat(25)}`,
      }),
    ).resolves.toBeNull();
  });

  it("rejects route tokens with malformed alias or signature lengths", async () => {
    const aliasKey = await deriveStableHostedEmailKey("top-secret", "user:user-123");
    const token = await createHostedEmailRouteToken({
      aliasKey,
      secret: "top-secret",
    });
    const tokenParts = /^u2-(?<aliasKey>[0-9a-z]+)-(?<signature>[0-9a-z]+)$/u.exec(token)
      ?.groups;
    expect(tokenParts).toBeDefined();
    if (!tokenParts) {
      throw new Error("Expected a generated hosted email route token.");
    }
    const tokenAliasKey = tokenParts.aliasKey;
    const { signature } = tokenParts;
    expect(tokenAliasKey).toHaveLength(25);
    expect(signature).toHaveLength(25);

    const malformedTokens = [
      `u2-${tokenAliasKey.slice(0, -1)}-${signature}`,
      `u2-${tokenAliasKey}0-${signature}`,
      `u2-${tokenAliasKey}-${signature.slice(0, -1)}`,
      `u2-${tokenAliasKey}-${signature}0`,
    ];

    for (const malformedToken of malformedTokens) {
      await expect(
        parseHostedEmailRouteToken({
          secret: "top-secret",
          token: malformedToken,
        }),
      ).resolves.toBeNull();
    }
  });

  it("rejects structurally malformed route tokens without throwing", async () => {
    await expect(
      parseHostedEmailRouteToken({
        secret: "top-secret",
        token: "not-a-hosted-email-route-token",
      }),
    ).resolves.toBeNull();
  });

  it("rejects former 64-bit legacy user alias tokens", async () => {
    await expect(
      parseHostedEmailRouteToken({
        secret: "top-secret",
        token: "u-0123456789abcdef-0123456789abcdef0123456789abcdef",
      }),
    ).resolves.toBeNull();
  });

  it("refuses to mint route tokens from short alias keys", async () => {
    await expect(
      createHostedEmailRouteToken({
        aliasKey: "0123456789abcdef",
        secret: "top-secret",
      }),
    ).rejects.toThrow("128-bit lowercase hex");
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
