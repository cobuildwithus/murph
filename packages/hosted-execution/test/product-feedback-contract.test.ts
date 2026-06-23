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
      topic: "changelog",
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
        topic: "changelog",
      },
    })).toThrow();
    expect(() => parseHostedRuntimeProductFeedbackRecordRequest({
      feedback: {
        idempotencyKey: "a".repeat(64),
        kind: "bug_report",
        relatedChangelogItemIds: ["native-message-formatting"],
        topic: "integrations",
      },
    })).toThrow();
    expect(() => parseHostedRuntimeProductFeedbackRecordRequest({
      feedback: {
        idempotencyKey: "a".repeat(64),
        kind: "feature_request",
        relatedChangelogItemIds: [],
        topic: "unknown-topic",
      },
    })).toThrow();
    expect(() => parseHostedRuntimeProductFeedbackRecordRequest({
      feedback: {
        feedbackTags: ["message-formatting"],
        idempotencyKey: "a".repeat(64),
        kind: "feature_request",
        relatedChangelogItemIds: [],
        topic: "messaging",
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
        topic: "changelog",
      },
    })).toThrow();
    expect(() => parseHostedRuntimeProductFeedbackRecordRequest({
      feedback: {
        idempotencyKey: "a".repeat(64),
        kind: "feature_interest",
        relatedChangelogItemIds: ["NativeMessageFormatting"],
        topic: "changelog",
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
        topic: "changelog",
      },
    })).toThrow();
  });

  it("supports structured feature requests and old changelog-only payloads", () => {
    expect(parseHostedRuntimeProductFeedbackRecordRequest({
      feedback: {
        idempotencyKey: "b".repeat(64),
        kind: "feature_request",
        relatedChangelogItemIds: [],
        topic: "integrations",
      },
    })).toEqual({
      feedback: {
        idempotencyKey: "b".repeat(64),
        kind: "feature_request",
        relatedChangelogItemIds: [],
        topic: "integrations",
      },
    });

    expect(parseHostedRuntimeProductFeedbackRecordRequest({
      feedback: {
        idempotencyKey: "d".repeat(64),
        kind: "frustration",
        topic: "performance",
      },
    })).toEqual({
      feedback: {
        idempotencyKey: "d".repeat(64),
        kind: "frustration",
        relatedChangelogItemIds: [],
        topic: "performance",
      },
    });

    expect(parseHostedRuntimeProductFeedbackRecordRequest({
      feedback: {
        idempotencyKey: "c".repeat(64),
        kind: "feature_interest",
        relatedChangelogItemIds: ["native-message-formatting"],
      },
    })).toEqual({
      feedback: {
        idempotencyKey: "c".repeat(64),
        kind: "feature_interest",
        relatedChangelogItemIds: ["native-message-formatting"],
        topic: "changelog",
      },
    });
  });
});
