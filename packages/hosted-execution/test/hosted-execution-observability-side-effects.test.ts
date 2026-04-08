import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedAssistantDeliveryPreparedRecord,
  buildHostedAssistantDeliverySentRecord,
  buildHostedAssistantDeliverySideEffect,
  buildHostedExecutionStructuredLogRecord,
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  normalizeHostedExecutionOperatorMessage,
  parseHostedExecutionSideEffect,
  parseHostedExecutionSideEffectRecord,
  parseHostedExecutionSideEffects,
  sameHostedExecutionAssistantDelivery,
  sameHostedExecutionSideEffectIdentity,
  summarizeHostedExecutionError,
  summarizeHostedExecutionErrorCode,
} from "../src/index.ts";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("hosted execution observability", () => {
  it("derives hosted execution error codes across the supported seams", () => {
    const cases: Array<[unknown, string]> = [
      [Object.assign(new Error("bad"), { name: "HostedExecutionConfigurationError" }), "configuration_error"],
      [new Error("HOSTED_EXECUTION_TOKEN must be configured."), "configuration_error"],
      [new Error("durable commit failed"), "durable_commit_error"],
      [new Error("durable finalize failed"), "durable_finalize_error"],
      [new Error("Runner returned HTTP 502"), "runner_http_error"],
      [new Error("forbidden by authorization policy"), "authorization_error"],
      [new Error("request body must be a json object"), "invalid_request"],
      [Object.assign(new Error("aborted"), { name: "AbortError" }), "timeout"],
      [new TypeError("wrong type"), "type_error"],
      ["plain failure", "runtime_error"],
    ];

    for (const [error, expected] of cases) {
      expect(deriveHostedExecutionErrorCode(error)).toBe(expected);
    }
  });

  it("normalizes operator messages with redaction, whitespace cleanup, defaults, and truncation", () => {
    expect(normalizeHostedExecutionOperatorMessage(" \n\t ")).toBe("Hosted execution event.");

    expect(
      normalizeHostedExecutionOperatorMessage(
        "Authorization: Bearer secret-token hello user@example.com token=my-token "
        + "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
      ),
    ).toBe(
      "Authorization=Bearer [redacted] hello [redacted-email] token=[redacted] [redacted-token]",
    );

    const repeated = "x".repeat(260);
    const normalized = normalizeHostedExecutionOperatorMessage(repeated);
    expect(normalized).toHaveLength(200);
    expect(normalized.endsWith("…")).toBe(true);
  });

  it("summarizes errors using safe operator-facing messages only", () => {
    expect(
      summarizeHostedExecutionError(new Error("CF_API_TOKEN must be configured for hosted execution.")),
    ).toBe("CF_API_TOKEN must be configured for hosted execution.");
    expect(
      summarizeHostedExecutionError(new Error("missing token for alice@example.com")),
    ).toBe("Hosted execution configuration is invalid.");
    expect(summarizeHostedExecutionError(new Error("Runner returned HTTP 504 from upstream"))).toBe(
      "Hosted runner container returned HTTP 504.",
    );
    expect(summarizeHostedExecutionErrorCode("authorization_error")).toBe(
      "Hosted execution authorization failed.",
    );
    expect(summarizeHostedExecutionErrorCode("not-real")).toBe(
      "Hosted execution runtime failed.",
    );
    expect(summarizeHostedExecutionErrorCode(null)).toBeNull();
  });

  it("builds structured logs with normalized messages, safe errors, and dispatch precedence", () => {
    const record = buildHostedExecutionStructuredLogRecord({
      component: "runner",
      dispatch: { eventId: "evt_dispatch" },
      error: Object.assign(new TypeError("wrong type"), { name: "TypeError" }),
      eventId: "evt_fallback",
      message: "  Bearer top-secret user@example.com  ",
      phase: "runtime.starting",
      run: {
        attempt: 2,
        runId: "run_123",
        startedAt: "2026-04-08T00:00:00.000Z",
      },
      time: "2026-04-08T00:01:00.000Z",
      userId: "user_123",
    });

    expect(record).toEqual({
      attempt: 2,
      component: "runner",
      errorCode: "type_error",
      errorMessage: "Hosted execution runtime failed.",
      errorName: "TypeError",
      eventId: "evt_dispatch",
      level: "error",
      message: "Bearer [redacted] [redacted-email]",
      phase: "runtime.starting",
      runId: "run_123",
      schema: "murph.hosted-execution.log.v1",
      time: "2026-04-08T00:01:00.000Z",
      userId: "user_123",
    });

    const unsafeErrorRecord = buildHostedExecutionStructuredLogRecord({
      component: "runner",
      error: Object.assign(new Error("plain failure"), { name: "TotallyCustomError" }),
      message: "started",
      phase: "claimed",
    });

    expect(unsafeErrorRecord.errorName).toBeUndefined();
    expect(unsafeErrorRecord.level).toBe("error");
  });

  it("emits structured logs only when stdio logging is enabled", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    process.env.VITEST = "true";
    emitHostedExecutionStructuredLog({
      component: "runner",
      level: "info",
      message: "quiet",
      phase: "claimed",
    });
    expect(infoSpy).not.toHaveBeenCalled();

    process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = "on";
    emitHostedExecutionStructuredLog({
      component: "runner",
      level: "warn",
      message: "warn",
      phase: "retry.scheduled",
    });
    emitHostedExecutionStructuredLog({
      component: "runner",
      message: "boom",
      phase: "failed",
      error: new Error("failure"),
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warnSpy.mock.calls[0]?.[0] as string)).toMatchObject({
      level: "warn",
      message: "warn",
      phase: "retry.scheduled",
    });

    process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = "off";
    emitHostedExecutionStructuredLog({
      component: "runner",
      level: "info",
      message: "quiet again",
      phase: "completed",
    });
    expect(infoSpy).not.toHaveBeenCalled();
  });
});

describe("hosted execution side-effects", () => {
  const delivery = {
    channel: "email",
    idempotencyKey: "idem_123",
    messageLength: 42,
    providerMessageId: "provider_msg_123",
    providerThreadId: null,
    sentAt: "2026-04-08T00:00:00.000Z",
    target: "assistant@example.com",
    targetKind: "explicit" as const,
  };

  it("builds and parses assistant delivery side effects and records", () => {
    expect(buildHostedAssistantDeliverySideEffect({
      dedupeKey: "dedupe_123",
      intentId: "intent_123",
    })).toEqual({
      effectId: "intent_123",
      fingerprint: "dedupe_123",
      intentId: "intent_123",
      kind: "assistant.delivery",
    });

    expect(buildHostedAssistantDeliveryPreparedRecord({
      dedupeKey: "dedupe_123",
      intentId: "intent_123",
      recordedAt: "2026-04-08T00:00:00.000Z",
    })).toEqual({
      effectId: "intent_123",
      fingerprint: "dedupe_123",
      intentId: "intent_123",
      kind: "assistant.delivery",
      recordedAt: "2026-04-08T00:00:00.000Z",
      state: "prepared",
    });

    expect(buildHostedAssistantDeliverySentRecord({
      dedupeKey: "dedupe_123",
      delivery,
      intentId: "intent_123",
    })).toEqual({
      delivery,
      effectId: "intent_123",
      fingerprint: "dedupe_123",
      intentId: "intent_123",
      kind: "assistant.delivery",
      recordedAt: "2026-04-08T00:00:00.000Z",
      state: "sent",
    });

    expect(parseHostedExecutionSideEffect({
      effectId: "effect_123",
      fingerprint: "fingerprint_123",
      intentId: "intent_123",
      kind: "assistant.delivery",
    })).toEqual({
      effectId: "effect_123",
      fingerprint: "fingerprint_123",
      intentId: "intent_123",
      kind: "assistant.delivery",
    });

    expect(parseHostedExecutionSideEffectRecord({
      delivery,
      effectId: "effect_123",
      fingerprint: "fingerprint_123",
      intentId: "intent_123",
      kind: "assistant.delivery",
      recordedAt: "2026-04-08T00:00:00.000Z",
      state: "sent",
    })).toEqual({
      delivery,
      effectId: "effect_123",
      fingerprint: "fingerprint_123",
      intentId: "intent_123",
      kind: "assistant.delivery",
      recordedAt: "2026-04-08T00:00:00.000Z",
      state: "sent",
    });

    expect(parseHostedExecutionSideEffects("not-an-array")).toEqual([]);
  });

  it("compares side-effect identities and delivery payloads structurally", () => {
    expect(sameHostedExecutionSideEffectIdentity(
      {
        effectId: "effect_123",
        fingerprint: "fingerprint_123",
        intentId: "intent_123",
        kind: "assistant.delivery",
      },
      {
        effectId: "effect_123",
        fingerprint: "fingerprint_123",
        intentId: "intent_123",
        kind: "assistant.delivery",
      },
    )).toBe(true);
    expect(sameHostedExecutionSideEffectIdentity(
      {
        effectId: "effect_123",
        fingerprint: "fingerprint_123",
        intentId: "intent_123",
        kind: "assistant.delivery",
      },
      {
        effectId: "effect_123",
        fingerprint: "other",
        intentId: "intent_123",
        kind: "assistant.delivery",
      },
    )).toBe(false);

    expect(sameHostedExecutionAssistantDelivery(delivery, { ...delivery })).toBe(true);
    expect(sameHostedExecutionAssistantDelivery(delivery, {
      ...delivery,
      providerThreadId: "thread_123",
    })).toBe(false);
  });

  it("fails closed on invalid side-effect shapes", () => {
    expect(() => parseHostedExecutionSideEffect(null)).toThrow(
      /Hosted execution side effect must be an object/i,
    );
    expect(() => parseHostedExecutionSideEffect({
      effectId: "effect_123",
      fingerprint: "fingerprint_123",
      intentId: "intent_123",
      kind: "other",
    })).toThrow(/Unsupported hosted execution side effect kind: other/i);

    expect(() => parseHostedExecutionSideEffectRecord({
      effectId: "effect_123",
      fingerprint: "fingerprint_123",
      intentId: "intent_123",
      kind: "assistant.delivery",
      recordedAt: "2026-04-08T00:00:00.000Z",
      state: "unknown",
    })).toThrow(/Unsupported hosted execution side effect record state: unknown/i);

    expect(() => buildHostedAssistantDeliveryPreparedRecord({
      dedupeKey: "dedupe_123",
      intentId: "intent_123",
      recordedAt: "",
    })).toThrow(/recordedAt must be a non-empty string/i);

    expect(() => buildHostedAssistantDeliverySentRecord({
      dedupeKey: "dedupe_123",
      delivery: {
        ...delivery,
        messageLength: -1,
      },
      intentId: "intent_123",
    })).toThrow(/messageLength must be a non-negative integer/i);

    expect(() => parseHostedExecutionSideEffectRecord({
      delivery: {
        ...delivery,
        targetKind: "group",
      },
      effectId: "effect_123",
      fingerprint: "fingerprint_123",
      intentId: "intent_123",
      kind: "assistant.delivery",
      recordedAt: "2026-04-08T00:00:00.000Z",
      state: "sent",
    })).toThrow(/Unsupported hosted execution assistant delivery target kind: group/i);
  });
});
