import { describe, expect, it } from "vitest";

import {
  HOSTED_PRODUCT_FEEDBACK_SUMMARY_MAX_LENGTH,
  isHostedProductSupportEscalationSummary,
} from "../src/runtime-control.js";
import {
  parseHostedRuntimeProductFeedbackRecordRequest,
  parseHostedRuntimeProductFeedbackRecordResponse,
} from "../src/parsers.js";

describe("hosted product feedback contracts", () => {
  it("requires a written issue after the reserved support prefix", () => {
    expect(isHostedProductSupportEscalationSummary(
      "Support escalation: a connected source reports success but Murph does not finish the connection.",
    )).toBe(true);
    expect(isHostedProductSupportEscalationSummary(
      "Support escalation:",
    )).toBe(false);
    expect(isHostedProductSupportEscalationSummary(
      "Support escalation:   ",
    )).toBe(false);
    expect(isHostedProductSupportEscalationSummary(
      "A connected source reports success but Murph does not finish the connection.",
    )).toBe(false);
  });

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
    const maxLengthFeedback = {
      ...feedback,
      idempotencyKey: "b".repeat(64),
      summary: "x".repeat(HOSTED_PRODUCT_FEEDBACK_SUMMARY_MAX_LENGTH),
    };
    expect(parseHostedRuntimeProductFeedbackRecordRequest({
      feedback: maxLengthFeedback,
    })).toEqual({
      feedback: maxLengthFeedback,
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
        summary: "x".repeat(HOSTED_PRODUCT_FEEDBACK_SUMMARY_MAX_LENGTH + 1),
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

  it("preserves a labeled reproduction section while normalizing whitespace", () => {
    const parsed = parseHostedRuntimeProductFeedbackRecordRequest({
      feedback: {
        idempotencyKey: "c".repeat(64),
        kind: "frustration",
        relatedChangelogItemIds: [],
        summary:
          "A generic workflow returns an incomplete result.\n\nReproduction: Use synthetic records with repeated entries, run the relevant read command, and ask Murph to summarize them. Expected: every entry is included. Observed: one entry is omitted.",
      },
    });

    expect(parsed.feedback.summary).toBe(
      "A generic workflow returns an incomplete result. Reproduction: Use synthetic records with repeated entries, run the relevant read command, and ask Murph to summarize them. Expected: every entry is included. Observed: one entry is omitted.",
    );
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

  it("redacts compound blood-pressure readings without leaving either component", () => {
    for (const reading of ["120/80 mmHg", "120 / 80 mmHg"]) {
      const parsed = parseHostedRuntimeProductFeedbackRecordRequest({
        feedback: {
          idempotencyKey: "e".repeat(64),
          kind: "frustration",
          relatedChangelogItemIds: [],
          summary: `Blood pressure was ${reading} and the cuff sync failed.`,
        },
      });
      expect(parsed.feedback.summary).toBe(
        "Blood pressure was [redacted] and the cuff sync failed.",
      );
      expect(parsed.feedback.summary).not.toContain("120");
      expect(parsed.feedback.summary).not.toContain("80");
    }
  });
});
