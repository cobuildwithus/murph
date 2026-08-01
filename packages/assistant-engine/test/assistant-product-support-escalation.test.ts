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
});
