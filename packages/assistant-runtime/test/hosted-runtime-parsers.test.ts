import { describe, expect, it } from "vitest";

import {
  parseHostedAssistantRuntimeJobInput,
} from "../src/hosted-runtime.ts";

describe("parseHostedAssistantRuntimeJobInput", () => {
  it("parses the nested runtime envelope", () => {
    const parsed = parseHostedAssistantRuntimeJobInput({
      request: {
        bundles: {
          agentState: "agent-state-bundle",
          vault: null,
        },
        commit: {
          bundleRefs: {
            agentState: {
              hash: "abc123",
              key: "bundles/user/agent-state.json",
              size: 42,
              updatedAt: "2026-04-01T00:00:02.000Z",
            },
            vault: null,
          },
        },
        dispatch: {
          event: {
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
            sideEffects: [],
          },
        },
      },
      runtime: {
        internalWorkerProxyToken: "proxy_123",
        userEnv: {
          OPENAI_API_KEY: "secret",
        },
        webControlPlane: {
          shareBaseUrl: "https://murph.example.com",
        },
      },
    });

    expect(parsed.request.dispatch.eventId).toBe("evt_123");
    expect(parsed.request.commit?.bundleRefs.agentState?.key).toBe("bundles/user/agent-state.json");
    expect(parsed.runtime?.internalWorkerProxyToken).toBe("proxy_123");
    expect(parsed.runtime?.userEnv).toEqual({ OPENAI_API_KEY: "secret" });
    expect(parsed.runtime?.webControlPlane).toEqual({
      shareBaseUrl: "https://murph.example.com",
    });
  });

  it("rejects malformed nested runtime env records", () => {
    expect(() => parseHostedAssistantRuntimeJobInput({
      request: {
        bundles: {
          agentState: null,
          vault: null,
        },
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
});
