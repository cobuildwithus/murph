import assert from "node:assert/strict";

import { describe, expect, it } from "vitest";

import {
  HostedAssistantConfigurationError,
} from "@murphai/operator-config/hosted-assistant-config";

import {
  createHostedRuntimeChildError,
  formatHostedRuntimeChildResult,
  parseHostedRuntimeChildResult,
} from "../src/hosted-runtime/child-result.ts";

describe("hosted runtime child-result helpers", () => {
  it("classifies required hosted assistant configuration errors", () => {
    const error = createHostedRuntimeChildError(
      {
        code: "HOSTED_ASSISTANT_CONFIG_REQUIRED",
        details: {
          assistantNotificationStage: "provider",
        },
        message: "Hosted assistant config is required.",
        name: "HostedAssistantConfigurationError",
        stack: "child-stack",
      },
      17,
    );

    assert.ok(error instanceof HostedAssistantConfigurationError);
    assert.equal(error.name, "HostedAssistantConfigurationError");
    assert.equal(error.message, "Hosted assistant config is required.");
    assert.equal(error.stack, "child-stack");
    assert.equal(error.code, "HOSTED_ASSISTANT_CONFIG_REQUIRED");
    assert.deepEqual(
      (error as HostedAssistantConfigurationError & { details?: Record<string, unknown> | null }).details,
      {
        assistantNotificationStage: "provider",
      },
    );
  });

  it("defaults unknown hosted assistant configuration errors to invalid", () => {
    const error = createHostedRuntimeChildError(
      {
        code: "UNKNOWN_CODE",
        message: "Hosted assistant config is invalid.",
        name: "HostedAssistantConfigurationError",
      },
      3,
    );

    assert.ok(error instanceof HostedAssistantConfigurationError);
    assert.equal(error.code, "HOSTED_ASSISTANT_CONFIG_INVALID");
  });

  it("preserves generic child error metadata and fallback exit messages", () => {
    const namedError = createHostedRuntimeChildError(
      {
        message: "child aborted",
        name: "AbortError",
        stack: "abort-stack",
      },
      9,
    );

    assert.equal(namedError.name, "AbortError");
    assert.equal(namedError.message, "child aborted");
    assert.equal(namedError.stack, "abort-stack");

    const fallbackError = createHostedRuntimeChildError(undefined, null);
    assert.equal(
      fallbackError.message,
      "Hosted assistant runtime child exited with code unknown.",
    );
  });

  it("parses the final emitted payload line after trimming stdout noise", () => {
    const payload = {
      ok: true,
      result: {
        nextWakeAt: null,
        redactedStatus: { imported: 1 },
        status: "idle" as const,
      },
    };

    const output = [
      "child stdout",
      "",
      `  ${formatHostedRuntimeChildResult({ ok: false, error: { message: "stale" } })}`,
      ` ${formatHostedRuntimeChildResult(payload)} `,
      "",
    ].join("\n");

    assert.deepEqual(parseHostedRuntimeChildResult(output), payload);
  });

  it("preserves optional redacted child error details", () => {
    const output = formatHostedRuntimeChildResult({
      error: {
        details: {
          assistantNotificationProvider: "codex-cli",
        },
        message: "child aborted",
        name: "Error",
      },
      ok: false,
    });

    expect(parseHostedRuntimeChildResult(output)).toEqual({
      error: {
        details: {
          assistantNotificationProvider: "codex-cli",
        },
        message: "child aborted",
        name: "Error",
      },
      ok: false,
    });
  });

  it("fails closed when the child never emits a payload line", () => {
    expect(() => parseHostedRuntimeChildResult("child stdout only")).toThrow(
      /did not emit a result payload/u,
    );
  });
});
