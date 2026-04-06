import { describe, expect, it } from "vitest";

import { readHostedEmailConfig } from "../src/hosted-email/config.ts";

describe("readHostedEmailConfig", () => {
  it("defaults the Cloudflare API base URL when the env value is empty or whitespace", () => {
    expect(readHostedEmailConfig({}).apiBaseUrl).toBe("https://api.cloudflare.com/client/v4");
    expect(
      readHostedEmailConfig({
        HOSTED_EMAIL_CLOUDFLARE_API_BASE_URL: "   ",
      }).apiBaseUrl,
    ).toBe("https://api.cloudflare.com/client/v4");
  });

  it("trims and removes one trailing slash from the configured Cloudflare API base URL", () => {
    expect(
      readHostedEmailConfig({
        HOSTED_EMAIL_CLOUDFLARE_API_BASE_URL: " https://api.example.test/base/ ",
      }).apiBaseUrl,
    ).toBe("https://api.example.test/base");
    expect(
      readHostedEmailConfig({
        HOSTED_EMAIL_CLOUDFLARE_API_BASE_URL: "https://api.example.test/base",
      }).apiBaseUrl,
    ).toBe("https://api.example.test/base");
  });
});
