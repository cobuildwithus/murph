import { describe, expect, it } from "vitest";

import {
  parseHostedAssistantRuntimeConfig,
} from "../src/hosted-runtime/parsers.ts";

describe("hosted runtime parser coverage", () => {
  it("parses nullable runtime config fields and forwarded env records", () => {
    expect(
      parseHostedAssistantRuntimeConfig({
        commitTimeoutMs: null,
        forwardedEnv: {
          PATH: "/usr/bin",
        },
        resolvedConfig: {
          channelCapabilities: {
            emailSendReady: true,
            telegramBotConfigured: false,
          },
          deviceSync: {
            providerConfigs: {
              whoop: {
                clientId: "whoop-client",
                clientSecret: "whoop-secret",
                scopes: ["offline", "read:profile"],
              },
            },
            publicBaseUrl: "https://device-sync.example.test",
            secret: "secret_123",
          },
        },
        userEnv: {
          OPENAI_API_KEY: "secret",
        },
      }),
    ).toEqual({
      commitTimeoutMs: null,
      forwardedEnv: {
        PATH: "/usr/bin",
      },
      resolvedConfig: {
        channelCapabilities: {
          emailSendReady: true,
          telegramBotConfigured: false,
        },
        deviceSync: {
          providerConfigs: {
            whoop: {
              clientId: "whoop-client",
              clientSecret: "whoop-secret",
              scopes: ["offline", "read:profile"],
            },
          },
          publicBaseUrl: "https://device-sync.example.test",
          secret: "secret_123",
        },
        managedAutoReplyChannels: [
          {
            capabilityReady: true,
            channel: "email",
            memberChannel: "email",
          },
          {
            capabilityReady: true,
            channel: "linq",
            memberChannel: "linq",
          },
          {
            capabilityReady: false,
            channel: "telegram",
            memberChannel: "telegram",
          },
        ],
      },
      userEnv: {
        OPENAI_API_KEY: "secret",
      },
    });
  });

  it("rejects invalid runtime numeric fields", () => {
    expect(() => parseHostedAssistantRuntimeConfig({
      commitTimeoutMs: Number.NaN,
    })).toThrow(/commitTimeoutMs must be a finite number/u);

    expect(() => parseHostedAssistantRuntimeConfig({
      resolvedConfig: {
        channelCapabilities: {
          emailSendReady: "yes",
          telegramBotConfigured: false,
        },
      },
    })).toThrow(/emailSendReady must be a boolean/u);
  });

  it("rejects the remaining removed runtime callback override fields", () => {
    for (const field of [
      "artifactsBaseUrl",
      "commitBaseUrl",
      "emailBaseUrl",
      "resultsBaseUrl",
      "sideEffectsBaseUrl",
    ]) {
      expect(() => parseHostedAssistantRuntimeConfig({
        [field]: "https://murph.example.test",
      })).toThrow(new RegExp(`${field} is no longer supported`, "u"));
    }
  });

  it("rejects non-serializable provider config entries inside resolved runtime config", () => {
    expect(() => parseHostedAssistantRuntimeConfig({
      resolvedConfig: {
        channelCapabilities: {
          emailSendReady: false,
          telegramBotConfigured: false,
        },
        deviceSync: {
          providerConfigs: {
            oura: {
              clientId: "oura-client",
              clientSecret: "oura-secret",
              fetchImpl: () => Promise.resolve(new Response()),
            },
          },
          publicBaseUrl: "https://device-sync.example.test",
          secret: "secret_123",
        },
      },
    })).toThrow(/fetchImpl is not supported in serialized runtime config/u);

    expect(() => parseHostedAssistantRuntimeConfig({
      resolvedConfig: {
        channelCapabilities: {
          emailSendReady: false,
          telegramBotConfigured: false,
        },
        deviceSync: {
          providerConfigs: {
            oura: {
              clientId: "oura-client",
              clientSecret: "oura-secret",
              webhookVerificationToken: "control-plane-only",
            },
          },
          publicBaseUrl: "https://device-sync.example.test",
          secret: "secret_123",
        },
      },
    })).toThrow(/webhookVerificationToken is a provider-owned admin secret/u);
  });

  it("parses explicit managed auto-reply channel config", () => {
    expect(
      parseHostedAssistantRuntimeConfig({
        resolvedConfig: {
          channelCapabilities: {
            emailSendReady: true,
            telegramBotConfigured: true,
          },
          deviceSync: null,
          managedAutoReplyChannels: [
            {
              capabilityReady: true,
              channel: "email",
              memberChannel: "email",
            },
            {
              capabilityReady: false,
              channel: "telegram",
            },
            {
              capabilityReady: true,
              channel: "linq",
              memberChannel: null,
            },
          ],
        },
      }),
    ).toEqual({
      resolvedConfig: {
        channelCapabilities: {
          emailSendReady: true,
          telegramBotConfigured: true,
        },
        deviceSync: null,
        managedAutoReplyChannels: [
          {
            capabilityReady: true,
            channel: "email",
            memberChannel: "email",
          },
          {
            capabilityReady: false,
            channel: "telegram",
            memberChannel: null,
          },
          {
            capabilityReady: true,
            channel: "linq",
            memberChannel: null,
          },
        ],
      },
    });
  });

  it("rejects malformed explicit managed auto-reply channel config", () => {
    expect(() => parseHostedAssistantRuntimeConfig({
      resolvedConfig: {
        channelCapabilities: {
          emailSendReady: true,
          telegramBotConfigured: true,
        },
        managedAutoReplyChannels: {
          email: true,
        },
      },
    })).toThrow(/managedAutoReplyChannels must be an array/u);

    expect(() => parseHostedAssistantRuntimeConfig({
      resolvedConfig: {
        channelCapabilities: {
          emailSendReady: true,
          telegramBotConfigured: true,
        },
        managedAutoReplyChannels: [
          {
            capabilityReady: true,
            channel: "",
          },
        ],
      },
    })).toThrow(/managedAutoReplyChannels\[0\]\.channel must be a non-empty string/u);
  });

});
