import { describe, expect, it, vi } from "vitest";

import {
  buildAssistantProductFeedbackIdempotencyKey,
  createAssistantProductFeedbackRecorder,
} from "../src/assistant/turn-progress.js";

describe("assistant product support escalation", () => {
  it("replaces only an unpersisted ordinary candidate when explicit escalation arrives", async () => {
    let acceptedInputIds = ["assistant_input_1"];
    const recorder = createAssistantProductFeedbackRecorder({
      acceptedInputItems: [
        { id: "assistant_input_1", source: "assistant-input" },
      ],
      getAcceptedInputIds: () => acceptedInputIds,
      productFeedbackCandidateSink: {
        acceptProductFeedbackCandidate: vi.fn(),
      },
    });
    if (!recorder) {
      throw new Error("Expected a turn-scoped product feedback recorder.");
    }

    await expect(recorder.recordProductFeedback({
      kind: "frustration",
      relatedChangelogItemIds: [],
      summary: "A connected-source flow did not complete.",
    })).resolves.toEqual({ recorded: true });

    acceptedInputIds = ["assistant_input_1", "assistant_input_2"];
    const supportFeedback = {
      kind: "frustration" as const,
      relatedChangelogItemIds: [],
      summary:
        "Support escalation: a connected source reports success but Murph does not finish the connection.",
    };
    await expect(
      recorder.recordProductFeedback(supportFeedback),
    ).resolves.toEqual({ recorded: true });

    expect(recorder.readProductFeedback()).toEqual({
      ...supportFeedback,
      idempotencyKey: buildAssistantProductFeedbackIdempotencyKey({
        acceptedInputIds,
        feedback: supportFeedback,
      }),
    });
  });

  it("keeps an existing explicit escalation first-write-wins", async () => {
    const recorder = createAssistantProductFeedbackRecorder({
      acceptedInputItems: [
        { id: "assistant_input_1", source: "assistant-input" },
      ],
      productFeedbackCandidateSink: {
        acceptProductFeedbackCandidate: vi.fn(),
      },
    });
    if (!recorder) {
      throw new Error("Expected a turn-scoped product feedback recorder.");
    }
    const first = {
      kind: "frustration" as const,
      relatedChangelogItemIds: [],
      summary: "Support escalation: the device connection did not finish.",
    };

    await expect(recorder.recordProductFeedback(first)).resolves.toEqual({
      recorded: true,
    });
    await expect(recorder.recordProductFeedback({
      ...first,
      summary: "Support escalation: a later rewrite must not replace it.",
    })).resolves.toEqual({ recorded: false });

    expect(recorder.readProductFeedback()?.summary).toBe(first.summary);
  });

  it("delivers an explicit escalation durably inside the turn when the sink supports it", async () => {
    const deliverProductSupportEscalation = vi
      .fn()
      .mockResolvedValue({ recorded: true });
    const acceptProductFeedbackCandidate = vi.fn();
    const recorder = createAssistantProductFeedbackRecorder({
      acceptedInputItems: [
        { id: "assistant_input_1", source: "assistant-input" },
      ],
      productFeedbackCandidateSink: {
        acceptProductFeedbackCandidate,
        deliverProductSupportEscalation,
      },
    });
    if (!recorder) {
      throw new Error("Expected a turn-scoped product feedback recorder.");
    }
    const supportFeedback = {
      kind: "frustration" as const,
      relatedChangelogItemIds: [],
      summary: "Support escalation: the device connection did not finish.",
    };

    await expect(recorder.recordProductFeedback(supportFeedback)).resolves.toEqual({
      recorded: true,
    });

    expect(deliverProductSupportEscalation).toHaveBeenCalledExactlyOnceWith({
      ...supportFeedback,
      idempotencyKey: buildAssistantProductFeedbackIdempotencyKey({
        acceptedInputIds: ["assistant_input_1"],
        feedback: supportFeedback,
      }),
    });
    expect(acceptProductFeedbackCandidate).not.toHaveBeenCalled();
    expect(recorder.readProductFeedback()).toBeNull();

    await expect(recorder.recordProductFeedback(supportFeedback)).resolves.toEqual({
      recorded: false,
    });
    expect(deliverProductSupportEscalation).toHaveBeenCalledOnce();
  });

  it("supersedes an unpersisted ordinary candidate when the escalation is delivered durably", async () => {
    const deliverProductSupportEscalation = vi
      .fn()
      .mockResolvedValue({ recorded: true });
    const recorder = createAssistantProductFeedbackRecorder({
      acceptedInputItems: [
        { id: "assistant_input_1", source: "assistant-input" },
      ],
      productFeedbackCandidateSink: {
        acceptProductFeedbackCandidate: vi.fn(),
        deliverProductSupportEscalation,
      },
    });
    if (!recorder) {
      throw new Error("Expected a turn-scoped product feedback recorder.");
    }

    await expect(recorder.recordProductFeedback({
      kind: "frustration",
      relatedChangelogItemIds: [],
      summary: "A connected-source flow did not complete.",
    })).resolves.toEqual({ recorded: true });
    await expect(recorder.recordProductFeedback({
      kind: "frustration",
      relatedChangelogItemIds: [],
      summary: "Support escalation: the connected-source flow does not complete.",
    })).resolves.toEqual({ recorded: true });

    expect(deliverProductSupportEscalation).toHaveBeenCalledOnce();
    expect(recorder.readProductFeedback()).toBeNull();
  });

  it("propagates durable escalation delivery failure so the tool reports it", async () => {
    const deliverProductSupportEscalation = vi
      .fn()
      .mockRejectedValue(new Error("callback timed out"));
    const recorder = createAssistantProductFeedbackRecorder({
      acceptedInputItems: [
        { id: "assistant_input_1", source: "assistant-input" },
      ],
      productFeedbackCandidateSink: {
        acceptProductFeedbackCandidate: vi.fn(),
        deliverProductSupportEscalation,
      },
    });
    if (!recorder) {
      throw new Error("Expected a turn-scoped product feedback recorder.");
    }

    await expect(recorder.recordProductFeedback({
      kind: "frustration",
      relatedChangelogItemIds: [],
      summary: "Support escalation: the device connection did not finish.",
    })).rejects.toThrow("callback timed out");

    expect(recorder.readProductFeedback()).toBeNull();
  });
});
