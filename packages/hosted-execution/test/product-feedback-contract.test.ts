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
      summary: "Interested in native message formatting.",
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
        summary: "Interested in native message formatting.",
      },
    })).toThrow();
    expect(() => parseHostedRuntimeProductFeedbackRecordRequest({
      feedback: {
        idempotencyKey: "a".repeat(64),
        kind: "bug_report",
        relatedChangelogItemIds: ["native-message-formatting"],
        summary: "Wants a bug-report workflow.",
      },
    })).toThrow();
    expect(() => parseHostedRuntimeProductFeedbackRecordRequest({
      feedback: {
        idempotencyKey: "a".repeat(64),
        kind: "feature_request",
        relatedChangelogItemIds: [],
      },
    })).toThrow();
    expect(() => parseHostedRuntimeProductFeedbackRecordRequest({
      feedback: {
        idempotencyKey: "a".repeat(64),
        kind: "feature_request",
        relatedChangelogItemIds: [],
        summary: "",
      },
    })).toThrow();
    expect(() => parseHostedRuntimeProductFeedbackRecordRequest({
      feedback: {
        idempotencyKey: "a".repeat(64),
        kind: "feature_request",
        relatedChangelogItemIds: [],
        summary: "x".repeat(501),
      },
    })).toThrow();
    expect(() => parseHostedRuntimeProductFeedbackRecordRequest({
      feedback: {
        feedbackTags: ["message-formatting"],
        idempotencyKey: "a".repeat(64),
        kind: "feature_request",
        relatedChangelogItemIds: [],
        summary: "Wants better message formatting.",
      },
    })).toThrow();
    expect(() => parseHostedRuntimeProductFeedbackRecordRequest({
      feedback: {
        idempotencyKey: "a".repeat(64),
        kind: "feature_request",
        relatedChangelogItemIds: [],
        summary: "Wants Strava integration support.",
        topic: "integrations",
      },
    })).toThrow();
    expect(() => parseHostedRuntimeProductFeedbackRecordRequest({
      feedback: {
        idempotencyKey: "a".repeat(64),
        kind: "feature_interest",
        relatedChangelogItemIds: [
          "native-message-formatting",
          "native-message-formatting",
        ],
        summary: "Interested in native message formatting.",
      },
    })).toThrow();
    expect(() => parseHostedRuntimeProductFeedbackRecordRequest({
      feedback: {
        idempotencyKey: "a".repeat(64),
        kind: "feature_interest",
        relatedChangelogItemIds: ["NativeMessageFormatting"],
        summary: "Interested in native message formatting.",
      },
    })).toThrow();
    expect(() => parseHostedRuntimeProductFeedbackRecordRequest({
      feedback: {
        idempotencyKey: "a".repeat(64),
        kind: "feature_interest",
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
        summary: "Interested in many changelog items.",
      },
    })).toThrow();
  });

  it("supports structured feature requests and frustrations", () => {
    expect(parseHostedRuntimeProductFeedbackRecordRequest({
      feedback: {
        idempotencyKey: "a".repeat(64),
        kind: "feature_interest",
        relatedChangelogItemIds: [],
        summary: "Interested in generated song reminders.",
      },
    })).toEqual({
      feedback: {
        idempotencyKey: "a".repeat(64),
        kind: "feature_interest",
        relatedChangelogItemIds: [],
        summary: "Interested in generated song reminders.",
      },
    });

    expect(parseHostedRuntimeProductFeedbackRecordRequest({
      feedback: {
        idempotencyKey: "b".repeat(64),
        kind: "feature_request",
        relatedChangelogItemIds: [],
        summary: "  Wants Strava   integration support.  ",
      },
    })).toEqual({
      feedback: {
        idempotencyKey: "b".repeat(64),
        kind: "feature_request",
        relatedChangelogItemIds: [],
        summary: "Wants Strava integration support.",
      },
    });

    expect(parseHostedRuntimeProductFeedbackRecordRequest({
      feedback: {
        idempotencyKey: "d".repeat(64),
        kind: "frustration",
        summary: "The dashboard feels slow.",
      },
    })).toEqual({
      feedback: {
        idempotencyKey: "d".repeat(64),
        kind: "frustration",
        relatedChangelogItemIds: [],
        summary: "The dashboard feels slow.",
      },
    });
  });

  it("redacts high-confidence sensitive tokens from summaries", () => {
    expect(parseHostedRuntimeProductFeedbackRecordRequest({
      feedback: {
        idempotencyKey: "e".repeat(64),
        kind: "feature_request",
        relatedChangelogItemIds: [],
        summary:
          "Reach me at user@example.com or 415-555-1212; token sk_test_abcdefghijklmnopqrstuvwxyz.",
      },
    })).toEqual({
      feedback: {
        idempotencyKey: "e".repeat(64),
        kind: "feature_request",
        relatedChangelogItemIds: [],
        summary:
          "Reach me at [redacted] or [redacted]; token [redacted].",
      },
    });
  });
});
