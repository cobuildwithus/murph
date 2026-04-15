import { describe, expect, it } from "vitest";

import {
  parseHostedAssistantRuntimeJobInput,
} from "../src/hosted-runtime.ts";

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
        dispatch: {
          event: {
            firstContact: {
              channel: "linq",
              identityId: "hbidx:phone:v1:test",
              threadId: "chat_123",
              threadIsDirect: true,
            },
            kind: "member.activated",
            userId: "member_123",
          },
          eventId: "evt_123",
          occurredAt: "2026-04-01T00:00:00.000Z",
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

    expect(parsed.request.dispatch.eventId).toBe("evt_123");
    expect(parsed.request.dispatch.event).toEqual({
      firstContact: {
        channel: "linq",
        identityId: "hbidx:phone:v1:test",
        threadId: "chat_123",
        threadIsDirect: true,
      },
      kind: "member.activated",
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
        dispatch: {
          event: {
            firstContact: {
              channel: "linq",
              fromPhoneNumber: "+15550001111",
              identityId: "hbidx:phone:v1:test",
              kind: "linq-materialize-home-thread",
              toPhoneNumber: "+15550002222",
            },
            kind: "member.activated",
            userId: "member_123",
          },
          eventId: "evt_materialize_linq_home",
          occurredAt: "2026-04-01T00:00:00.000Z",
        },
      },
    });

    expect(parsed.request.dispatch.event).toEqual({
      firstContact: {
        channel: "linq",
        fromPhoneNumber: "+15550001111",
        identityId: "hbidx:phone:v1:test",
        kind: "linq-materialize-home-thread",
        toPhoneNumber: "+15550002222",
      },
      kind: "member.activated",
      userId: "member_123",
    });
  });

  it("rejects malformed nested runtime env records", () => {
    expect(() => parseHostedAssistantRuntimeJobInput({
      request: {
        bundle: null,
        dispatch: {
          event: {
            kind: "member.activated",
            userId: "member_123",
          },
          eventId: "evt_123",
          occurredAt: "2026-04-01T00:00:00.000Z",
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
        dispatch: {
          event: {
            kind: "member.activated",
            userId: "member_123",
          },
          eventId: "evt_123",
          occurredAt: "2026-04-01T00:00:00.000Z",
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
        dispatch: {
          event: {
            kind: "member.activated",
            userId: "member_123",
          },
          eventId: "evt_legacy_side_effects",
          occurredAt: "2026-04-01T00:00:00.000Z",
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
        dispatch: {
          event: {
            kind: "member.activated",
            userId: "member_123",
          },
          eventId: "evt_missing_run",
          occurredAt: "2026-04-01T00:00:00.000Z",
        },
      },
    });

    expect(parsed.request.currentBundleRef?.key).toBe("bundles/user/vault.json");
  });
});
