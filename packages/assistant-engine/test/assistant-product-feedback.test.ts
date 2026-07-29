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

  it("reads the latest checkpointed input authority when recording", async () => {
    let acceptedInputIds = ["assistant_input_1"];
    const recordProductFeedback = vi.fn(async () => ({
      feedbackId: "product_feedback_steered",
      recorded: true,
    }));
    const recorder = createAssistantProductFeedbackRecorder({
      acceptedInputItems: [{ id: "assistant_input_1", source: "assistant-input" }],
      getAcceptedInputIds: () => acceptedInputIds,
      productFeedbackRecorder: { recordProductFeedback },
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

    expect(recordProductFeedback).toHaveBeenCalledWith({
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
    expect(description).toContain("one structured Murph product-feedback item");
    expect(description).toContain("current accepted request");
    expect(description).toContain("optional related changelog item ids");
    expect(description).toContain("recorded, already recorded, unavailable, or failed");
    expect(description).toContain("do not retry after any result");
    expect(schema).toContain('"minItems":0');
    expect(schema).toContain('"feature_interest"');
    expect(schema).toContain('"summary"');
    expect(schema).toContain('Use feature_request for a missing or unsupported Murph path');
    expect(schema).toContain('desired outcome and missing Murph capability');
    expect(schema).toContain('Optional metadata');
    expect(schema).toContain('Speculative:');
    expect(schema).toContain('Murph-observed:');
    expect(schema).not.toContain('"topic"');
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

    expect(recordProductFeedback).toHaveBeenCalledWith({
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
      contentItems: [{ type: "inputText", text: "product feedback recorded" }],
    });
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
