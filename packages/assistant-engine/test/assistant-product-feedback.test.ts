import { describe, expect, it, vi } from "vitest";

import type {
  HostedRuntimeProductFeedbackRecord,
} from "@murphai/hosted-execution/runtime-control";

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

describe("assistant product feedback", () => {
  it("is stable across related-item ordering and scoped to accepted input", () => {
    const feedback = {
      kind: "feature_interest" as const,
      relatedChangelogItemIds: ["beta", "alpha"],
      topic: "changelog" as const,
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
    const nextInput = buildAssistantProductFeedbackIdempotencyKey({
      acceptedInputIds: ["assistant_input_2"],
      feedback,
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(reordered).toBe(first);
    expect(nextInput).not.toBe(first);
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
      productFeedbackRecorder: {
        recordProductFeedback: vi.fn(),
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

  it("advertises the shipped-interest changelog id requirement in the tool schema", () => {
    const schema = JSON.stringify(MURPH_SUBMIT_PRODUCT_FEEDBACK_TOOL.inputSchema);
    expect(schema).toContain('"minItems":1');
    expect(schema).toContain('"feature_interest"');
  });

  it("parses and records explicit feedback through the turn-scoped capability", async () => {
    const recordProductFeedback = vi.fn(async (
      _feedback: HostedRuntimeProductFeedbackRecord,
    ) => ({
      feedbackId: "product_feedback_123",
      recorded: true,
    }));
    const productFeedbackRecorder = createAssistantProductFeedbackRecorder({
      acceptedInputItems: [{ id: "assistant_input_1", source: "assistant-input" }],
      productFeedbackRecorder: { recordProductFeedback },
    });
    const request = readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          kind: "feature_interest",
          relatedChangelogItemIds: ["native-message-formatting"],
          topic: "changelog",
        },
        namespace: "murph",
        tool: "submit_product_feedback",
      },
    });

    expect(request).toEqual({
      feedback: {
        kind: "feature_interest",
        relatedChangelogItemIds: ["native-message-formatting"],
        topic: "changelog",
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

    expect(recordProductFeedback).toHaveBeenCalledWith({
      idempotencyKey: buildAssistantProductFeedbackIdempotencyKey({
        acceptedInputIds: ["assistant_input_1"],
        feedback: {
          kind: "feature_interest",
          relatedChangelogItemIds: ["native-message-formatting"],
          topic: "changelog",
        },
      }),
      kind: "feature_interest",
      relatedChangelogItemIds: ["native-message-formatting"],
      topic: "changelog",
    });
    expect(result.rpcResult).toEqual({
      success: true,
      contentItems: [{ type: "inputText", text: "product feedback recorded" }],
    });
  });

  it("parses generalized feature-request feedback without changelog ids", () => {
    const request = readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          kind: "feature_request",
          topic: "integrations",
        },
        namespace: "murph",
        tool: "submit_product_feedback",
      },
    });

    expect(request).toEqual({
      feedback: {
        kind: "feature_request",
        relatedChangelogItemIds: [],
        topic: "integrations",
      },
      kind: "submit-product-feedback",
    });
  });

  it("rejects malformed generalized feedback tool arguments", () => {
    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          kind: "feature_interest",
          topic: "changelog",
        },
        namespace: "murph",
        tool: "submit_product_feedback",
      },
    })?.kind).toBe("invalid-product-feedback-arguments");

    expect(readMurphDynamicToolRequest({
      method: "item/tool/call",
      params: {
        arguments: {
          feedbackTags: ["message-formatting"],
          kind: "feature_request",
          topic: "messaging",
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
          topic: "unknown-topic",
        },
        namespace: "murph",
        tool: "submit_product_feedback",
      },
    })?.kind).toBe("invalid-product-feedback-arguments");
  });
});
