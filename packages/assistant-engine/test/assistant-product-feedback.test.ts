import { describe, expect, it, vi } from "vitest";

import {
  executeMurphDynamicToolRequest,
  MURPH_SUBMIT_PRODUCT_FEEDBACK_TOOL,
  readMurphDynamicToolRequest,
  resolveMurphDynamicTools,
} from "../src/assistant-codex/dynamic-tools.js";
import {
  buildAssistantProductFeedbackIdempotencyKey,
  createAssistantProductFeedbackRecorder,
  resolveAssistantProductFeedbackAcceptedInputIds,
} from "../src/assistant/turn-progress.js";
import {
  MURPH_MANAGED_AUTOMATIONS,
  MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
} from "../src/assistant/managed-automations.js";
import {
  buildAssistantSystemPrompt,
} from "../src/assistant/system-prompt.js";

describe("assistant product feedback", () => {
  it("is stable across related-item ordering and summary wording, and scoped to accepted input", () => {
    const feedback = {
      kind: "feature_interest" as const,
      relatedChangelogItemIds: ["beta", "alpha"],
      summary: "Interested in the beta and alpha updates.",
    };
    const first = buildAssistantProductFeedbackIdempotencyKey({
      acceptedInputIds: ["assistant_input_1"],
      feedback,
    });
    const reordered = buildAssistantProductFeedbackIdempotencyKey({
      acceptedInputIds: ["assistant_input_1"],
      feedback: {
        ...feedback,
        relatedChangelogItemIds: ["alpha", "beta"],
      },
    });
    const reworded = buildAssistantProductFeedbackIdempotencyKey({
      acceptedInputIds: ["assistant_input_1"],
      feedback: {
        ...feedback,
        summary: "Different concise wording for the same explicit feedback.",
      },
    });
    const nextInput = buildAssistantProductFeedbackIdempotencyKey({
      acceptedInputIds: ["assistant_input_2"],
      feedback,
    });
    const liveSteeredInput = buildAssistantProductFeedbackIdempotencyKey({
      acceptedInputIds: ["assistant_input_1", "assistant_input_2"],
      feedback,
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(reordered).toBe(first);
    expect(reworded).toBe(first);
    expect(nextInput).not.toBe(first);
    expect(liveSteeredInput).toBe(nextInput);
  });

  it("enables recording only for accepted assistant input", () => {
    expect(resolveAssistantProductFeedbackAcceptedInputIds([
      {
        id: "initial-user-prompt",
        source: "initial",
      },
      {
        id: "assistant_input_1",
        source: "assistant-input",
      },
    ])).toEqual(["assistant_input_1"]);
    expect(createAssistantProductFeedbackRecorder({
      acceptedInputItems: [{ id: "initial-user-prompt", source: "initial" }],
      productFeedbackCandidateSink: {
        acceptProductFeedbackCandidate: vi.fn(),
      },
    })).toBeNull();
  });

  it("exposes the dynamic tool only when the hosted recorder is available", () => {
    const enabled = resolveMurphDynamicTools({
      productFeedbackAvailable: true,
    });
    const disabled = resolveMurphDynamicTools({
      productFeedbackAvailable: false,
    });

    expect(enabled).toContain(MURPH_SUBMIT_PRODUCT_FEEDBACK_TOOL);
    expect(disabled).not.toContain(MURPH_SUBMIT_PRODUCT_FEEDBACK_TOOL);
  });

  it("collects the first candidate with the latest checkpointed input authority", async () => {
    let acceptedInputIds = ["assistant_input_1"];
    const acceptProductFeedbackCandidate = vi.fn();
    const recorder = createAssistantProductFeedbackRecorder({
      acceptedInputItems: [{ id: "assistant_input_1", source: "assistant-input" }],
      getAcceptedInputIds: () => acceptedInputIds,
      productFeedbackCandidateSink: { acceptProductFeedbackCandidate },
    });
    if (!recorder) {
      throw new Error("Expected a turn-scoped product feedback recorder.");
    }
    acceptedInputIds = ["assistant_input_1", "assistant_input_2"];
    const feedback = {
      kind: "feature_interest" as const,
      relatedChangelogItemIds: [],
      summary: "Interested in live steering.",
    };

    await recorder.recordProductFeedback(feedback);

    expect(acceptProductFeedbackCandidate).not.toHaveBeenCalled();
    expect(recorder.readProductFeedback()).toEqual({
      ...feedback,
      idempotencyKey: buildAssistantProductFeedbackIdempotencyKey({
        acceptedInputIds,
        feedback,
      }),
    });
  });

  it("advertises one structured attempt and optional changelog metadata", () => {
    const description = MURPH_SUBMIT_PRODUCT_FEEDBACK_TOOL.description;
    const schema = JSON.stringify(MURPH_SUBMIT_PRODUCT_FEEDBACK_TOOL.inputSchema);
    expect(MURPH_SUBMIT_PRODUCT_FEEDBACK_TOOL.inputSchema.required).toEqual(["kind", "summary"]);
    expect(
      MURPH_SUBMIT_PRODUCT_FEEDBACK_TOOL.inputSchema.properties.summary.maxLength,
    ).toBe(2_000);
    expect(description).toContain("one structured Murph product-feedback candidate");
    expect(description).toContain("current accepted request");
    expect(description).toContain("optional related changelog item ids");
    expect(description).toContain("accepted, already accepted, or unavailable");
    expect(description).toContain("Provide the feedback kind, one concise product-only summary");
    expect(description).toContain(
      "append a privacy-safe reproduction recipe in the same summary field",
    );
    expect(description).toContain(
      'Explicit verified-private human support uses kind "frustration", empty changelog ids',
    );
    expect(description).toContain('beginning exactly "Support escalation:"');
    expect(description).toContain("waits for the durable callback");
    expect(description).toContain("do not retry after any result");
    expect(schema).toContain('"minItems":0');
    expect(schema).toContain('"feature_interest"');
    expect(schema).toContain('"summary"');
    expect(schema).toContain('Use feature_request for a missing or unsupported Murph path');
    expect(schema).toContain('Reserved support escalation always uses frustration');
    expect(schema).toContain('Make it actionable without the conversation');
    expect(schema).toContain('Concise de-identified, product-only summary');
    expect(schema).toContain('begin exactly \\"Support escalation:\\"');
    expect(schema).toContain("Murph's concise de-identified explanation in its own words");
    expect(schema).toContain("never copy or quote the member's message");
    expect(schema).not.toContain('"supportArea"');
    expect(schema).not.toContain('"supportProblem"');
    expect(schema).toContain('generic actor');
    expect(schema).toContain('expected versus observed result');
    expect(schema).toContain('section beginning exactly \\"Reproduction:\\"');
    expect(schema).toContain('independently usable without the original conversation');
    expect(schema).toContain('exact Murph CLI commands or tool calls with synthetic arguments');
    expect(schema).toContain('sanitized example request or user action');
    expect(schema).toContain('synthetic placeholders');
    expect(schema).toContain('insufficient for a complete reproduction');
    expect(schema).toContain('pure feature interest with no failure or friction to reproduce');
    expect(schema).toContain("Never copy or closely paraphrase the member's wording");
    expect(schema).toContain('concrete product constraint the source established');
    expect(schema).toContain('instead of replacing them with vague labels');
    expect(schema).toContain('omit it or mark it unclear rather than infer or invent it');
    expect(schema).toContain('Abstract every private fact');
    expect(schema).toContain('least-specific product concept');
    expect(schema).toContain('do not preserve a private fact merely because it was relevant');
    expect(schema).toContain('Never include names, handles, account or member identifiers');
    expect(schema).toContain('diagnoses, symptoms, medications, treatments');
    expect(schema).toContain('exact health/fitness/nutrition values');
    expect(schema).toContain('desired outcome and missing Murph capability');
    expect(schema).toContain('Optional metadata');
    expect(schema).toContain('Speculative:');
    expect(schema).toContain('Murph-observed:');
    expect(schema).not.toContain('"topic"');
  });

  it("keeps the detailed summary rubric single-owned by the tool schema", () => {
    const rubricMarker =
      "name the generic actor, exact Murph surface or workflow";
    const systemPrompt = buildAssistantSystemPrompt({
      assistantCliContract: null,
      assistantContextSnapshotPrompt: null,
      assistantHostedDeviceConnectAvailable: false,
      assistantKnowledgeToolsAvailable: false,
      channel: "telegram",
      cliAccess: {
        rawCommand: "vault-cli",
        setupCommand: "murph",
      },
      conversationScope: "direct",
      currentLocalDate: "2026-07-30",
      currentTimeZone: "America/New_York",
      hostedRuntime: true,
      modelBehaviorProfile: "gpt5-agentic",
      onboardingGuidance: false,
      turnTrigger: null,
    });
    const productNotes = MURPH_MANAGED_AUTOMATIONS.find(
      (automation) =>
        automation.automationId === MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
    );
    expect(productNotes).toBeDefined();
    expect(systemPrompt).toContain(
      "append a privacy-safe `Reproduction:` section in that same summary field",
    );

    const toolSchema = JSON.stringify(
      MURPH_SUBMIT_PRODUCT_FEEDBACK_TOOL.inputSchema,
    );
    const ordinaryStack = `${systemPrompt}\n${toolSchema}`;
    const managedStack =
      `${systemPrompt}\n${productNotes?.instructions ?? ""}\n${toolSchema}`;

    expect(ordinaryStack.split(rubricMarker)).toHaveLength(2);
    expect(managedStack.split(rubricMarker)).toHaveLength(2);
  });

  it("parses and collects one explicit feedback candidate without a pre-reply write", async () => {
    const acceptProductFeedbackCandidate = vi.fn();
    const productFeedbackRecorder = createAssistantProductFeedbackRecorder({
      acceptedInputItems: [{ id: "assistant_input_1", source: "assistant-input" }],
      productFeedbackCandidateSink: { acceptProductFeedbackCandidate },
    });
    const request = readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          kind: "feature_interest",
          relatedChangelogItemIds: ["native-message-formatting"],
          summary: "Interested in native message formatting.",
        },
        namespace: "murph",
        tool: "submit_product_feedback",
      },
    });

    expect(request).toEqual({
      feedback: {
        kind: "feature_interest",
        relatedChangelogItemIds: ["native-message-formatting"],
        summary: "Interested in native message formatting.",
      },
      kind: "submit-product-feedback",
    });
    if (!request) {
      throw new Error("Expected a product feedback dynamic tool request.");
    }
    if (!productFeedbackRecorder) {
      throw new Error("Expected a turn-scoped product feedback recorder.");
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      nextUsageOrdinal: () => 0,
      productFeedbackRecorder,
      progressDelivery: null,
      request,
    });

    expect(acceptProductFeedbackCandidate).not.toHaveBeenCalled();
    expect(productFeedbackRecorder.readProductFeedback()).toEqual({
      idempotencyKey: buildAssistantProductFeedbackIdempotencyKey({
        acceptedInputIds: ["assistant_input_1"],
        feedback: {
          kind: "feature_interest",
          relatedChangelogItemIds: ["native-message-formatting"],
          summary: "Interested in native message formatting.",
        },
      }),
      kind: "feature_interest",
      relatedChangelogItemIds: ["native-message-formatting"],
      summary: "Interested in native message formatting.",
    });
    expect(result.rpcResult).toEqual({
      success: true,
      contentItems: [{ type: "inputText", text: "product feedback candidate accepted" }],
    });

    const repeatedRequest = readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          kind: "frustration",
          summary: "This later candidate must not replace the first.",
        },
        namespace: "murph",
        tool: "submit_product_feedback",
      },
    });
    if (!repeatedRequest) {
      throw new Error("Expected a repeated product feedback request.");
    }
    const repeatedResult = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      nextUsageOrdinal: () => 0,
      productFeedbackRecorder,
      progressDelivery: null,
      request: repeatedRequest,
    });

    expect(repeatedResult.rpcResult).toEqual({
      success: true,
      contentItems: [{
        type: "inputText",
        text: "product feedback candidate already accepted",
      }],
    });
    expect(productFeedbackRecorder.readProductFeedback()?.summary).toBe(
      "Interested in native message formatting.",
    );
  });

  it("rejects malformed reserved support-escalation shapes at the tool boundary", async () => {
    const acceptProductFeedbackCandidate = vi.fn();
    const deliverProductSupportEscalation = vi.fn();
    const productFeedbackRecorder = createAssistantProductFeedbackRecorder({
      acceptedInputItems: [{ id: "assistant_input_1", source: "assistant-input" }],
      productFeedbackCandidateSink: {
        acceptProductFeedbackCandidate,
        deliverProductSupportEscalation,
      },
    });
    if (!productFeedbackRecorder) {
      throw new Error("Expected a turn-scoped product feedback recorder.");
    }

    for (const malformedArguments of [
      { kind: "frustration", summary: "Support escalation" },
      { kind: "frustration", summary: "Support escalation:" },
      {
        kind: "feature_request",
        summary:
          "Support escalation: a connected source reports success but Murph does not finish the connection.",
      },
      {
        kind: "frustration",
        relatedChangelogItemIds: ["native-message-formatting"],
        summary:
          "Support escalation: a connected source reports success but Murph does not finish the connection.",
      },
      {
        kind: "frustration",
        summary:
          "Support escalation: a connected source reports success but Murph does not finish the connection.",
        supportArea: "connected_source",
      },
    ]) {
      const request = readMurphDynamicToolRequest({
        method: "item/tool/call",
        params: {
          arguments: malformedArguments,
          namespace: "murph",
          tool: "submit_product_feedback",
        },
      });
      if (!request) {
        throw new Error("Expected a parsed product feedback request.");
      }
      const result = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        nextUsageOrdinal: () => 0,
        productFeedbackRecorder,
        progressDelivery: null,
        request,
      });

      expect(result.rpcResult).toEqual({
        success: false,
        contentItems: [{
          type: "inputText",
          text: "invalid product feedback arguments",
        }],
      });
    }

    expect(deliverProductSupportEscalation).not.toHaveBeenCalled();
    expect(acceptProductFeedbackCandidate).not.toHaveBeenCalled();
    expect(productFeedbackRecorder.readProductFeedback()).toBeNull();
  });

  it("rejects a support escalation outside a verified direct conversation scope", async () => {
    const deliverProductSupportEscalation = vi.fn();
    const productFeedbackRecorder = createAssistantProductFeedbackRecorder({
      acceptedInputItems: [{ id: "assistant_input_1", source: "assistant-input" }],
      productFeedbackCandidateSink: {
        acceptProductFeedbackCandidate: vi.fn(),
        deliverProductSupportEscalation,
      },
    });
    if (!productFeedbackRecorder) {
      throw new Error("Expected a turn-scoped product feedback recorder.");
    }
    const request = readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          kind: "frustration",
          summary:
            "Support escalation: a connected source reports success but Murph does not finish the connection.",
        },
        namespace: "murph",
        tool: "submit_product_feedback",
      },
    });
    if (!request) {
      throw new Error("Expected a parsed support escalation request.");
    }

    for (const conversationScope of [
      null,
      "group",
      "unverified-external",
    ] as const) {
      const result = await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedToolContext: {
          computerToolsAvailable: false,
          currentHostedDeliveryContext: () => null,
          currentHostedMailboxItemIds: () => [],
          currentUserActionScope: () => conversationScope === null
            ? null
            : {
                acceptedInputIds: ["assistant_input_1"],
                conversationId: null,
                conversationScope,
                inboundMailboxItemIds: [],
                originSessionId: "session-scope-check",
                recipientKey: null,
              },
          sendVaultFile: async () => {
            throw new Error("Vault-file sending is unavailable for this turn.");
          },
          vaultFileSendAvailable: false,
        },
        nextUsageOrdinal: () => 0,
        productFeedbackRecorder,
        progressDelivery: null,
        request,
      });

      expect(result.rpcResult).toEqual({
        success: false,
        contentItems: [{
          type: "inputText",
          text: expect.stringContaining("verified private direct conversation"),
        }],
      });
    }

    expect(deliverProductSupportEscalation).not.toHaveBeenCalled();
    expect(productFeedbackRecorder.readProductFeedback()).toBeNull();
  });

  it("reports durable in-turn delivery for the exact support escalation shape", async () => {
    const deliverProductSupportEscalation = vi
      .fn()
      .mockResolvedValue({ recorded: true });
    const productFeedbackRecorder = createAssistantProductFeedbackRecorder({
      acceptedInputItems: [{ id: "assistant_input_1", source: "assistant-input" }],
      productFeedbackCandidateSink: {
        acceptProductFeedbackCandidate: vi.fn(),
        deliverProductSupportEscalation,
      },
    });
    if (!productFeedbackRecorder) {
      throw new Error("Expected a turn-scoped product feedback recorder.");
    }
    const request = readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          kind: "frustration",
          summary:
            "Support escalation: a connected source reports success but Murph does not finish the connection.",
        },
        namespace: "murph",
        tool: "submit_product_feedback",
      },
    });
    if (!request) {
      throw new Error("Expected a parsed support escalation request.");
    }
    const hostedToolContext = {
      computerToolsAvailable: false,
      currentHostedDeliveryContext: () => null,
      currentHostedMailboxItemIds: () => [],
      currentUserActionScope: () => ({
        acceptedInputIds: ["assistant_input_1"],
        conversationId: null,
        conversationScope: "direct" as const,
        inboundMailboxItemIds: [],
        originSessionId: "session-scope-check",
        recipientKey: null,
      }),
      sendVaultFile: async () => {
        throw new Error("Vault-file sending is unavailable for this turn.");
      },
      vaultFileSendAvailable: false,
    };

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext,
      nextUsageOrdinal: () => 0,
      productFeedbackRecorder,
      progressDelivery: null,
      request,
    });

    expect(deliverProductSupportEscalation).toHaveBeenCalledOnce();
    expect(result.rpcResult).toEqual({
      success: true,
      contentItems: [{ type: "inputText", text: "product feedback candidate accepted" }],
    });
    expect(productFeedbackRecorder.readProductFeedback()).toBeNull();

    const failingDelivery = vi
      .fn()
      .mockRejectedValue(new Error("callback timed out"));
    const failingRecorder = createAssistantProductFeedbackRecorder({
      acceptedInputItems: [{ id: "assistant_input_1", source: "assistant-input" }],
      productFeedbackCandidateSink: {
        acceptProductFeedbackCandidate: vi.fn(),
        deliverProductSupportEscalation: failingDelivery,
      },
    });
    if (!failingRecorder) {
      throw new Error("Expected a turn-scoped product feedback recorder.");
    }
    const failedResult = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext,
      nextUsageOrdinal: () => 0,
      productFeedbackRecorder: failingRecorder,
      progressDelivery: null,
      request,
    });

    expect(failedResult.rpcResult).toEqual({
      success: false,
      contentItems: [{
        type: "inputText",
        text: "product feedback candidate unavailable",
      }],
    });
    const repeatedFailedResult = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext,
      nextUsageOrdinal: () => 1,
      productFeedbackRecorder: failingRecorder,
      progressDelivery: null,
      request,
    });

    expect(repeatedFailedResult.rpcResult).toEqual({
      success: false,
      contentItems: [{
        type: "inputText",
        text: "product feedback candidate unavailable",
      }],
    });
    expect(failingDelivery).toHaveBeenCalledOnce();
  });

  it("parses generalized feature-request feedback without changelog ids", () => {
    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          kind: "feature_interest",
          summary: "Interested in generated song reminders.",
        },
        namespace: "murph",
        tool: "submit_product_feedback",
      },
    })).toEqual({
      feedback: {
        kind: "feature_interest",
        relatedChangelogItemIds: [],
        summary: "Interested in generated song reminders.",
      },
      kind: "submit-product-feedback",
    });

    const request = readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          kind: "feature_request",
          summary: "Wants Strava integration support.",
        },
        namespace: "murph",
        tool: "submit_product_feedback",
      },
    });

    expect(request).toEqual({
      feedback: {
        kind: "feature_request",
        relatedChangelogItemIds: [],
        summary: "Wants Strava integration support.",
      },
      kind: "submit-product-feedback",
    });
  });

  it("redacts sensitive-looking summary spans before recording", () => {
    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          kind: "feature_request",
          summary:
            "Email user@example.com, call 415-555-1212, token sk_test_abcdefghijklmnopqrstuvwxyz.",
        },
        namespace: "murph",
        tool: "submit_product_feedback",
      },
    })).toEqual({
      feedback: {
        kind: "feature_request",
        relatedChangelogItemIds: [],
        summary: "Email [redacted], call [redacted], token [redacted].",
      },
      kind: "submit-product-feedback",
    });
  });

  it("rejects malformed generalized feedback tool arguments", () => {
    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          feedbackTags: ["message-formatting"],
          kind: "feature_request",
          summary: "Wants better message formatting.",
        },
        namespace: "murph",
        tool: "submit_product_feedback",
      },
    })?.kind).toBe("invalid-product-feedback-arguments");

    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          kind: "feature_request",
          topic: "integrations",
          summary: "Wants Strava integration support.",
        },
        namespace: "murph",
        tool: "submit_product_feedback",
      },
    })?.kind).toBe("invalid-product-feedback-arguments");

    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          kind: "feature_request",
        },
        namespace: "murph",
        tool: "submit_product_feedback",
      },
    })?.kind).toBe("invalid-product-feedback-arguments");

    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          kind: "feature_request",
          summary: "",
        },
        namespace: "murph",
        tool: "submit_product_feedback",
      },
    })?.kind).toBe("invalid-product-feedback-arguments");
  });
});
