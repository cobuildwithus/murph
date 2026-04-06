import { describe, expect, it } from "vitest";

import type { HostedEmailConfig } from "../src/hosted-email/config.ts";
import {
  formatHostedEmailAddress,
  isHostedEmailPublicSenderAddress,
  parseHostedEmailRouteCandidate,
  resolveHostedEmailRouteIdentity,
} from "../src/hosted-email/route-addressing.ts";
import {
  createHostedEmailRouteToken,
  deriveStableHostedEmailKey,
  parseHostedEmailRouteToken,
} from "../src/hosted-email/route-crypto.ts";

const hostedEmailConfig: HostedEmailConfig = {
  apiBaseUrl: "https://api.cloudflare.com/client/v4",
  cloudflareAccountId: null,
  cloudflareApiToken: null,
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

  it("keeps route identity tied to the live sender config", () => {
    expect(resolveHostedEmailRouteIdentity("legacy@example.com", hostedEmailConfig)).toBe(
      "assistant@example.com",
    );
  });

  it("formats alias addresses from the configured local part and domain", () => {
    expect(formatHostedEmailAddress(hostedEmailConfig, "u-route-123")).toBe(
      "assistant+u-route-123@example.com",
    );
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
