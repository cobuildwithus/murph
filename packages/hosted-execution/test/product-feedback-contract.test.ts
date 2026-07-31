import { describe, expect, it } from "vitest";

import {
  parseHostedRuntimeProductFeedbackRecordRequest,
  parseHostedRuntimeProductFeedbackRecordResponse,
} from "../src/parsers.js";

const feedback = {
  action: "view",
  idempotencyKey: "a".repeat(64),
  kind: "feature_interest",
  outcome: "interest",
  productArea: "messaging",
  relatedChangelogItemIds: ["native-message-formatting"],
} as const;

describe("hosted product feedback contracts", () => {
  it("parses the closed product abstraction", () => {
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

  it.each([
    ["invalid digest", { ...feedback, idempotencyKey: "not-a-digest" }],
    ["invalid kind", { ...feedback, kind: "bug_report" }],
    ["invalid area", { ...feedback, productArea: "private_health_context" }],
    ["invalid action", { ...feedback, action: "quoted_user_request" }],
    ["invalid outcome", { ...feedback, outcome: "named_person_failed" }],
    ["missing area", {
      action: feedback.action,
      idempotencyKey: feedback.idempotencyKey,
      kind: feedback.kind,
      outcome: feedback.outcome,
      relatedChangelogItemIds: [],
    }],
    ["extra prose", { ...feedback, summary: "A private free-text summary." }],
    ["extra topic", { ...feedback, topic: "private-topic" }],
    ["duplicate changelog id", {
      ...feedback,
      relatedChangelogItemIds: [
        "native-message-formatting",
        "native-message-formatting",
      ],
    }],
    ["malformed changelog id", {
      ...feedback,
      relatedChangelogItemIds: ["NativeMessageFormatting"],
    }],
    ["too many changelog ids", {
      ...feedback,
      relatedChangelogItemIds: [
        "one",
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
        "eight",
      ],
    }],
  ])("rejects %s", (_label, candidate) => {
    expect(() => parseHostedRuntimeProductFeedbackRecordRequest({
      feedback: candidate,
    })).toThrow();
  });

  it("defaults optional changelog metadata without admitting prose", () => {
    expect(parseHostedRuntimeProductFeedbackRecordRequest({
      feedback: {
        action: "configure",
        idempotencyKey: "b".repeat(64),
        kind: "feature_request",
        outcome: "capability_missing",
        productArea: "experiments_and_challenges",
      },
    })).toEqual({
      feedback: {
        action: "configure",
        idempotencyKey: "b".repeat(64),
        kind: "feature_request",
        outcome: "capability_missing",
        productArea: "experiments_and_challenges",
        relatedChangelogItemIds: [],
      },
    });
  });
});
