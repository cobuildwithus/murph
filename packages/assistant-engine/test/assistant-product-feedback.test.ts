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
  buildAssistantSystemPrompt,
} from "../src/assistant/system-prompt.js";

const feedback = {
  action: "view" as const,
  kind: "feature_interest" as const,
  outcome: "interest" as const,
  productArea: "messaging" as const,
  relatedChangelogItemIds: ["beta", "alpha"],
};

describe("assistant product feedback", () => {
  it("is stable across related-item ordering and scoped to the latest accepted input", () => {
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
    expect(nextInput).not.toBe(first);
    expect(liveSteeredInput).toBe(nextInput);
  });

  it("enables recording only for accepted assistant input", () => {
    expect(resolveAssistantProductFeedbackAcceptedInputIds([
      { id: "initial-user-prompt", source: "initial" },
      { id: "assistant_input_1", source: "assistant-input" },
    ])).toEqual(["assistant_input_1"]);
    expect(createAssistantProductFeedbackRecorder({
      acceptedInputItems: [{ id: "initial-user-prompt", source: "initial" }],
      productFeedbackCandidateSink: {
        acceptProductFeedbackCandidate: vi.fn(),
      },
    })).toBeNull();
  });

  it("exposes the dynamic tool only when the hosted recorder is available", () => {
    expect(resolveMurphDynamicTools({ productFeedbackAvailable: true }))
      .toContain(MURPH_SUBMIT_PRODUCT_FEEDBACK_TOOL);
    expect(resolveMurphDynamicTools({ productFeedbackAvailable: false }))
      .not.toContain(MURPH_SUBMIT_PRODUCT_FEEDBACK_TOOL);
  });

  it("collects the first closed candidate with latest checkpointed authority", async () => {
    let acceptedInputIds = ["assistant_input_1"];
    const recorder = createAssistantProductFeedbackRecorder({
      acceptedInputItems: [{ id: "assistant_input_1", source: "assistant-input" }],
      getAcceptedInputIds: () => acceptedInputIds,
      productFeedbackCandidateSink: {
        acceptProductFeedbackCandidate: vi.fn(),
      },
    });
    if (!recorder) {
      throw new Error("Expected a turn-scoped product feedback recorder.");
    }
    acceptedInputIds = ["assistant_input_1", "assistant_input_2"];

    await recorder.recordProductFeedback(feedback);

    expect(recorder.readProductFeedback()).toEqual({
      ...feedback,
      idempotencyKey: buildAssistantProductFeedbackIdempotencyKey({
        acceptedInputIds,
        feedback,
      }),
    });
  });

  it("advertises only the closed product abstraction", () => {
    const description = MURPH_SUBMIT_PRODUCT_FEEDBACK_TOOL.description;
    const schema = JSON.stringify(MURPH_SUBMIT_PRODUCT_FEEDBACK_TOOL.inputSchema);
    expect(MURPH_SUBMIT_PRODUCT_FEEDBACK_TOOL.inputSchema.required).toEqual([
      "action",
      "kind",
      "outcome",
      "productArea",
    ]);
    expect(description).toContain("one de-identified Murph product-feedback candidate");
    expect(description).toContain("never include prose or private facts");
    expect(description).toContain("persistence is best-effort after the reply");
    expect(schema).toContain('"productArea"');
    expect(schema).toContain('"action"');
    expect(schema).toContain('"outcome"');
    expect(schema).toContain('"capability_missing"');
    expect(schema).toContain('"match_or_classify"');
    expect(schema).toContain('"misclassified"');
    expect(schema).not.toContain('"summary"');
    expect(schema).not.toContain('"topic"');
  });

  it("keeps effective prompt guidance aligned with the no-prose schema", () => {
    const systemPrompt = buildAssistantSystemPrompt({
      assistantCliContract: null,
      assistantContextSnapshotPrompt: null,
      assistantHostedDeviceConnectAvailable: false,
      assistantKnowledgeToolsAvailable: false,
      channel: "telegram",
      cliAccess: { rawCommand: "vault-cli", setupCommand: "murph" },
      conversationScope: "direct",
      currentLocalDate: "2026-07-31",
      currentTimeZone: "Europe/Madrid",
      hostedRuntime: true,
      modelBehaviorProfile: "gpt5-agentic",
      onboardingGuidance: false,
      turnTrigger: null,
    });

    expect(systemPrompt).toContain(
      "closed kind, product-area, action, and outcome enum values",
    );
    expect(systemPrompt).toContain("never put prose or private facts into feedback fields");
    expect(systemPrompt).not.toContain("Start inferred summaries");
  });

  it("parses and collects one closed candidate without a pre-reply write", async () => {
    const acceptProductFeedbackCandidate = vi.fn();
    const productFeedbackRecorder = createAssistantProductFeedbackRecorder({
      acceptedInputItems: [{ id: "assistant_input_1", source: "assistant-input" }],
      productFeedbackCandidateSink: { acceptProductFeedbackCandidate },
    });
    const request = readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          action: "view",
          kind: "feature_interest",
          outcome: "interest",
          productArea: "messaging",
          relatedChangelogItemIds: ["native-message-formatting"],
        },
        namespace: "murph",
        tool: "submit_product_feedback",
      },
    });

    expect(request).toEqual({
      feedback: {
        action: "view",
        kind: "feature_interest",
        outcome: "interest",
        productArea: "messaging",
        relatedChangelogItemIds: ["native-message-formatting"],
      },
      kind: "submit-product-feedback",
    });
    if (!request || !productFeedbackRecorder) {
      throw new Error("Expected the product feedback request and recorder.");
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
      action: "view",
      idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/u),
      kind: "feature_interest",
      outcome: "interest",
      productArea: "messaging",
      relatedChangelogItemIds: ["native-message-formatting"],
    });
    expect(result.rpcResult).toEqual({
      success: true,
      contentItems: [{ type: "inputText", text: "product feedback candidate accepted" }],
    });
  });

  it.each([
    ["free text", {
      action: "view",
      kind: "frustration",
      outcome: "unexpected_behavior",
      productArea: "web_app",
      summary: "A name, diagnosis, dose, location, or quotation.",
    }],
    ["invalid area", {
      action: "view",
      kind: "frustration",
      outcome: "unexpected_behavior",
      productArea: "private_health_context",
    }],
    ["invalid action", {
      action: "quote_user",
      kind: "frustration",
      outcome: "unexpected_behavior",
      productArea: "assistant",
    }],
    ["invalid outcome", {
      action: "view",
      kind: "frustration",
      outcome: "named_person_failed",
      productArea: "assistant",
    }],
    ["missing classification", { kind: "feature_request" }],
  ])("rejects %s tool arguments before recording", (_label, args) => {
    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: args,
        namespace: "murph",
        tool: "submit_product_feedback",
      },
    })?.kind).toBe("invalid-product-feedback-arguments");
  });
});
