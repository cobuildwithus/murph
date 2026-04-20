import { describe, expect, it } from "vitest";

import { buildHostedExecutionRuntimeTimerWake } from "@murphai/hosted-execution";

import {
  parseHostedAssistantRuntimeJobInput,
} from "../src/hosted-runtime.ts";
import { resolveHostedWake } from "../src/hosted-runtime/utils.ts";

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
        run: {
          attempt: 2,
          runId: "run_123",
          startedAt: "2026-04-01T00:00:01.000Z",
        },
        runDrain: {
          acquiredAt: "2026-04-01T00:00:01.000Z",
          events: [
            {
              seq: "24",
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
              wakeId: "wake_24",
            },
          ],
          inputCommittedSeq: "24",
          inputCursorVersion: "4",
          resumeFinalize: true,
          runId: "run_123",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
      },
      runtime: {
        userEnv: {
          OPENAI_API_KEY: "secret",
        },
      },
    });

    expect(resolveHostedWake(parsed.request)).toEqual({
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
    expect(parsed.request.runDrain.resumeFinalize).toBe(true);
    expect(parsed.runtime?.userEnv).toEqual({ OPENAI_API_KEY: "secret" });
  });

  it("parses Linq first-contact targets that materialize a home thread on first welcome delivery", () => {
    const parsed = parseHostedAssistantRuntimeJobInput({
      request: {
        bundle: null,
        run: {
          attempt: 1,
          runId: "run_materialize_linq_home",
          startedAt: "2026-04-01T00:00:01.000Z",
        },
        runDrain: {
          acquiredAt: "2026-04-01T00:00:01.000Z",
          events: [
            {
              seq: "24",
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
              wakeId: "wake_24",
            },
          ],
          inputCommittedSeq: "24",
          inputCursorVersion: "4",
          runId: "run_materialize_linq_home",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
      },
    });

    expect(resolveHostedWake(parsed.request)).toEqual({
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
        run: {
          attempt: 1,
          runId: "run_bad_user_env",
          startedAt: "2026-04-01T00:00:01.000Z",
        },
        runDrain: {
          acquiredAt: "2026-04-01T00:00:01.000Z",
          events: [
            {
              seq: "24",
              wake: {
                eventId: "evt_123",
                kind: "member.activated",
                memberChannels: defaultMemberChannels,
                occurredAt: "2026-04-01T00:00:00.000Z",
                userId: "member_123",
              },
              wakeId: "wake_24",
            },
          ],
          inputCommittedSeq: "24",
          inputCursorVersion: "4",
          runId: "run_bad_user_env",
          triggerKind: "runtime_timer",
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
        run: {
          attempt: 1,
          runId: "run_removed_runtime_fields",
          startedAt: "2026-04-01T00:00:01.000Z",
        },
        runDrain: {
          acquiredAt: "2026-04-01T00:00:01.000Z",
          events: [
            {
              seq: "24",
              wake: {
                eventId: "evt_123",
                kind: "member.activated",
                memberChannels: defaultMemberChannels,
                occurredAt: "2026-04-01T00:00:00.000Z",
                userId: "member_123",
              },
              wakeId: "wake_24",
            },
          ],
          inputCommittedSeq: "24",
          inputCursorVersion: "4",
          runId: "run_removed_runtime_fields",
          triggerKind: "runtime_timer",
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

  it("parses run-drain finalize requests", () => {
    const parsed = parseHostedAssistantRuntimeJobInput({
      request: {
        bundle: null,
        run: {
          attempt: 1,
          runId: "run_123",
          startedAt: "2026-04-01T00:00:01.000Z",
        },
        runDrain: {
          acquiredAt: "2026-04-01T00:00:01.000Z",
          events: [],
          inputCommittedSeq: "24",
          inputCursorVersion: "4",
          resumeFinalize: true,
          runId: "run_123",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
      },
    });

    expect(resolveHostedWake(parsed.request)).toEqual(buildHostedExecutionRuntimeTimerWake({
      eventId: "hosted-run:run_123",
      occurredAt: "2026-04-01T00:00:01.000Z",
      triggerKind: "runtime_timer",
      userId: "member_123",
    }));
    expect(parsed.request.runDrain.resumeFinalize).toBe(true);
  });

  it("accepts currentBundleRef on run-drain requests", () => {
    const parsed = parseHostedAssistantRuntimeJobInput({
      request: {
        bundle: "vault-bundle",
        currentBundleRef: {
          hash: "abc123",
          key: "bundles/user/vault.json",
          size: 42,
          updatedAt: "2026-04-01T00:00:02.000Z",
        },
        run: {
          attempt: 1,
          runId: "run_missing_run",
          startedAt: "2026-04-01T00:00:01.000Z",
        },
        runDrain: {
          acquiredAt: "2026-04-01T00:00:01.000Z",
          events: [],
          inputCommittedSeq: "24",
          inputCursorVersion: "4",
          runId: "run_missing_run",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
      },
    });

    expect(parsed.request.currentBundleRef?.key).toBe("bundles/user/vault.json");
  });

  it("rejects legacy request.wake when runDrain is present", () => {
    expect(() => parseHostedAssistantRuntimeJobInput({
      request: {
        bundle: null,
        run: {
          attempt: 1,
          runId: "run_legacy_wake",
          startedAt: "2026-04-01T00:00:01.000Z",
        },
        runDrain: {
          acquiredAt: "2026-04-01T00:00:01.000Z",
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
          occurredAt: "2026-04-01T00:00:01.000Z",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
      },
    })).toThrow(/request\.wake is no longer supported/i);
  });

  it("rejects missing runDrain on runtime job inputs", () => {
    expect(() => parseHostedAssistantRuntimeJobInput({
      request: {
        bundle: null,
        wake: {
          eventId: "evt_missing_run_drain",
          kind: "member.activated",
          memberChannels: defaultMemberChannels,
          occurredAt: "2026-04-01T00:00:00.000Z",
          userId: "member_123",
        },
      },
    })).toThrow(/runDrain is required/i);
  });
});
