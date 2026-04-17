import { describe, expect, it } from "vitest";

import { parseHostedAssistantRuntimeConfig } from "../src/hosted-runtime/parsers.ts";

describe("parseHostedAssistantRuntimeConfig", () => {
  it("parses hosted device-sync runtime config through the shared device-sync parser", () => {
    const parsed = parseHostedAssistantRuntimeConfig({
      resolvedConfig: {
        channelCapabilities: {
          emailSendReady: false,
          telegramBotConfigured: false,
        },
        deviceSync: {
          providerConfigs: {
            strava: {
              clientId: "strava-client-id",
              clientSecret: "strava-client-secret",
              scopes: ["activity:read"],
            },
          },
          publicBaseUrl: "https://device-sync.example.test",
          secret: "codec-secret",
        },
      },
    });

    expect(parsed.resolvedConfig?.deviceSync).toMatchObject({
      publicBaseUrl: "https://device-sync.example.test",
      secret: "codec-secret",
    });
    expect(parsed.resolvedConfig?.deviceSync?.providerConfigs.strava).toMatchObject({
      clientId: "strava-client-id",
      clientSecret: "strava-client-secret",
      scopes: ["activity:read"],
    });
  });

  it("rejects unknown top-level hosted runtime device-sync fields", () => {
    expect(() =>
      parseHostedAssistantRuntimeConfig({
        resolvedConfig: {
          channelCapabilities: {
            emailSendReady: false,
            telegramBotConfigured: false,
          },
          deviceSync: {
            providerConfigs: {
              strava: {
                clientId: "strava-client-id",
                clientSecret: "strava-client-secret",
              },
            },
            publicBaseUrl: "https://device-sync.example.test",
            secret: "codec-secret",
            unexpectedField: "nope",
          },
        },
      })).toThrow(/resolvedConfig\.deviceSync\.unexpectedField/u);
  });
});
