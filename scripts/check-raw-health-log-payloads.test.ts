import { describe, expect, it } from "vitest";

import { findRawHealthLogPayloadMatches } from "./check-raw-health-log-payloads.ts";

function blockedVariables(source: string): string[] {
  return findRawHealthLogPayloadMatches("packages/example/src/example.ts", source).map(
    (match) => match.variableName,
  );
}

describe("check-raw-health-log-payloads", () => {
  it("blocks direct raw payload variables in console and logger calls", () => {
    expect(
      blockedVariables(`
        console.log(prompt);
        console.warn({ messages });
        logger.error("failed", { body });
        log(\`transcript: \${transcript}\`);
      `),
    ).toEqual(["prompt", "messages", "body", "transcript"]);
  });

  it("blocks nested raw request payload expressions", () => {
    expect(
      blockedVariables(`
        console.info("request", JSON.stringify({ finalRequest }));
        console.error("response", response.body);
        logger.debug({ labReport: labReport });
      `),
    ).toEqual(["finalRequest", "response", "labReport"]);
  });

  it("allows explicit redaction, sanitization, and summarization helpers", () => {
    expect(
      blockedVariables(`
        console.log(redactAssistantStateString(prompt));
        console.warn({ messages: summarizeMessages(messages) });
        logger.error("failed", sanitizeHostedOnboardingLogString(body));
        log(maskLabReportForDiagnostics(labReport));
      `),
    ).toEqual([]);
  });

  it("allows metadata-only counts and statuses", () => {
    expect(
      blockedVariables(`
        console.info({
          bodyBytes: body.length,
          messageCount: messages.length,
          outputSize: output.byteLength,
          responseOk: response.ok,
          responseStatus: response.status,
        });
      `),
    ).toEqual([]);
  });

  it("blocks input wrapper properties that can carry raw payloads", () => {
    expect(
      blockedVariables(`
        console.error(input.payload);
        console.error(input.rawText);
        console.error(input.message);
        console.error(input["payload"]);
      `),
    ).toEqual(["input", "input", "input", "input"]);
  });

  it("blocks name fields on sensitive payload roots", () => {
    expect(
      blockedVariables(`
        console.warn(body.name);
        console.warn(labReport.name);
        console.warn(vault.name);
      `),
    ).toEqual(["body", "labReport", "vault"]);
  });

  it("does not treat ordinary input wrapper metadata as raw health data", () => {
    expect(
      blockedVariables(`
        function logTiming(input: { startedAtMs: number; stage: string }) {
          console.info("timing", { elapsedMs: Date.now() - input.startedAtMs, stage: input.stage });
        }
      `),
    ).toEqual([]);
  });

  it("allows narrow input wrapper metadata paths used by structured logs", () => {
    expect(
      blockedVariables(`
        console.warn({
          accountId: input.account.id,
          provider: input.account.provider,
          reason: input.reason,
          eventIdSuffix: input.eventId.slice(-6),
          eventType: sanitizeHostedOnboardingLogString(input.eventType),
          errorName: deriveHostedOnboardingTimingErrorName(input.error),
          errorDetails: describeHostedStripeEventReconciliationErrorForLog(input.error),
          batchCount: input.batch.length,
          context: input.context,
          operation: input.operation,
        });
      `),
    ).toEqual([]);
  });

  it("still blocks raw input and input body payloads", () => {
    expect(
      blockedVariables(`
        console.log(input);
        console.error(input.body);
      `),
    ).toEqual(["input", "input"]);
  });

  it("does not treat arbitrary dot-log methods as log sinks", () => {
    expect(
      blockedVariables(`
        const result = Math.log(input);
        metrics.log(input);
      `),
    ).toEqual([]);
  });

  it("preserves actionable source locations and callee names", () => {
    expect(
      findRawHealthLogPayloadMatches(
        "packages\\example\\src\\example.ts",
        [
          "const ignored = true;",
          "auditLogger.error({",
          "  payload: response.body,",
          "});",
        ].join("\n"),
      ),
    ).toEqual([
      {
        callee: "auditLogger.error",
        column: 12,
        filePath: "packages/example/src/example.ts",
        line: 3,
        variableName: "response",
      },
    ]);
  });
});
