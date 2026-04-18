import { describe, expect, it } from "vitest";

import {
  parseHostedAssistantRuntimeJobInput,
} from "../src/hosted-runtime.ts";

const defaultMemberChannels = {
  email: false,
  linq: false,
  telegram: false,
} as const;

describe("parseHostedAssistantRuntimeJobInput", () => {
  it("parses the nested runtime envelope", () => {
    const parsed = parseHostedAssistantRuntimeJobInput({
      request: {
        bundle: "vault-bundle",
        currentBundleRef: {
          hash: "abc123",
          key: "bundles/user/vault.json",
          size: 42,
          updatedAt: "2026-04-01T00:00:02.000Z",
        },
        wake: {
          eventId: "evt_123",
          firstContact: {
            channel: "linq",
            identityId: "hbidx:phone:v1:test",
            threadId: "chat_123",
            threadIsDirect: true,
          },
          kind: "member.activated",
          memberChannels: defaultMemberChannels,
          occurredAt: "2026-04-01T00:00:00.000Z",
          userId: "member_123",
        },
        run: {
          attempt: 2,
          runId: "run_123",
          startedAt: "2026-04-01T00:00:01.000Z",
        },
        resume: {
          committedResult: {
            result: {
              eventsHandled: 1,
              nextWakeAt: null,
              summary: "completed",
            },
            assistantDeliveryEffects: [],
          },
        },
      },
      runtime: {
        userEnv: {
          OPENAI_API_KEY: "secret",
        },
      },
    });

    expect(parsed.request.wake.eventId).toBe("evt_123");
    expect(parsed.request.wake).toEqual({
      eventId: "evt_123",
      firstContact: {
        channel: "linq",
        identityId: "hbidx:phone:v1:test",
        threadId: "chat_123",
        threadIsDirect: true,
      },
      kind: "member.activated",
      memberChannels: defaultMemberChannels,
      occurredAt: "2026-04-01T00:00:00.000Z",
      userId: "member_123",
    });
    expect(parsed.request.bundle).toBe("vault-bundle");
    expect(parsed.request.currentBundleRef?.key).toBe("bundles/user/vault.json");
    expect(parsed.request.resume?.committedResult.assistantDeliveryEffects).toEqual([]);
    expect(parsed.runtime?.userEnv).toEqual({ OPENAI_API_KEY: "secret" });
  });

  it("parses Linq first-contact targets that materialize a home thread on first welcome delivery", () => {
    const parsed = parseHostedAssistantRuntimeJobInput({
      request: {
        bundle: null,
        wake: {
          eventId: "evt_materialize_linq_home",
          firstContact: {
            channel: "linq",
            fromPhoneNumber: "+15550001111",
            identityId: "hbidx:phone:v1:test",
            kind: "linq-materialize-home-thread",
            toPhoneNumber: "+15550002222",
          },
          kind: "member.activated",
          memberChannels: defaultMemberChannels,
          occurredAt: "2026-04-01T00:00:00.000Z",
          userId: "member_123",
        },
      },
    });

    expect(parsed.request.wake).toEqual({
      eventId: "evt_materialize_linq_home",
      firstContact: {
        channel: "linq",
        fromPhoneNumber: "+15550001111",
        identityId: "hbidx:phone:v1:test",
        kind: "linq-materialize-home-thread",
        toPhoneNumber: "+15550002222",
      },
      kind: "member.activated",
      memberChannels: defaultMemberChannels,
      occurredAt: "2026-04-01T00:00:00.000Z",
      userId: "member_123",
    });
  });

  it("rejects malformed nested runtime env records", () => {
    expect(() => parseHostedAssistantRuntimeJobInput({
      request: {
        bundle: null,
        wake: {
          eventId: "evt_123",
          kind: "member.activated",
          memberChannels: defaultMemberChannels,
          occurredAt: "2026-04-01T00:00:00.000Z",
          userId: "member_123",
        },
      },
      runtime: {
        userEnv: {
          OPENAI_API_KEY: 123,
        },
      },
    })).toThrow(/userEnv\.OPENAI_API_KEY must be a string/i);
  });

  it("rejects removed runtime callback override fields", () => {
    expect(() => parseHostedAssistantRuntimeJobInput({
      request: {
        bundle: null,
        wake: {
          eventId: "evt_123",
          kind: "member.activated",
          memberChannels: defaultMemberChannels,
          occurredAt: "2026-04-01T00:00:00.000Z",
          userId: "member_123",
        },
      },
      runtime: {
        webControlPlane: {
          shareBaseUrl: "https://murph.example.com",
        },
      },
    })).toThrow(/runtime config\.webControlPlane is no longer supported/i);
  });

  it("rejects the removed resume sideEffects alias", () => {
    expect(() => parseHostedAssistantRuntimeJobInput({
      request: {
        bundle: null,
        wake: {
          eventId: "evt_legacy_side_effects",
          kind: "member.activated",
          memberChannels: defaultMemberChannels,
          occurredAt: "2026-04-01T00:00:00.000Z",
          userId: "member_123",
        },
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
      },
    })).toThrow(/committedResult\.sideEffects is no longer supported/i);
  });

  it("accepts currentBundleRef without request.run", () => {
    const parsed = parseHostedAssistantRuntimeJobInput({
      request: {
        bundle: "vault-bundle",
        currentBundleRef: {
          hash: "abc123",
          key: "bundles/user/vault.json",
          size: 42,
          updatedAt: "2026-04-01T00:00:02.000Z",
        },
        wake: {
          eventId: "evt_missing_run",
          kind: "member.activated",
          memberChannels: defaultMemberChannels,
          occurredAt: "2026-04-01T00:00:00.000Z",
          userId: "member_123",
        },
      },
    });

    expect(parsed.request.currentBundleRef?.key).toBe("bundles/user/vault.json");
  });
});
