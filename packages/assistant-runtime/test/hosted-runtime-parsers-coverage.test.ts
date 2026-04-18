import { describe, expect, it } from "vitest";

import {
  parseHostedAssistantRuntimeConfig,
  parseHostedAssistantRuntimeJobInput,
  parseHostedAssistantRuntimeJobRequest,
} from "../src/hosted-runtime/parsers.ts";

const defaultMemberChannels = {
  email: false,
  linq: false,
  telegram: false,
} as const;

function buildMemberActivatedWake(eventId: string) {
  return {
    eventId,
    kind: "member.activated" as const,
    memberChannels: defaultMemberChannels,
    occurredAt: "2026-04-08T00:00:00.000Z",
    userId: "member_123",
  };
}

describe("hosted runtime parser coverage", () => {
  it("parses nullable commit and resume branches without injecting optional runtime state", () => {
    const parsed = parseHostedAssistantRuntimeJobInput({
      request: {
        bundle: null,
        wake: buildMemberActivatedWake("evt_123"),
        resume: null,
      },
    });

    expect(parsed).toEqual({
      request: {
        bundle: null,
        wake: buildMemberActivatedWake("evt_123"),
        resume: null,
      },
    });
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
      },
      userEnv: {
        OPENAI_API_KEY: "secret",
      },
    });
  });

  it("rejects non-object job inputs for both null and array values", () => {
    expect(() => parseHostedAssistantRuntimeJobInput(null)).toThrow(
      /Hosted assistant runtime job input must be an object/u,
    );
    expect(() => parseHostedAssistantRuntimeJobInput([])).toThrow(
      /Hosted assistant runtime job input must be an object/u,
    );
  });

  it("rejects invalid runner summaries and runtime numeric fields", () => {
    expect(() => parseHostedAssistantRuntimeJobRequest({
      bundle: null,
      wake: buildMemberActivatedWake("evt_invalid_summary"),
      resume: {
        committedResult: {
          result: {
            eventsHandled: Number.POSITIVE_INFINITY,
            summary: "",
          },
          assistantDeliveryEffects: [],
        },
      },
    })).toThrow(/eventsHandled must be a finite number/u);

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

  it("rejects invalid non-null next wake timestamps and empty summaries", () => {
    expect(() => parseHostedAssistantRuntimeJobRequest({
      bundle: null,
      wake: buildMemberActivatedWake("evt_invalid_next_wake"),
      resume: {
        committedResult: {
          result: {
            eventsHandled: 1,
            nextWakeAt: false,
            summary: "completed",
          },
          assistantDeliveryEffects: [],
        },
      },
    })).toThrow(/nextWakeAt must be a non-empty string/u);

    expect(() => parseHostedAssistantRuntimeJobRequest({
      bundle: null,
      wake: buildMemberActivatedWake("evt_empty_summary"),
      resume: {
        committedResult: {
          result: {
            eventsHandled: 1,
            nextWakeAt: null,
            summary: "",
          },
          assistantDeliveryEffects: [],
        },
      },
    })).toThrow(/summary must be a non-empty string/u);
  });

  it("rejects removed resume sideEffects aliases", () => {
    expect(() => parseHostedAssistantRuntimeJobRequest({
      bundle: null,
      wake: buildMemberActivatedWake("evt_removed_side_effects"),
      resume: {
        committedResult: {
          result: {
            eventsHandled: 1,
            nextWakeAt: null,
            summary: "completed",
          },
          sideEffects: [],
        },
      },
    })).toThrow(/committedResult\.sideEffects is no longer supported/u);
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
});
