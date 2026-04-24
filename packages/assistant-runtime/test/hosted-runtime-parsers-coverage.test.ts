import { describe, expect, it } from "vitest";

import {
  parseHostedAssistantRuntimeConfig,
  parseHostedAssistantRuntimeJobInput,
  parseHostedAssistantRuntimeJobRequest,
} from "../src/hosted-runtime/parsers.ts";
import { resolveHostedWake } from "../src/hosted-runtime/utils.ts";

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

function buildRuntimeTimerJobRequest(overrides: Record<string, unknown> = {}) {
  return {
    bundle: null,
    run: {
      attempt: 1,
      runId: "run_123",
      startedAt: "2026-04-08T00:00:01.000Z",
    },
    runDrain: {
      acquiredAt: "2026-04-08T00:00:00.000Z",
      events: [],
      inputCommittedSeq: "24",
      inputCursorVersion: "4",
      runId: "run_123",
      triggerKind: "runtime_timer",
      userId: "member_123",
    },
    ...overrides,
  };
}

describe("hosted runtime parser coverage", () => {
  it("rejects missing or null runDrain on runtime job inputs", () => {
    expect(() => parseHostedAssistantRuntimeJobInput({
      request: {
        bundle: null,
        wake: buildMemberActivatedWake("evt_123"),
      },
    })).toThrow(/runDrain is required/u);

    expect(() => parseHostedAssistantRuntimeJobInput({
      request: {
        bundle: null,
        wake: buildMemberActivatedWake("evt_123"),
        runDrain: null,
      },
    })).toThrow(/runDrain is required/u);
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

  it("rejects non-object job inputs for both null and array values", () => {
    expect(() => parseHostedAssistantRuntimeJobInput(null)).toThrow(
      /Hosted assistant runtime job input must be an object/u,
    );
    expect(() => parseHostedAssistantRuntimeJobInput([])).toThrow(
      /Hosted assistant runtime job input must be an object/u,
    );
  });

  it("parses run-drain finalize requests", () => {
    const parsed = parseHostedAssistantRuntimeJobRequest(buildRuntimeTimerJobRequest({
      runDrain: {
        acquiredAt: "2026-04-08T00:00:00.000Z",
        events: [],
        inputCommittedSeq: "24",
        inputCursorVersion: "4",
        resumeFinalize: true,
        runId: "run_123",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
    }));

    expect(resolveHostedWake(parsed.runDrain)).toEqual({
      eventId: "hosted-run:run_123",
      kind: "runtime.timer",
      occurredAt: "2026-04-08T00:00:00.000Z",
      triggerKind: "runtime_timer",
      userId: "member_123",
    });
    expect(parsed.runDrain.resumeFinalize).toBe(true);
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

  it("rejects invalid run-drain finalize flags", () => {
    expect(() => parseHostedAssistantRuntimeJobRequest(buildRuntimeTimerJobRequest({
      runDrain: {
        acquiredAt: "2026-04-08T00:00:00.000Z",
        events: [],
        inputCommittedSeq: "24",
        inputCursorVersion: "4",
        resumeFinalize: "yes",
        runId: "run_123",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
    }))).toThrow(/resumeFinalize must be a boolean/u);
  });

  it("rejects legacy request.wake once runDrain is present", () => {
    expect(() => parseHostedAssistantRuntimeJobRequest({
      bundle: null,
      run: {
        attempt: 1,
        runId: "run_legacy_wake",
        startedAt: "2026-04-08T00:00:01.000Z",
      },
      runDrain: {
        acquiredAt: "2026-04-08T00:00:00.000Z",
        events: [],
        inputCommittedSeq: "24",
        inputCursorVersion: "4",
        runId: "run_legacy_wake",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      wake: {
        eventId: "hosted-run:run_legacy_wake",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
    })).toThrow(/request\.wake is no longer supported/u);
  });

  it("derives a synthetic runtime-timer wake from empty run-drain requests", () => {
    const parsed = parseHostedAssistantRuntimeJobRequest(buildRuntimeTimerJobRequest({
      run: {
        attempt: 1,
        runId: "run_empty_drain",
        startedAt: "2026-04-08T00:00:01.000Z",
      },
      runDrain: {
        acquiredAt: "2026-04-08T00:00:00.000Z",
        events: [],
        inputCommittedSeq: "24",
        inputCursorVersion: "4",
        runId: "run_empty_drain",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
    }));

    expect(resolveHostedWake(parsed.runDrain)).toEqual({
      eventId: "hosted-run:run_empty_drain",
      kind: "runtime.timer",
      occurredAt: "2026-04-08T00:00:00.000Z",
      triggerKind: "runtime_timer",
      userId: "member_123",
    });
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

  it("parses nullable and string run tokens on hosted runtime job requests", () => {
    expect(
      parseHostedAssistantRuntimeJobRequest(buildRuntimeTimerJobRequest({
        runToken: null,
      })).runToken,
    ).toBeNull();

    expect(
      parseHostedAssistantRuntimeJobRequest(buildRuntimeTimerJobRequest({
        runToken: "run-token-123",
      })).runToken,
    ).toBe("run-token-123");
  });

  it("rejects invalid run tokens", () => {
    expect(() => parseHostedAssistantRuntimeJobRequest(buildRuntimeTimerJobRequest({
      runToken: "",
    }))).toThrow(/request runToken must be a non-empty string/u);
  });
});
