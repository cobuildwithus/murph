import { describe, expect, it } from "vitest";

import {
  parseHostedAssistantRuntimeJobInput,
} from "../src/hosted-runtime.ts";

describe("parseHostedAssistantRuntimeJobInput", () => {
  it("parses the nested runtime envelope", () => {
    const parsed = parseHostedAssistantRuntimeJobInput({
      request: {
        bundle: "vault-bundle",
        commit: {
          bundleRef: {
            hash: "abc123",
            key: "bundles/user/vault.json",
            size: 42,
            updatedAt: "2026-04-01T00:00:02.000Z",
          },
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
    expect(parsed.request.commit?.bundleRef?.key).toBe("bundles/user/vault.json");
    expect(parsed.request.resume?.committedResult.assistantDeliveryEffects).toEqual([]);
    expect(parsed.runtime?.userEnv).toEqual({ OPENAI_API_KEY: "secret" });
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

  it("rejects commit callbacks that omit request.run", () => {
    expect(() => parseHostedAssistantRuntimeJobInput({
      request: {
        bundle: "vault-bundle",
        commit: {
          bundleRef: {
            hash: "abc123",
            key: "bundles/user/vault.json",
            size: 42,
            updatedAt: "2026-04-01T00:00:02.000Z",
          },
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
    })).toThrow(/commit callback requires request\.run/i);
  });
});
