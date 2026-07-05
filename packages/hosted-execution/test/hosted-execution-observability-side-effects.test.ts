import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_ASSISTANT_DELIVERY_KIND,
  buildHostedAssistantDeliverySendingRecord,
  buildHostedAssistantDeliverySentRecord,
  buildHostedAssistantDeliverySideEffect,
  buildHostedExecutionPrefixedSafeErrorDiagnostics,
  buildHostedExecutionSafeErrorDetails,
  buildHostedExecutionStructuredLogRecord,
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  extractHostedAssistantNotificationRedactedDetails,
  formatHostedExecutionLogMessage,
  isHostedAssistantDeliveryKind,
  isHostedExecutionLogLevel,
  isHostedExecutionLogPhase,
  normalizeHostedExecutionErrorMessage,
  normalizeHostedExecutionOperatorMessage,
  parseHostedAssistantDeliveryRecord,
  parseHostedAssistantDeliverySideEffect,
  parseHostedAssistantDeliverySideEffects,
  readHostedExecutionSafeErrorName,
  sanitizeHostedExecutionStructuredLogDetails,
  sanitizeHostedExecutionStructuredLogText,
  sameHostedAssistantDeliverySideEffectIdentity,
  sameHostedAssistantDeliveryReceipt,
  summarizeHostedExecutionError,
  summarizeHostedExecutionErrorCode,
} from "../src/index.ts";
import type { HostedAssistantDeliveryPayload } from "../src/side-effects.ts";

const ORIGINAL_ENV = { ...process.env };

function createHostedAssistantDeliveryPayload(
  overrides: Partial<HostedAssistantDeliveryPayload> = {},
): HostedAssistantDeliveryPayload {
  return {
    actorId: "actor_123",
    bindingDeliveryKind: "participant",
    bindingDeliveryTarget: "chat_123",
    channel: "telegram",
    deliverySourceKey: null,
    explicitTarget: null,
    idempotencyKey: "assistant-outbox:intent_123",
    identityId: "identity_123",
    media: [],
    message: "hello from hosted execution",
    subject: null,
    replyToMessageId: null,
    sessionId: "session_123",
    threadId: "thread_123",
    threadIsDirect: true,
    transportIdempotent: false,
    turnId: "turn_123",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("hosted execution observability", () => {
  it("derives hosted execution error codes across the supported seams", () => {
    const cases: Array<[unknown, string]> = [
      [Object.assign(new Error("bad"), { name: "HostedExecutionConfigurationError" }), "configuration_error"],
      [new Error("HOSTED_EXECUTION_TOKEN must be configured."), "configuration_error"],
      [new Error("checkpoint failed"), "checkpoint_error"],
      [new Error("outbox failed"), "outbox_error"],
      [new Error("Runner returned HTTP 502"), "runner_http_error"],
      [new Error("forbidden by authorization policy"), "authorization_error"],
      [
        Object.assign(new Error("provider failed"), {
          cause: { statusCode: 401 },
        }),
        "authorization_error",
      ],
      [new Error("request body must be a json object"), "invalid_request"],
      [
        Object.assign(new Error("provider failed"), {
          context: { errorCode: "bad_request" },
        }),
        "invalid_request",
      ],
      [
        Object.assign(new Error("Hosted bundle archive is invalid."), {
          name: "HostedBundleArchiveValidationError",
        }),
        "bundle_archive_validation_error",
      ],
      [
        Object.assign(new Error("runner failed"), {
          code: "bundle_archive_validation_error",
        }),
        "bundle_archive_validation_error",
      ],
      [Object.assign(new Error("aborted"), { name: "AbortError" }), "timeout"],
      [new TypeError("wrong type"), "type_error"],
      ["plain failure", "runtime_error"],
    ];

    for (const [error, expected] of cases) {
      expect(deriveHostedExecutionErrorCode(error)).toBe(expected);
    }
  });

  it("validates structured log phases, levels, and raw error-message normalization", () => {
    expect(isHostedExecutionLogPhase("wake.running")).toBe(true);
    expect(isHostedExecutionLogPhase("not-a-phase")).toBe(false);
    expect(isHostedExecutionLogLevel("warn")).toBe(true);
    expect(isHostedExecutionLogLevel("verbose")).toBe(false);

    expect(normalizeHostedExecutionErrorMessage(new Error("  boom  "))).toBe("boom");
    expect(
      normalizeHostedExecutionErrorMessage(Object.assign(new Error("   "), { name: "RangeError" })),
    ).toBe("RangeError");
    expect(normalizeHostedExecutionErrorMessage("  plain failure  ")).toBe("plain failure");
    expect(normalizeHostedExecutionErrorMessage("   ")).toBe("Unknown hosted execution error.");
  });

  it("normalizes operator messages with redaction, whitespace cleanup, defaults, and truncation", () => {
    expect(normalizeHostedExecutionOperatorMessage(" \n\t ")).toBe("Hosted execution event.");

    expect(
      normalizeHostedExecutionOperatorMessage(
        "Bearer placeholder hello user@example.com token=my-token "
        + "phone=+15551234567 spawn /app/test-parser-toolchain/ffmpeg ENOENT "
        + "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
      ),
    ).toBe(
      "Bearer [redacted] hello [redacted-email] token=[redacted] phone=[redacted-phone] spawn <REDACTED_PATH> ENOENT [redacted-token]",
    );
    expect(
      normalizeHostedExecutionOperatorMessage(
        "provider /v2/usercollection/daily_sleep failed writing /tmp/runtime.log "
        + "via file:///var/run/runtime.log and D:\\runtime\\attempt.log",
      ),
    ).toBe(
      "provider /v2/usercollection/daily_sleep failed writing <REDACTED_PATH> "
      + "via <REDACTED_PATH> and <REDACTED_PATH>",
    );
    expect(
      sanitizeHostedExecutionStructuredLogText(
        "browser failed at https://example.test/path?token=secret#frag "
        + "with href=\"https://example.test/private\" src='https://cdn.example.test/pixel?secret=x' "
        + "action=https://example.test/submit?token=secret",
      ),
    ).toBe(
      "browser failed at <REDACTED_URL> with href=<REDACTED_URL> "
      + "src=<REDACTED_URL> action=<REDACTED_URL>",
    );
    expect(
      normalizeHostedExecutionOperatorMessage(
        "failed hosted-user-runtime:member_123 for member_abc123 and user_def123",
      ),
    ).toBe(
      "failed hosted-user-runtime:<redacted-id> for member_<redacted-id> and user_<redacted-id>",
    );
    expect(
      sanitizeHostedExecutionStructuredLogText(
        "safe message for hosted-user-runtime:member_123 and member_abc123",
      ),
    ).toBe(
      "safe message for hosted-user-runtime:<redacted-id> and member_<redacted-id>",
    );

    const repeated = "x".repeat(260);
    const normalized = normalizeHostedExecutionOperatorMessage(repeated);
    expect(normalized).toHaveLength(260);

    const truncated = normalizeHostedExecutionOperatorMessage("x".repeat(460));
    expect(truncated).toHaveLength(400);
    expect(truncated.endsWith("…")).toBe(true);
  });

  it("redacts non-bearer authorization and other secret-bearing key-value pairs", () => {
    expect(
      normalizeHostedExecutionOperatorMessage(
        "authorization=\"Basic abc123\" cookie=session-123 set-cookie=\"sid=abc\" apiKey: key_123 passcode=7890",
      ),
    ).toBe(
      "authorization=[redacted] cookie=[redacted] set-cookie=[redacted] apiKey=[redacted] passcode=[redacted]",
    );
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

  it("falls back to generic summaries when an error contains unsafe configuration detail", () => {
    expect(
      summarizeHostedExecutionError(
        new Error("HOSTED_WEB_BASE_URL must be configured for alice@example.com."),
      ),
    ).toBe("Hosted execution configuration is invalid.");
    expect(
      summarizeHostedExecutionError(
        new Error("Runner returned HTTP 401 for authorization: Bearer secret-token"),
      ),
    ).toBe("Hosted runner container returned HTTP 401.");
  });

  it("builds structured logs with normalized messages, safe errors, and wake precedence", () => {
    const record = buildHostedExecutionStructuredLogRecord({
      component: "runner",
      wake: { eventId: "evt_wake" },
      error: Object.assign(new TypeError("wrong type"), { name: "TypeError" }),
      eventId: "evt_fallback",
      message: "  Bearer top-secret user@example.com  ",
      phase: "runtime.starting",
      time: "2026-04-08T00:01:00.000Z",
      userId: "user_123",
    });

    expect(record).toMatchObject({
      component: "runner",
      details: {
        errorDetail: "wrong type",
      },
      errorCode: "type_error",
      errorMessage: "Hosted execution runtime failed.",
      errorName: "TypeError",
      eventId: "evt_wake",
      level: "error",
      message:
        "Bearer [redacted] [redacted-email] Hosted execution runtime failed. Detail: wrong type",
      phase: "runtime.starting",
      schema: "murph.hosted-execution.log.v1",
      time: "2026-04-08T00:01:00.000Z",
      userId: null,
      userIdPresent: true,
    });
    expect(JSON.stringify(record)).not.toContain("user_123");
    expect(record.details?.stackPreview).toEqual(expect.any(Array));

    const unsafeErrorRecord = buildHostedExecutionStructuredLogRecord({
      component: "runner",
      error: Object.assign(new Error("plain failure"), { name: "TotallyCustomError" }),
      message: "started",
      phase: "wake.running",
    });

    expect(unsafeErrorRecord.errorName).toBeUndefined();
    expect(unsafeErrorRecord.level).toBe("error");
  });

  it("redacts user identifiers from structured log details", () => {
    const record = buildHostedExecutionStructuredLogRecord({
      component: "worker",
      details: {
        boundUserId: "user_123",
        userId: "user_123",
      },
      message: "route failed",
      phase: "failed",
      userId: "user_123",
    });

    expect(record).toMatchObject({
      details: {
        boundUserIdPresent: true,
        userIdPresent: true,
      },
      userId: null,
      userIdPresent: true,
    });
    expect(JSON.stringify(record)).not.toContain("user_123");
  });

  it("keeps structured configuration diagnostics redacted even when the error name is safe", () => {
    const record = buildHostedExecutionStructuredLogRecord({
      component: "container",
      error: Object.assign(
        new Error("HOSTED_WEB_BASE_URL must be configured for alice@example.com."),
        { name: "HostedExecutionConfigurationError" },
      ),
      message: "authorization=\"Basic abc123\" cookie=session-123 alice@example.com",
      phase: "failed",
    });

    expect(record).toMatchObject({
      component: "container",
      details: {
        errorDetail: "HOSTED_WEB_BASE_URL must be configured for [redacted-email].",
      },
      errorCode: "configuration_error",
      errorMessage: "Hosted execution configuration is invalid.",
      errorName: "HostedExecutionConfigurationError",
      level: "error",
      message:
        "authorization=[redacted] cookie=[redacted] [redacted-email] Hosted execution configuration is invalid. Detail: HOSTED_WEB_BASE_URL must be configured for [redacted-email].",
      phase: "failed",
    });
    expect(record.details?.stackPreview).toEqual(expect.any(Array));
  });

  it("automatically includes safe custom error properties in structured diagnostics", () => {
    const rawBundleRefKey = [
      "users",
      "bundles",
      "user-segment",
      "vault",
      "hash",
    ].join("/");
    const error = Object.assign(
      new Error("Hosted bundle archive is invalid."),
      {
        code: "bundle_archive_validation_error",
        details: {
          bundleArchiveOperation: "runner-input",
          bundleRefKey: rawBundleRefKey,
          bundleRefKeyPresent: true,
          bundleRefPresent: true,
        },
        name: "HostedBundleArchiveValidationError",
        operation: "runner-input",
        path: "/tmp/raw-bundle",
        payload: "raw payload fragment",
        refHash: "a".repeat(64),
        refKey: rawBundleRefKey,
        refKeyPresent: true,
        refSize: 123,
        token: "secret-token",
      },
    );

    const record = buildHostedExecutionStructuredLogRecord({
      component: "runner",
      error,
      message: "Hosted runtime checkpoint failed after invoking the runtime.",
      phase: "scheduled",
    });

    expect(record).toMatchObject({
      errorCode: "bundle_archive_validation_error",
      errorMessage: "Hosted bundle archive validation failed.",
      errorName: "HostedBundleArchiveValidationError",
      message:
        "Hosted runtime checkpoint failed after invoking the runtime. Hosted bundle archive validation failed. Detail: Hosted bundle archive is invalid. Code: bundle_archive_validation_error",
    });
    expect(record.details).toMatchObject({
      bundleArchiveOperation: "runner-input",
      bundleRefKeyPresent: true,
      bundleRefPresent: true,
      errorDetail: "Hosted bundle archive is invalid.",
      errorProperties: {
        operation: "runner-input",
        refHash: "a".repeat(64),
        refKeyPresent: true,
        refSize: 123,
      },
    });
    expect(JSON.stringify(record.details)).not.toContain(
      rawBundleRefKey,
    );
    expect(record.details?.errorProperties).not.toHaveProperty("path");
    expect(record.details?.errorProperties).not.toHaveProperty("payload");
    expect(record.details?.errorProperties).not.toHaveProperty("token");
  });

  it("keeps every error structured log diagnostic and privacy-bounded", () => {
    const isoOnlyMessage = "2026-04-25T02:26:17.046Z";
    const error = Object.assign(
      new Error("Hosted bundle archive is invalid."),
      {
        code: "bundle_archive_validation_error",
        details: {
          apiKey: "test-redaction-key",
          authorization: "Basic test-redaction-token",
          bundleArchiveOperation: "runner-output",
          operation: "runner-output",
          token: "secret-token",
        },
        name: "HostedBundleArchiveValidationError",
        operation: "runner-output",
        refHash: "c".repeat(64),
      },
    );

    const record = buildHostedExecutionStructuredLogRecord({
      component: "runner",
      error,
      level: "error",
      message: isoOnlyMessage,
      phase: "failed",
      time: "2026-04-25T02:26:18.000Z",
    });
    const fallbackRecord = buildHostedExecutionStructuredLogRecord({
      component: "runner",
      level: "error",
      message: isoOnlyMessage,
      phase: "failed",
      time: "2026-04-25T02:26:19.000Z",
    });

    for (const candidate of [record, fallbackRecord]) {
      expect(candidate).toMatchObject({
        component: "runner",
        errorCode: expect.any(String),
        errorMessage: expect.any(String),
        level: "error",
        phase: "failed",
        schema: "murph.hosted-execution.log.v1",
      });
      expect(candidate.message).not.toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u,
      );
    }

    expect(record).toMatchObject({
      errorCode: "bundle_archive_validation_error",
      errorMessage: "Hosted bundle archive validation failed.",
      errorName: "HostedBundleArchiveValidationError",
      message:
        "2026-04-25T02:26:17.046Z Hosted bundle archive validation failed. Detail: Hosted bundle archive is invalid. Code: bundle_archive_validation_error",
    });
    expect(record.details).toMatchObject({
      apiKey: "[redacted]",
      authorization: "[redacted]",
      bundleArchiveOperation: "runner-output",
      errorProperties: {
        operation: "runner-output",
        refHash: "c".repeat(64),
      },
      operation: "runner-output",
      token: "[redacted]",
    });
    expect(record.details?.errorProperties).not.toHaveProperty("apiKey");
    expect(record.details?.errorProperties).not.toHaveProperty("token");
    expect(fallbackRecord).toMatchObject({
      errorCode: "runtime_error",
      errorMessage: "Hosted execution runtime failed.",
      message: "Hosted execution runtime failed.",
    });
  });

  it("extracts a privacy-bounded assistant-notification detail subset from annotated errors", () => {
    const error = Object.assign(new Error("provider failed"), {
      cause: Object.assign(new Error("Gateway rejected provider credentials."), {
        code: "invalid_api_key",
        statusCode: 401,
      }),
      details: {
        assistantNotificationChannel: "linq",
        assistantNotificationDeliveryKind: "thread",
        assistantNotificationExplicitTargetPresent: false,
        assistantNotificationGatewayOnlyProviders: "openai",
        assistantNotificationIdentityIdPresent: true,
        assistantNotificationLinqBaseUrlOrigin: "https://linq.example.test",
        assistantNotificationLinqBaseUrlPath: "/v1",
        assistantNotificationProvider: "openai-compatible",
        assistantNotificationProviderBaseUrlOrigin: "https://gateway.example.test",
        assistantNotificationProviderBaseUrlPath: "/v1/responses",
        assistantNotificationProviderModel: "gpt-4.1-mini",
        assistantNotificationRouteId: "route_primary",
        assistantNotificationStage: "provider",
        assistantNotificationHostedExecutionPresent: true,
        assistantNotificationThreadIdPresent: true,
        assistantNotificationThreadIsDirect: true,
        assistantNotificationTurnTrigger: "automation-cron",
        assistantNotificationWorkingDirectoryPresent: false,
        assistantProviderAdapter: "openai-compatible",
        assistantProviderErrorBodyCode: "invalid_request",
        assistantProviderErrorBodyMessage: "Gateway only provider cannot serve this model.",
        assistantProviderErrorBodyPresent: true,
        assistantProviderErrorBodyType: "invalid_request_error",
        assistantProviderErrorStatus: 400,
        assistantProviderGatewayOnlyProviderCount: 1,
        assistantProviderGatewayOnlyProviders: "openai",
        assistantProviderGatewayTarget: true,
        assistantProviderModel: "openai/gpt-5.4",
        prompt: "do not keep me",
      },
    });

    expect(buildHostedExecutionPrefixedSafeErrorDiagnostics({
      error,
      prefix: "notification",
    })).toMatchObject({
      notificationErrorCode: "authorization_error",
      notificationErrorCodeDetail: "invalid_api_key",
      notificationErrorStatus: 401,
    });

    expect(extractHostedAssistantNotificationRedactedDetails(error)).toEqual({
      assistantNotificationChannel: "linq",
      assistantNotificationDeliveryKind: "thread",
      assistantNotificationErrorCause: "Gateway rejected provider credentials.",
      assistantNotificationErrorCode: "authorization_error",
      assistantNotificationErrorCodeDetail: "invalid_api_key",
      assistantNotificationErrorDetail: "provider failed",
      assistantNotificationErrorMessage: "Hosted execution authorization failed.",
      assistantNotificationErrorName: "Error",
      assistantNotificationErrorStatus: 401,
      assistantNotificationExplicitTargetPresent: false,
      assistantNotificationGatewayOnlyProviders: "openai",
      assistantNotificationIdentityIdPresent: true,
      assistantNotificationLinqBaseUrlConfigured: true,
      assistantNotificationProvider: "openai-compatible",
      assistantNotificationProviderBaseUrlConfigured: true,
      assistantNotificationProviderErrorCode: "invalid_api_key",
      assistantNotificationProviderModel: "gpt-4.1-mini",
      assistantNotificationRouteId: "route_primary",
      assistantNotificationStage: "provider",
      assistantNotificationHostedExecutionPresent: true,
      assistantNotificationThreadIdPresent: true,
      assistantNotificationThreadIsDirect: true,
      assistantNotificationTurnTrigger: "automation-cron",
      assistantNotificationWorkingDirectoryPresent: false,
      assistantProviderAdapter: "openai-compatible",
      assistantProviderErrorBodyCode: "invalid_request",
      assistantProviderErrorBodyMessage: "Gateway only provider cannot serve this model.",
      assistantProviderErrorBodyPresent: true,
      assistantProviderErrorBodyType: "invalid_request_error",
      assistantProviderErrorStatus: 400,
      assistantProviderGatewayOnlyProviderCount: 1,
      assistantProviderGatewayOnlyProviders: "openai",
      assistantProviderGatewayTarget: true,
      assistantProviderModel: "openai/gpt-5.4",
    });
  });

  it("keeps notification error diagnostics even when no annotation details exist", () => {
    expect(extractHostedAssistantNotificationRedactedDetails("plain provider failure")).toEqual({
      assistantNotificationErrorCode: "runtime_error",
      assistantNotificationErrorMessage: "Hosted execution runtime failed.",
    });
  });

  it("surfaces redacted Codex notification failure context without provider thread ids", () => {
    const error = Object.assign(
      new Error("Codex app-server failed. connection refused by local bridge."),
      {
        code: "ASSISTANT_CODEX_FAILED",
        context: {
          codexExitCode: 1,
          codexFailureDetailPresent: true,
          codexFailureStage: "process_exit",
          codexStderrPresent: true,
          connectionLost: false,
          codexThreadId: "codex-thread-fixture",
          providerActionCount: 2,
          providerSessionId: "provider-session-fixture",
          retryable: false,
        },
      },
    );

    const details = extractHostedAssistantNotificationRedactedDetails(error);

    expect(details).toEqual(expect.objectContaining({
      assistantNotificationCodexConnectionLost: false,
      assistantNotificationCodexExitCode: 1,
      assistantNotificationCodexFailureDetailPresent: true,
      assistantNotificationCodexFailureStage: "process_exit",
      assistantNotificationCodexRetryable: false,
      assistantNotificationCodexStderrPresent: true,
      assistantNotificationErrorCode: "runtime_error",
      assistantNotificationErrorCodeDetail: "ASSISTANT_CODEX_FAILED",
      assistantNotificationProviderActionCount: 2,
      assistantNotificationProviderErrorCode: "ASSISTANT_CODEX_FAILED",
      assistantNotificationProviderSessionIdPresent: true,
    }));
    expect(JSON.stringify(details)).not.toContain("provider-session-fixture");
    expect(JSON.stringify(details)).not.toContain("codex-thread-fixture");

    const record = buildHostedExecutionStructuredLogRecord({
      component: "runtime",
      error,
      message: "notification failed",
      phase: "wake.running",
    });
    expect(record.details).toEqual(expect.objectContaining({
      codexThreadIdPresent: true,
      providerSessionIdPresent: true,
    }));
    expect(JSON.stringify(record)).not.toContain("provider-session-fixture");
    expect(JSON.stringify(record)).not.toContain("codex-thread-fixture");
  });

  it("redacts Telegram identifiers from safe error details when the error code is Telegram-specific", () => {
    const error = Object.assign(new Error("Telegram cleanup failed"), {
      code: "ASSISTANT_TELEGRAM_DELETE_FAILED",
      context: {
        businessConnectionId: "biz-123",
        messageIdCount: 2,
        migrateToChatId: "456",
        target: "123:business:biz-123:topic:456",
      },
    });

    expect(buildHostedExecutionSafeErrorDetails(error)).toMatchObject({
      errorCodeDetail: "ASSISTANT_TELEGRAM_DELETE_FAILED",
      businessConnectionId: "[redacted-telegram-business-connection-id]",
      messageIdCount: 2,
      migrateToChatId: "[redacted-telegram-chat-id]",
      target: "[redacted-telegram-target:chat+business+topic]",
    });
  });

  it("formats operator-facing log messages with redacted detail appended only once", () => {
    expect(
      formatHostedExecutionLogMessage(
        "Hosted worker route failed.",
        new Error("Runner returned HTTP 502 from upstream"),
      ),
    ).toBe(
      "Hosted worker route failed. Hosted runner container returned HTTP 502. Detail: Runner returned HTTP 502 from upstream",
    );

    expect(
      formatHostedExecutionLogMessage(
        "Hosted worker route failed. Hosted runner container returned HTTP 502.",
        new Error("Runner returned HTTP 502 from upstream"),
      ),
    ).toBe(
      "Hosted worker route failed. Hosted runner container returned HTTP 502. Detail: Runner returned HTTP 502 from upstream",
    );
  });

  it("redacts linux home paths from diagnostic details and stack previews", () => {
    const error = new Error("failed from /home/operator/app/runtime.ts");
    error.stack = [
      "Error: failed from /home/operator/app/runtime.ts",
      "    at runThing (/home/operator/app/runtime.ts:12:5)",
      "    at main (/root/project/index.ts:4:1)",
    ].join("\n");

    const record = buildHostedExecutionStructuredLogRecord({
      component: "runtime",
      error,
      message: "failed",
      phase: "failed",
    });

    expect(record.details).toMatchObject({
      errorDetail: "failed from <REDACTED_PATH>",
      stackPreview: [
        "at runThing (<REDACTED_PATH>)",
        "at main (<REDACTED_PATH>)",
      ],
    });
  });

  it("emits structured logs by default and only suppresses them via explicit env override", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    process.env.VITEST = "true";
    emitHostedExecutionStructuredLog({
      component: "runner",
      level: "info",
      message: "default info",
      phase: "wake.running",
    });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(infoSpy.mock.calls[0]?.[0] as string)).toMatchObject({
      level: "info",
      message: "default info",
      phase: "wake.running",
    });

    process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = "on";
    emitHostedExecutionStructuredLog({
      component: "runner",
      level: "warn",
      message: "warn",
      phase: "scheduled",
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
      phase: "scheduled",
    });

    process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = "off";
    emitHostedExecutionStructuredLog({
      component: "runner",
      level: "info",
      message: "quiet again",
      phase: "outbox",
    });
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });

  it("sanitizes nested structured log details and safe error metadata", () => {
    const nested = Array.from({ length: 40 }, (_, index) => `value-${index}`);
    const sanitized = sanitizeHostedExecutionStructuredLogDetails({
      "ok-key": {
        nested,
        infinite: Number.POSITIVE_INFINITY,
        deep: {
          one: {
            two: {
              three: {
                four: {
                  dropped: "too deep",
                },
              },
            },
          },
        },
      },
      "bad key!": "dropped",
    });

    expect(sanitized).toEqual({
      "ok-key": {
        nested: nested.slice(0, 32),
      },
    });
    expect(sanitizeHostedExecutionStructuredLogDetails(["not-an-object"] as never)).toBeNull();

    const error = Object.assign(new Error("Top level detail"), {
      cause: "authorization: Bearer abc123",
      code: "E_RUNTIME_SECRET",
      context: {
        operation: "send_message",
        provider: "linq",
        retryable: true,
      },
      details: {
        token: "secret-token",
        nested: {
          email: "operator@example.com",
        },
      },
      status: 502,
    });
    error.stack = [
      "Error: Top level detail",
      "    at first (/home/example/project/index.ts:10:5)",
      "    at second (/home/example/app/runtime.ts:4:1)",
    ].join("\n");

    expect(buildHostedExecutionSafeErrorDetails(error)).toEqual({
      errorCause: "authorization=Bearer [redacted]",
      errorCodeDetail: "E_RUNTIME_SECRET",
      errorDetail: "Top level detail",
      errorStatus: 502,
      nested: {
        email: "[redacted-email]",
      },
      operation: "send_message",
      provider: "linq",
      retryable: true,
      stackPreview: [
        "at first (<REDACTED_PATH>)",
        "at second (<REDACTED_PATH>)",
      ],
      token: "[redacted]",
    });
    expect(
      sanitizeHostedExecutionStructuredLogDetails({
        chat_id: "123",
        direct_messages_topic_id: 9,
        provider: "telegram",
        target: "123:business:biz-123:dm-topic:9",
      }),
    ).toEqual({
      chat_id: "[redacted-telegram-chat-id]",
      direct_messages_topic_id: "[redacted-telegram-topic-id]",
      provider: "telegram",
      target: "[redacted-telegram-target:chat+business+dm-topic]",
    });
    expect(buildHostedExecutionSafeErrorDetails("not-an-error")).toBeNull();
    expect(readHostedExecutionSafeErrorName(Object.assign(new Error("x"), { name: "Error" }))).toBe("Error");
    expect(
      readHostedExecutionSafeErrorName(Object.assign(new Error("x"), { name: "CustomSecretError" })),
    ).toBeNull();
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
      effectId: "intent_123",
      payload: createHostedAssistantDeliveryPayload(),
    })).toEqual({
      deliveryPhase: "background_retry",
      effectId: "intent_123",
      fingerprint: "dedupe_123",
      kind: "assistant.delivery",
      payload: createHostedAssistantDeliveryPayload(),
    });

    expect(buildHostedAssistantDeliverySendingRecord({
      attempt: {
        channel: null,
        idempotencyKey: null,
        messageLength: null,
        providerMessageId: null,
        providerThreadId: null,
        startedAt: "2026-04-08T00:00:00.000Z",
        target: null,
        targetKind: null,
      },
      dedupeKey: "dedupe_123",
      effectId: "intent_123",
    })).toEqual({
      attempt: {
        channel: null,
        idempotencyKey: null,
        messageLength: null,
        providerMessageId: null,
        providerThreadId: null,
        startedAt: "2026-04-08T00:00:00.000Z",
        target: null,
        targetKind: null,
      },
      effectId: "intent_123",
      fingerprint: "dedupe_123",
      kind: "assistant.delivery",
      recordedAt: "2026-04-08T00:00:00.000Z",
      state: "sending",
    });

    expect(buildHostedAssistantDeliverySentRecord({
      dedupeKey: "dedupe_123",
      delivery,
      effectId: "intent_123",
    })).toEqual({
      delivery,
      effectId: "intent_123",
      fingerprint: "dedupe_123",
      kind: "assistant.delivery",
      recordedAt: "2026-04-08T00:00:00.000Z",
      state: "sent",
    });

    expect(parseHostedAssistantDeliverySideEffect({
      effectId: "intent_123",
      fingerprint: "fingerprint_123",
      kind: "assistant.delivery",
      payload: createHostedAssistantDeliveryPayload(),
    })).toEqual({
      deliveryPhase: "background_retry",
      effectId: "intent_123",
      fingerprint: "fingerprint_123",
      kind: "assistant.delivery",
      payload: createHostedAssistantDeliveryPayload(),
    });

    expect(parseHostedAssistantDeliveryRecord({
      delivery,
      effectId: "intent_123",
      fingerprint: "fingerprint_123",
      kind: "assistant.delivery",
      recordedAt: "2026-04-08T00:00:00.000Z",
      state: "sent",
    })).toEqual({
      delivery,
      effectId: "intent_123",
      fingerprint: "fingerprint_123",
      kind: "assistant.delivery",
      recordedAt: "2026-04-08T00:00:00.000Z",
      state: "sent",
    });

    expect(parseHostedAssistantDeliverySideEffects("not-an-array")).toEqual([]);
  });

  it("compares side-effect identities and delivery payloads structurally", () => {
    expect(sameHostedAssistantDeliverySideEffectIdentity(
      {
        effectId: "effect_123",
        fingerprint: "fingerprint_123",
        kind: "assistant.delivery",
      },
      {
        effectId: "effect_123",
        fingerprint: "fingerprint_123",
        kind: "assistant.delivery",
      },
    )).toBe(true);
    expect(sameHostedAssistantDeliverySideEffectIdentity(
      {
        effectId: "effect_123",
        fingerprint: "fingerprint_123",
        kind: "assistant.delivery",
      },
      {
        effectId: "effect_123",
        fingerprint: "other",
        kind: "assistant.delivery",
      },
    )).toBe(false);

    expect(sameHostedAssistantDeliveryReceipt(delivery, { ...delivery })).toBe(true);
    expect(sameHostedAssistantDeliveryReceipt(delivery, {
      ...delivery,
      providerThreadId: "thread_123",
    })).toBe(false);

    expect(sameHostedAssistantDeliverySideEffectIdentity(
      {
        effectId: "effect_123",
        fingerprint: "fingerprint_123",
        kind: "assistant.delivery",
      },
      {
        effectId: "effect_123",
        fingerprint: "fingerprint_123",
        kind: "assistant.delivery",
      },
    )).toBe(true);
  });

  it("fails closed on invalid side-effect shapes", () => {
    expect(() => parseHostedAssistantDeliverySideEffect(null)).toThrow(
      /Hosted assistant delivery side effect must be an object/i,
    );
    expect(() => parseHostedAssistantDeliverySideEffect({
      effectId: "effect_123",
      fingerprint: "fingerprint_123",
      kind: "other",
    })).toThrow(/Unsupported hosted assistant delivery kind: other/i);

    expect(() => parseHostedAssistantDeliveryRecord({
      effectId: "intent_123",
      fingerprint: "fingerprint_123",
      kind: "assistant.delivery",
      recordedAt: "2026-04-08T00:00:00.000Z",
      state: "unknown",
    })).toThrow(/Unsupported hosted assistant delivery record state: unknown/i);

    expect(() => buildHostedAssistantDeliverySendingRecord({
      attempt: {
        channel: null,
        idempotencyKey: null,
        messageLength: null,
        providerMessageId: null,
        providerThreadId: null,
        startedAt: "",
        target: null,
        targetKind: null,
      },
      dedupeKey: "dedupe_123",
      effectId: "intent_123",
    })).toThrow(/startedAt must be a non-empty string/i);

    expect(() => buildHostedAssistantDeliverySentRecord({
      dedupeKey: "dedupe_123",
      delivery: {
        ...delivery,
        messageLength: -1,
      },
      effectId: "intent_123",
    })).toThrow(/messageLength must be a non-negative integer/i);

    expect(() => parseHostedAssistantDeliveryRecord({
      delivery: {
        ...delivery,
        targetKind: "group",
      },
      effectId: "intent_123",
      fingerprint: "fingerprint_123",
      kind: "assistant.delivery",
      recordedAt: "2026-04-08T00:00:00.000Z",
      state: "sent",
    })).toThrow(/Unsupported hosted assistant delivery target kind: group/i);
    expect(() => parseHostedAssistantDeliveryRecord({
      effectId: "effect_123",
      fingerprint: "fingerprint_123",
      kind: "other",
      recordedAt: "2026-04-08T00:00:00.000Z",
      state: "sending",
      attempt: {
        channel: null,
        idempotencyKey: null,
        messageLength: null,
        providerMessageId: null,
        providerThreadId: null,
        startedAt: "2026-04-08T00:00:00.000Z",
        target: null,
        targetKind: null,
      },
    })).toThrow(/Unsupported hosted assistant delivery kind: other/i);
  });

  it("exposes assistant-delivery-specific aliases and guards", () => {
    const sendingRecord = buildHostedAssistantDeliverySendingRecord({
      attempt: {
        channel: null,
        idempotencyKey: null,
        messageLength: null,
        providerMessageId: null,
        providerThreadId: null,
        startedAt: "2026-04-08T00:00:00.000Z",
        target: null,
        targetKind: null,
      },
      dedupeKey: "dedupe_123",
      effectId: "intent_123",
    });

    expect(parseHostedAssistantDeliverySideEffect({
      effectId: "intent_123",
      fingerprint: "dedupe_123",
      kind: "assistant.delivery",
      payload: createHostedAssistantDeliveryPayload(),
    })).toEqual(buildHostedAssistantDeliverySideEffect({
      dedupeKey: "dedupe_123",
      effectId: "intent_123",
      payload: createHostedAssistantDeliveryPayload(),
    }));
    expect(parseHostedAssistantDeliverySideEffects([{
      effectId: "intent_123",
      fingerprint: "dedupe_123",
      kind: "assistant.delivery",
      payload: createHostedAssistantDeliveryPayload(),
    }])).toEqual([{
      deliveryPhase: "background_retry",
      effectId: "intent_123",
      fingerprint: "dedupe_123",
      kind: "assistant.delivery",
      payload: createHostedAssistantDeliveryPayload(),
    }]);
    expect(parseHostedAssistantDeliveryRecord(sendingRecord)).toEqual(sendingRecord);
    expect(isHostedAssistantDeliveryKind(HOSTED_ASSISTANT_DELIVERY_KIND)).toBe(true);
    expect(isHostedAssistantDeliveryKind("other")).toBe(false);
  });
});
