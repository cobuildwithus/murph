import { describe, expect, it } from "vitest";

import {
  parseHostedRuntimeProductFeedbackRecordRequest,
  parseHostedRuntimeProductFeedbackRecordResponse,
} from "../src/parsers.js";

describe("hosted product feedback contracts", () => {
  it("parses the bounded record contract", () => {
    const feedback = {
      idempotencyKey: "a".repeat(64),
      kind: "feature_interest",
      relatedChangelogItemIds: ["native-message-formatting"],
    };
    expect(parseHostedRuntimeProductFeedbackRecordRequest({ feedback })).toEqual({
      feedback,
    });
    expect(parseHostedRuntimeProductFeedbackRecordResponse({
      feedbackId: "product_feedback_123",
      recorded: true,
    })).toEqual({
      feedbackId: "product_feedback_123",
      recorded: true,
    });
  });

  it("rejects unbounded or malformed feedback", () => {
    expect(() => parseHostedRuntimeProductFeedbackRecordRequest({
      feedback: {
        idempotencyKey: "not-a-digest",
        kind: "feature_interest",
        relatedChangelogItemIds: ["native-message-formatting"],
      },
    })).toThrow();
    expect(() => parseHostedRuntimeProductFeedbackRecordRequest({
      feedback: {
        idempotencyKey: "a".repeat(64),
        kind: "feature_interest",
        relatedChangelogItemIds: [],
      },
    })).toThrow();
    expect(() => parseHostedRuntimeProductFeedbackRecordRequest({
      feedback: {
        idempotencyKey: "a".repeat(64),
        kind: "feature_request",
        relatedChangelogItemIds: ["native-message-formatting"],
      },
    })).toThrow();
  });
});
