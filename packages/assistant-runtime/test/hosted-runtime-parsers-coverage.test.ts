import { ContractValidationError } from "@murphai/contracts/validation-error";
import { parseInput, RequestInputError } from "@murphai/hosted-execution/request-input";
import { describe, expect, it } from "vitest";

import {
  parseHostedAssistantRuntimeConfig,
} from "../src/hosted-runtime/parsers.ts";

describe("hosted runtime parser coverage", () => {
  it.each([
    ["non-object config", null],
    ["removed field", { commitBaseUrl: "https://example.test" }],
    ["null toolchain", { parserToolchain: null }],
    ["non-string environment entry", { userEnv: { SYNTHETIC_SETTING: 1 } }],
    ["non-finite timeout", { commitTimeoutMs: Infinity }],
    ["blank authorization", { parserToolchain: { tools: { transcription: { authorizationHeader: " " } } } }],
    ["blank command", { parserToolchain: { tools: { ffmpeg: { command: " " } } } }],
    ["relative command", { parserToolchain: { tools: { ffmpeg: { command: "ffmpeg" } } } }],
    ["invalid endpoint", { parserToolchain: { tools: { transcription: { endpoint: "invalid" } } } }],
    ["unsupported endpoint protocol", { parserToolchain: { tools: { transcription: { endpoint: "ftp://example.test" } } } }],
    ["non-boolean capability", { resolvedConfig: { channelCapabilities: { emailSendReady: "yes" } } }],
    ["non-array channels", { resolvedConfig: { channelCapabilities: { emailSendReady: false, telegramBotConfigured: false }, managedAutoReplyChannels: {} } }],
    ["empty channel", { resolvedConfig: { channelCapabilities: { emailSendReady: false, telegramBotConfigured: false }, managedAutoReplyChannels: [{ capabilityReady: true, channel: "" }] } }],
  ])("marks %s as contract validation for request boundaries", (_label, value) => {
    expect(() => parseHostedAssistantRuntimeConfig(value)).toThrow(ContractValidationError);
    expect(() => parseInput(value, parseHostedAssistantRuntimeConfig)).toThrow(RequestInputError);
  });

  it.each([
    { providerConfigs: {}, publicBaseUrl: "https://example.test", secret: "synthetic", unsupported: true },
    { providerConfigs: { unknown: {} }, publicBaseUrl: "https://example.test", secret: "synthetic" },
    { providerConfigs: { junction: null }, publicBaseUrl: "https://example.test", secret: "synthetic" },
    { providerConfigs: { junction: { apiKey: "synthetic" } }, publicBaseUrl: "https://example.test", secret: "synthetic" },
    { providerConfigs: { junction: { region: 4 } }, publicBaseUrl: "https://example.test", secret: "synthetic" },
    { providerConfigs: { junction: { reconcileDays: "invalid" } }, publicBaseUrl: "https://example.test", secret: "synthetic" },
    { providerConfigs: { junction: { pushSourceRecoveryEnabled: "yes" } }, publicBaseUrl: "https://example.test", secret: "synthetic" },
    { providerConfigs: { junction: { allowedLinkHosts: "invalid" } }, publicBaseUrl: "https://example.test", secret: "synthetic" },
  ])("translates nested supplied device config rejection %#", deviceSync => {
    const value = { resolvedConfig: {
      channelCapabilities: { emailSendReady: false, telegramBotConfigured: false }, deviceSync,
    } };
    expect(() => parseHostedAssistantRuntimeConfig(value)).toThrow(ContractValidationError);
    expect(() => parseInput(value, parseHostedAssistantRuntimeConfig)).toThrow(RequestInputError);
  });

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
            providerConfigs: { junction: { environment: "sandbox", region: "us" } },
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
          providerConfigs: { junction: { environment: "sandbox", region: "us" } },
          publicBaseUrl: "https://device-sync.example.test",
          secret: "secret_123",
        },
        managedAutoReplyChannels: [
          { capabilityReady: true, channel: "voice" },
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
          providerConfigs: { junction: { environment: "sandbox", region: "us", fetchImpl: () => {} } },
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
          providerConfigs: { junction: { environment: "sandbox", region: "us", webhookSecret: "synthetic-secret" } },
          publicBaseUrl: "https://device-sync.example.test",
          secret: "secret_123",
        },
      },
    })).toThrow(/webhookSecret is a provider-owned webhook secret/u);
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
