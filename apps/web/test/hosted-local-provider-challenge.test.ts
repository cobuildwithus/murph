import { describe, expect, it } from "vitest";

import { isHostedLocalProviderChallengeSurface } from "../scripts/hosted-local-provider-challenge";

describe("hosted-local provider challenge classification", () => {
  it.each([
    {
      frameUrls: ["https://id.example.test/sign-in"],
      title: "Just a moment...",
    },
    {
      frameUrls: ["https://id.example.test/sign-in"],
      title: "Just a moment…",
    },
    {
      frameUrls: [
        "https://id.example.test/sign-in",
        "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/frame",
      ],
      title: "Sign in",
    },
  ])("recognizes a Cloudflare provider challenge without page content", (surface) => {
    expect(isHostedLocalProviderChallengeSurface(surface)).toBe(true);
  });

  it("does not classify an ordinary provider login or unrelated frame", () => {
    expect(isHostedLocalProviderChallengeSurface({
      frameUrls: [
        "https://id.example.test/sign-in",
        "https://captcha.example.test/frame",
      ],
      title: "Sign in",
    })).toBe(false);
  });

  it("ignores malformed and insecure challenge-like frame URLs", () => {
    expect(isHostedLocalProviderChallengeSurface({
      frameUrls: [
        "not a URL",
        "http://challenges.cloudflare.com/frame",
        "https://challenges.cloudflare.com.example.test/frame",
      ],
      title: "Authorize",
    })).toBe(false);
  });
});
