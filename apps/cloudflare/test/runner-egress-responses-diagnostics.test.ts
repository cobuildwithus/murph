import { describe, expect, it } from "vitest";
import { parseHostedRuntimeLogRequest } from "@murphai/hosted-execution/parsers";
import { buildHostedOpenAiCacheDiagnostic } from "../src/runner-egress-responses-diagnostics.ts";

const TEST_TEXT_ENCODER = new TextEncoder();

function testByteLength(value: string): number {
  return TEST_TEXT_ENCODER.encode(value).byteLength;
}

function testJsonByteLength(value: unknown): number {
  return testByteLength(JSON.stringify(value));
}

function parseDiagnosticRuntimeLog(redactedJson: Record<string, unknown>): void {
  parseHostedRuntimeLogRequest({
    entries: [{
      at: "2026-05-19T00:00:00.000Z",
      component: "runner",
      eventCode: "runner.provider_egress_diagnostic",
      level: "debug",
      phase: "fetch",
      redactedJson,
    }],
  });
}

function readDiagnosticInputMetric(
  diagnostic: Record<string, unknown>,
  kind: string,
): { bytes: number; count: number } | null {
  const kinds = diagnostic.inputNestedMetricKinds;
  const counts = diagnostic.inputNestedMetricCounts;
  const bytes = diagnostic.inputNestedMetricBytes;
  if (!Array.isArray(kinds) || !Array.isArray(counts) || !Array.isArray(bytes)) {
    throw new TypeError("Expected aligned input diagnostic metric arrays.");
  }
  const index = kinds.indexOf(kind);
  if (index < 0) {
    return null;
  }
  const count = counts[index];
  const byteCount = bytes[index];
  if (typeof count !== "number" || typeof byteCount !== "number") {
    throw new TypeError("Expected numeric input diagnostic metrics.");
  }
  return { bytes: byteCount, count };
}

describe("Responses request diagnostic projection", () => {
  it("groups repeated Codex memory requests with stable keyed fingerprints", async () => {
    const sharedSessionId = "session-shared-memory-correlation-id";
    const sharedThreadId = "thread-shared-memory-correlation-id";
    const firstTurnId = "turn-first-memory-correlation-id";
    const secondTurnId = "turn-second-memory-correlation-id";
    const otherThreadId = "thread-other-memory-correlation-id";
    const requestBytes = TEST_TEXT_ENCODER.encode(JSON.stringify({
      input: [],
      model: "gpt-5.6-terra",
    }));
    const buildDiagnostic = (input: {
      threadId: string;
      turnId: string;
    }) => buildHostedOpenAiCacheDiagnostic({
      endpointKind: "responses",
      fingerprintSecret: "diagnostic-fingerprint-secret",
      method: "POST",
      requestBytes,
      turnMetadataHeader: JSON.stringify({
        request_kind: "memory",
        session_id: sharedSessionId,
        thread_id: input.threadId,
        turn_id: input.turnId,
        window_id: `${input.threadId}:1`,
      }),
    });

    const first = await buildDiagnostic({
      threadId: sharedThreadId,
      turnId: firstTurnId,
    });
    const second = await buildDiagnostic({
      threadId: sharedThreadId,
      turnId: secondTurnId,
    });
    const other = await buildDiagnostic({
      threadId: otherThreadId,
      turnId: secondTurnId,
    });

    expect(first.codexRequestKind).toBe("memory");
    expect(first.codexSessionFingerprint).toBe(second.codexSessionFingerprint);
    expect(first.codexThreadFingerprint).toBe(second.codexThreadFingerprint);
    expect(first.codexThreadFingerprint).not.toBe(other.codexThreadFingerprint);
    expect(first.codexTurnFingerprint).not.toBe(second.codexTurnFingerprint);
    for (const diagnostic of [first, second, other]) {
      parseDiagnosticRuntimeLog(diagnostic);
    }
    const serialized = JSON.stringify([first, second, other]);
    expect(serialized).not.toContain(sharedSessionId);
    expect(serialized).not.toContain(sharedThreadId);
    expect(serialized).not.toContain(firstTurnId);
    expect(serialized).not.toContain(secondTurnId);
    expect(serialized).not.toContain(otherThreadId);
  });

  it("summarizes OpenAI input shape with bounded metadata", async () => {
    const largestText = "hello 💚 ".repeat(10);
    const input = [
      {
        content: [{ text: largestText, type: "input_text" }],
        role: "user",
        type: "message",
      },
      {
        output: "tool result",
        role: "assistant",
        type: "function_call",
      },
      {
        content: "hidden",
        role: "banana",
        type: "unexpected_call",
      },
      {
        role: "",
        type: "  ",
      },
      "plain input",
    ] as const;
    const diagnostic = await buildHostedOpenAiCacheDiagnostic({
      endpointKind: "responses",
      method: "POST",
      requestBytes: TEST_TEXT_ENCODER.encode(JSON.stringify({
        input,
        model: "gpt-5.6-terra",
      })),
    });

    expect(diagnostic).toEqual(expect.objectContaining({
      inputCount: 5,
      inputItemRoleCounts: [1, 2, 1, 1],
      inputItemRoleKinds: ["assistant", "missing", "other", "user"],
      inputItemTypeCounts: [1, 1, 2, 1],
      inputItemTypeBytes: [
        testJsonByteLength(input[1]),
        testJsonByteLength(input[0]),
        testJsonByteLength(input[3]) + testJsonByteLength(input[4]),
        testJsonByteLength(input[2]),
      ],
      inputItemTypeKinds: ["function_call", "message", "missing", "other"],
      inputFunctionCallBytes: [testJsonByteLength(input[1])],
      inputFunctionCallNameCounts: [1],
      inputFunctionCallNameKinds: ["unknown"],
      inputLargestItemBytes: testJsonByteLength(input[0]),
      inputLargestItemIndex: 0,
      inputLargestItemKinds: ["type:message", "role:user"],
      inputLargestItemReverseIndex: 4,
      inputNestedMetricCounts: [2, 1, 13],
      inputNestedMetricKinds: ["content", "output", "string"],
      inputNestedMetricBytes: [
        testJsonByteLength(input[0].content) + testJsonByteLength(input[2].content),
        testJsonByteLength(input[1].output),
        [
          "message",
          "user",
          "input_text",
          largestText,
          "function_call",
          "assistant",
          "tool result",
          "unexpected_call",
          "banana",
          "hidden",
          "  ",
          "",
          "plain input",
        ].reduce((total, value) => total + testByteLength(value), 0),
      ],
      inputTailItemBytes: input.map((item) => testJsonByteLength(item)),
      inputTailItemContentBytes: [
        testJsonByteLength(input[0].content),
        0,
        testJsonByteLength(input[2].content),
        0,
        0,
      ],
      inputTailItemCount: 5,
      inputTailItemFingerprintPresent: false,
      inputTailItemFunctionNameKinds: ["none", "unknown", "none", "none", "none"],
      inputTailItemIndexes: [0, 1, 2, 3, 4],
      inputTailItemOutputBytes: [
        0,
        testJsonByteLength(input[1].output),
        0,
        0,
        0,
      ],
      inputTailItemReverseIndexes: [4, 3, 2, 1, 0],
      inputTailItemRoleKinds: ["user", "assistant", "other", "missing", "missing"],
      inputTailItemStringBytes: [
        [
          "message",
          "user",
          "input_text",
          largestText,
        ].reduce((total, value) => total + testByteLength(value), 0),
        [
          "function_call",
          "assistant",
          "tool result",
        ].reduce((total, value) => total + testByteLength(value), 0),
        [
          "unexpected_call",
          "banana",
          "hidden",
        ].reduce((total, value) => total + testByteLength(value), 0),
        [
          "  ",
          "",
        ].reduce((total, value) => total + testByteLength(value), 0),
        testByteLength("plain input"),
      ],
      inputTailItemTypeKinds: ["message", "function_call", "other", "missing", "missing"],
    }));
  });

  it("attributes OpenAI function-call-output bytes without raw output or call IDs", async () => {
    const matchedOutput = {
      call_id: "call_private_1",
      output: "synthetic-sensitive-tool-output ".repeat(20),
      type: "function_call_output",
    };
    const unsafeNameOutput = {
      call_id: "call_private_2",
      output: {
        rows: ["small synthetic row"],
      },
      type: "function_call_output",
    };
    const exactNameOutput = {
      call_id: "call_private_3",
      output: "exact-name synthetic output",
      type: "function_call_output",
    };
    const unmatchedOutput = {
      call_id: "call_private_4",
      output: "orphan synthetic output",
      type: "function_call_output",
    };
    const input = [
      {
        arguments: "synthetic-sensitive-function-arguments",
        call_id: "call_private_1",
        name: "local_shell",
        type: "function_call",
      },
      matchedOutput,
      {
        arguments: "synthetic-unsafe-function-arguments",
        call_id: "call_private_2",
        name: "private/tool-name",
        type: "function_call",
      },
      unsafeNameOutput,
      {
        arguments: "synthetic-exact-function-arguments",
        call_id: "call_private_3",
        name: "mcp__database_inspection_query",
        type: "function_call",
      },
      exactNameOutput,
      unmatchedOutput,
      {
        content: "synthetic-private-message",
        role: "user",
        type: "message",
      },
    ] as const;

    const diagnostic = await buildHostedOpenAiCacheDiagnostic({
      endpointKind: "responses",
      method: "POST",
      requestBytes: TEST_TEXT_ENCODER.encode(JSON.stringify({
        input,
        model: "gpt-5.6-terra",
      })),
    });

    expect(diagnostic).toEqual(expect.objectContaining({
      inputFunctionCallBytes: [
        testJsonByteLength(input[0]),
        testJsonByteLength(input[4]),
        testJsonByteLength(input[2]),
      ],
      inputFunctionCallNameCounts: [1, 1, 1],
      inputFunctionCallNameKinds: ["local_shell", "mcp__database_inspection_query", "other"],
      inputFunctionOutputBytes: [
        testJsonByteLength(matchedOutput.output),
        testJsonByteLength(exactNameOutput.output),
        testJsonByteLength(unsafeNameOutput.output),
        testJsonByteLength(unmatchedOutput.output),
      ],
      inputFunctionOutputNameCounts: [1, 1, 1, 1],
      inputFunctionOutputNameKinds: ["local_shell", "mcp__database_inspection_query", "other", "unknown"],
      inputLargestFunctionOutputBytes: testJsonByteLength(matchedOutput.output),
      inputLargestFunctionOutputIndex: 1,
      inputLargestFunctionOutputNameKind: "local_shell",
      inputLargestFunctionOutputReverseIndex: 6,
      inputTailItemFunctionNameKinds: [
        "local_shell",
        "local_shell",
        "other",
        "other",
        "mcp__database_inspection_query",
        "mcp__database_inspection_query",
        "unknown",
        "none",
      ],
    }));
    expect(readDiagnosticInputMetric(
      diagnostic,
      "function_output.action.command.execution",
    )).toEqual({ bytes: testJsonByteLength(matchedOutput.output), count: 1 });
    expect(readDiagnosticInputMetric(
      diagnostic,
      "function_output.action.dynamic.tool.call",
    )).toBeNull();
    expect(readDiagnosticInputMetric(
      diagnostic,
      "function_output.action.mcp.tool.call",
    )).toEqual({ bytes: testJsonByteLength(exactNameOutput.output), count: 1 });
    expect(readDiagnosticInputMetric(
      diagnostic,
      "function_output.action.other",
    )).toEqual({
      bytes: testJsonByteLength(unsafeNameOutput.output)
        + testJsonByteLength(unmatchedOutput.output),
      count: 2,
    });
    parseDiagnosticRuntimeLog(diagnostic);

    const diagnosticJson = JSON.stringify(diagnostic);
    expect(readDiagnosticInputMetric(diagnostic, "function_output.repeated")).toBeNull();
    expect(readDiagnosticInputMetric(diagnostic, "function_output.equivalent")).toBeNull();
    expect(diagnosticJson).not.toContain("call_private");
    expect(diagnosticJson).not.toContain("synthetic-sensitive-tool-output");
    expect(diagnosticJson).not.toContain("synthetic-sensitive-function-arguments");
    expect(diagnosticJson).not.toContain("synthetic-unsafe-function-arguments");
    expect(diagnosticJson).not.toContain("synthetic-exact-function-arguments");
    expect(diagnosticJson).not.toContain("synthetic-private-message");
    expect(diagnosticJson).not.toContain("private/tool-name");
  });

  it("counts repeated action identities and exactly equivalent serialized outputs independently", async () => {
    const repeatedFirst = {
      call_id: "call_repeat",
      output: "first repeated-call output",
      type: "function_call_output",
    };
    const repeatedSecond = {
      call_id: "call_repeat",
      output: "second repeated-call output",
      type: "function_call_output",
    };
    const equivalentOutput = {
      status: "waiting",
      waitMs: 1_000,
    };
    const equivalentFirst = {
      call_id: "call_equivalent_1",
      output: equivalentOutput,
      type: "function_call_output",
    };
    const equivalentSecond = {
      call_id: "call_equivalent_2",
      output: equivalentOutput,
      type: "function_call_output",
    };
    const reorderedOutput = {
      waitMs: 1_000,
      status: "waiting",
    };
    const reordered = {
      call_id: "call_reordered",
      output: reorderedOutput,
      type: "function_call_output",
    };
    const commandOutput = {
      call_id: "call_command",
      output: "command output",
      type: "function_call_output",
    };
    const mcpOutput = {
      call_id: "call_mcp",
      output: "mcp output",
      type: "function_call_output",
    };
    const overlappingOutput = {
      state: "shared",
    };
    const overlapFirst = {
      call_id: "call_overlap_a",
      output: overlappingOutput,
      type: "function_call_output",
    };
    const overlapOther = {
      call_id: "call_overlap_b",
      output: "different output for the repeated identity",
      type: "function_call_output",
    };
    const overlapRepeatedEquivalent = {
      call_id: "call_overlap_b",
      output: overlappingOutput,
      type: "function_call_output",
    };
    const input = [
      { call_id: "call_repeat", name: "wait", type: "function_call" },
      repeatedFirst,
      repeatedSecond,
      { call_id: "call_equivalent_1", name: "wait", type: "function_call" },
      equivalentFirst,
      { call_id: "call_equivalent_2", name: "wait", type: "function_call" },
      equivalentSecond,
      { call_id: "call_reordered", name: "wait", type: "function_call" },
      reordered,
      { call_id: "call_command", name: "exec_command", type: "function_call" },
      commandOutput,
      { call_id: "call_mcp", name: "mcp__calendar__read", type: "function_call" },
      mcpOutput,
      { call_id: "call_overlap_a", name: "wait", type: "function_call" },
      overlapFirst,
      { call_id: "call_overlap_b", name: "wait", type: "function_call" },
      overlapOther,
      overlapRepeatedEquivalent,
    ] as const;

    const diagnostic = await buildHostedOpenAiCacheDiagnostic({
      endpointKind: "responses",
      method: "POST",
      requestBytes: TEST_TEXT_ENCODER.encode(JSON.stringify({
        input,
        model: "gpt-5.6-terra",
      })),
    });

    expect(diagnostic).toEqual(expect.objectContaining({
      diagnosticVersion: 3,
    }));
    expect(readDiagnosticInputMetric(
      diagnostic,
      "function_output.action.command.execution",
    )).toEqual({ bytes: testJsonByteLength(commandOutput.output), count: 1 });
    expect(readDiagnosticInputMetric(
      diagnostic,
      "function_output.action.dynamic.tool.call",
    )).toEqual({
      bytes: testJsonByteLength(repeatedFirst.output)
        + testJsonByteLength(repeatedSecond.output)
        + testJsonByteLength(equivalentFirst.output)
        + testJsonByteLength(equivalentSecond.output)
        + testJsonByteLength(reordered.output)
        + testJsonByteLength(overlapFirst.output)
        + testJsonByteLength(overlapOther.output)
        + testJsonByteLength(overlapRepeatedEquivalent.output),
      count: 8,
    });
    expect(readDiagnosticInputMetric(
      diagnostic,
      "function_output.action.mcp.tool.call",
    )).toEqual({ bytes: testJsonByteLength(mcpOutput.output), count: 1 });
    expect(readDiagnosticInputMetric(
      diagnostic,
      "function_output.repeated",
    )).toEqual({
      bytes: testJsonByteLength(repeatedSecond.output)
        + testJsonByteLength(overlapRepeatedEquivalent.output),
      count: 2,
    });
    expect(readDiagnosticInputMetric(
      diagnostic,
      "function_output.equivalent",
    )).toEqual({
      bytes: testJsonByteLength(equivalentSecond.output)
        + testJsonByteLength(overlapRepeatedEquivalent.output),
      count: 2,
    });
    parseDiagnosticRuntimeLog(diagnostic);

    const diagnosticJson = JSON.stringify(diagnostic);
    expect(diagnosticJson).not.toContain("call_repeat");
    expect(diagnosticJson).not.toContain("first repeated-call output");
    expect(diagnosticJson).not.toContain("second repeated-call output");
    expect(diagnosticJson).not.toContain("command output");
    expect(diagnosticJson).not.toContain("mcp output");
    expect(diagnosticJson).not.toContain('"status":"waiting"');
  });

  it("counts equivalent output reuse when serialization returns to the first call identity", async () => {
    const sharedOutput = { state: "shared" };
    const sharedOutputBytes = testJsonByteLength(sharedOutput);
    const diagnostic = await buildHostedOpenAiCacheDiagnostic({
      endpointKind: "responses",
      method: "POST",
      requestBytes: TEST_TEXT_ENCODER.encode(JSON.stringify({
        input: [
          { call_id: "call_a", name: "wait", type: "function_call" },
          { call_id: "call_a", output: sharedOutput, type: "function_call_output" },
          { call_id: "call_b", name: "wait", type: "function_call" },
          { call_id: "call_b", output: sharedOutput, type: "function_call_output" },
          { call_id: "call_a", output: sharedOutput, type: "function_call_output" },
        ],
        model: "gpt-5.6-terra",
      })),
    });

    expect(readDiagnosticInputMetric(
      diagnostic,
      "function_output.repeated",
    )).toEqual({ bytes: sharedOutputBytes, count: 1 });
    expect(readDiagnosticInputMetric(
      diagnostic,
      "function_output.equivalent",
    )).toEqual({ bytes: sharedOutputBytes * 2, count: 2 });
    parseDiagnosticRuntimeLog(diagnostic);

    const diagnosticJson = JSON.stringify(diagnostic);
    expect(diagnosticJson).not.toContain("call_a");
    expect(diagnosticJson).not.toContain("call_b");
    expect(diagnosticJson).not.toContain('"state":"shared"');
  });

  it("uses safe deterministic function-call categories for unusual call IDs", async () => {
    const sensitiveLookingName = ["sk", "live", "SYNTHETIC123"].join("_");
    const earlyOutput = {
      call_id: "call_late",
      output: "early synthetic output",
      type: "function_call_output",
    };
    const sensitiveNameOutput = {
      call_id: "call_sensitive",
      output: "sensitive-name synthetic output",
      type: "function_call_output",
    };
    const duplicateOutput = {
      call_id: "call_duplicate",
      output: "duplicate synthetic output",
      type: "function_call_output",
    };
    const input = [
      earlyOutput,
      {
        arguments: "late synthetic arguments",
        call_id: "call_late",
        name: "exec_command",
        type: "function_call",
      },
      {
        arguments: "sensitive-name synthetic arguments",
        call_id: "call_sensitive",
        name: sensitiveLookingName,
        type: "function_call",
      },
      sensitiveNameOutput,
      {
        arguments: "first duplicate synthetic arguments",
        call_id: "call_duplicate",
        name: "exec_command",
        type: "function_call",
      },
      {
        arguments: "second duplicate synthetic arguments",
        call_id: "call_duplicate",
        name: "local_shell",
        type: "function_call",
      },
      duplicateOutput,
    ] as const;

    const diagnostic = await buildHostedOpenAiCacheDiagnostic({
      endpointKind: "responses",
      method: "POST",
      requestBytes: TEST_TEXT_ENCODER.encode(JSON.stringify({
        input,
        model: "gpt-5.6-terra",
      })),
    });

    expect(diagnostic).toEqual(expect.objectContaining({
      inputFunctionCallBytes: [
        testJsonByteLength(input[4]) + testJsonByteLength(input[5]),
        testJsonByteLength(input[1]),
        testJsonByteLength(input[2]),
      ],
      inputFunctionCallNameCounts: [2, 1, 1],
      inputFunctionCallNameKinds: ["duplicate", "exec_command", "other"],
      inputFunctionOutputBytes: [
        testJsonByteLength(duplicateOutput.output),
        testJsonByteLength(earlyOutput.output),
        testJsonByteLength(sensitiveNameOutput.output),
      ],
      inputFunctionOutputNameCounts: [1, 1, 1],
      inputFunctionOutputNameKinds: ["duplicate", "exec_command", "other"],
      inputTailItemFunctionNameKinds: [
        "exec_command",
        "exec_command",
        "other",
        "other",
        "duplicate",
        "duplicate",
        "duplicate",
      ],
    }));
    parseDiagnosticRuntimeLog(diagnostic);

    const diagnosticJson = JSON.stringify(diagnostic);
    expect(diagnosticJson).not.toContain("call_late");
    expect(diagnosticJson).not.toContain("call_sensitive");
    expect(diagnosticJson).not.toContain("call_duplicate");
    expect(diagnosticJson).not.toContain(sensitiveLookingName);
    expect(diagnosticJson).not.toContain("synthetic output");
    expect(diagnosticJson).not.toContain("synthetic arguments");
  });

  it("bounds OpenAI input tail diagnostics to the last eight items", async () => {
    const input = Array.from({ length: 10 }, (_, index) => ({
      content: `private-tail-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      type: "message",
    }));

    const diagnostic = await buildHostedOpenAiCacheDiagnostic({
      endpointKind: "responses",
      method: "POST",
      requestBytes: TEST_TEXT_ENCODER.encode(JSON.stringify({
        input,
        model: "gpt-5.6-terra",
      })),
    });
    const expectedTail = input.slice(2);

    expect(diagnostic).toEqual(expect.objectContaining({
      inputCount: 10,
      inputTailItemCount: 8,
      inputTailItemFingerprintPresent: false,
      inputTailItemIndexes: [2, 3, 4, 5, 6, 7, 8, 9],
      inputTailItemOutputBytes: [0, 0, 0, 0, 0, 0, 0, 0],
      inputTailItemReverseIndexes: [7, 6, 5, 4, 3, 2, 1, 0],
      inputTailItemRoleKinds: [
        "user",
        "assistant",
        "user",
        "assistant",
        "user",
        "assistant",
        "user",
        "assistant",
      ],
      inputTailItemTypeKinds: [
        "message",
        "message",
        "message",
        "message",
        "message",
        "message",
        "message",
        "message",
      ],
    }));
    expect(diagnostic.inputTailItemBytes).toEqual(
      expectedTail.map((item) => testJsonByteLength(item)),
    );
    expect(diagnostic.inputTailItemContentBytes).toEqual(
      expectedTail.map((item) => testJsonByteLength(item.content)),
    );
    expect(diagnostic.inputTailItemStringBytes).toEqual(
      expectedTail.map((item) =>
        testByteLength(item.content) + testByteLength(item.role) + testByteLength(item.type)
      ),
    );
    expect(JSON.stringify(diagnostic)).not.toContain("private-tail-0");
    expect(JSON.stringify(diagnostic)).not.toContain("private-tail-9");
  });

  it("keeps maximal OpenAI input classification diagnostics runtime-log safe", async () => {
    const input = [
      "computer_call",
      "computer_call_output",
      "file_search_call",
      "function_call",
      "function_call_output",
      "image_generation_call",
      "local_shell_call",
      "local_shell_call_output",
      "message",
      "reasoning",
      "web_search_call",
    ].map((type) => ({ role: "user", type }));
    input.push(
      { role: "assistant", type: "message" },
      { role: "developer", type: "message" },
      { role: "system", type: "message" },
      { role: "tool", type: "message" },
      { role: "unknown_role", type: "unknown_type" },
      { role: "", type: "" },
    );

    const diagnostic = await buildHostedOpenAiCacheDiagnostic({
      endpointKind: "responses",
      method: "POST",
      requestBytes: TEST_TEXT_ENCODER.encode(JSON.stringify({
        input,
        model: "gpt-5.6-terra",
      })),
    });

    expect(diagnostic.inputItemTypeKinds).toHaveLength(13);
    expect(diagnostic.inputItemRoleKinds).toHaveLength(7);
    parseDiagnosticRuntimeLog(diagnostic);
  });

  it("bounds OpenAI input shape traversal for deeply nested requests", async () => {
    const nestedJson = `${"[".repeat(10_000)}"leaf"${"]".repeat(10_000)}`;

    const diagnostic = await buildHostedOpenAiCacheDiagnostic({
      endpointKind: "responses",
      method: "POST",
      requestBytes: TEST_TEXT_ENCODER.encode(
        `{"input":[${nestedJson}],"model":"gpt-5.6-terra"}`,
      ),
    });

    expect(diagnostic).toEqual(expect.objectContaining({
      inputCount: 1,
      inputLargestItemBytes: 0,
      inputShapeTraversalTruncated: true,
      jsonValid: true,
    }));
    expect(diagnostic.inputBytes).toBeUndefined();
  });

  it("builds bounded OpenAI cache diagnostics for degraded request bodies", async () => {
    const smallBody = JSON.stringify({
      input: "hello",
      model: "tenant-private-model-123",
      prompt_cache_key: "cache-namespace-synthetic-1234567890",
      prompt_cache_retention: "24h",
    });
    const smallDiagnostic = await buildHostedOpenAiCacheDiagnostic({
      endpointKind: "responses",
      method: "POST",
      requestBytes: new TextEncoder().encode(smallBody),
    });

    expect(smallDiagnostic).toEqual(expect.objectContaining({
      cacheNamespaceFingerprintPresent: false,
      cacheNamespacePresent: true,
      fingerprintKind: "none",
      inputFingerprintPresent: false,
      jsonType: "object",
      jsonValid: true,
      modelKind: "other",
      requestFingerprintPresent: false,
    }));
    expect(smallDiagnostic.inputItemTypeKinds).toBeUndefined();
    expect(smallDiagnostic.inputItemRoleKinds).toBeUndefined();
    expect(smallDiagnostic.inputNestedMetricBytes).toBeUndefined();
    expect(smallDiagnostic.inputLargestItemBytes).toBeUndefined();
    expect(JSON.stringify(smallDiagnostic)).not.toContain("tenant-private-model-123");
    expect(JSON.stringify(smallDiagnostic)).not.toContain("cache-namespace-synthetic");

    const invalidDiagnostic = await buildHostedOpenAiCacheDiagnostic({
      endpointKind: "responses",
      fingerprintSecret: "diagnostic-fingerprint-secret",
      method: "POST",
      requestBytes: new TextEncoder().encode("{"),
    });

    expect(invalidDiagnostic).toEqual(expect.objectContaining({
      fingerprintKind: "hmac-sha256",
      jsonType: "invalid",
      jsonValid: false,
      requestFingerprintPresent: false,
    }));

    const tooLargeBody = JSON.stringify({
      input: "x".repeat(6 * 1024 * 1024),
      model: "gpt-5.6-terra",
    });
    const tooLargeDiagnostic = await buildHostedOpenAiCacheDiagnostic({
      endpointKind: "responses",
      fingerprintSecret: "diagnostic-fingerprint-secret",
      method: "POST",
      requestBytes: TEST_TEXT_ENCODER.encode(tooLargeBody),
    });

    expect(tooLargeDiagnostic).toEqual(expect.objectContaining({
      fingerprintKind: "hmac-sha256",
      jsonSkippedReasonKind: "too_large",
      jsonType: "unknown",
      jsonValid: false,
      requestFingerprintPresent: false,
      requestFullFingerprintSkipped: true,
      requestPrefixLengths: [8 * 1024, 32 * 1024, 128 * 1024],
    }));
    expect(tooLargeDiagnostic.requestPrefixFingerprints).toEqual(
      expect.arrayContaining([expect.stringMatching(/^hmac-sha256:[a-f0-9]{64}$/u)]),
    );
    expect(tooLargeDiagnostic.inputType).toBeUndefined();
    expect(tooLargeDiagnostic.inputNestedMetricBytes).toBeUndefined();
  });
});
