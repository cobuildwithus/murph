import { describe, expect, it } from "vitest";

import type { HostedAssistantDeliveryOutcome } from "@murphai/assistant-runtime/hosted-runtime-contracts";

import { summarizeHostedAssistantDeliveryOutcomes } from "../src/user-runner/runner-dispatch-processor.ts";

describe("runner dispatch processor delivery summaries", () => {
  it("includes the first non-sent delivery message in the finalize summary", () => {
    const summary = summarizeHostedAssistantDeliveryOutcomes([
      {
        deliveryChannel: "linq",
        deliveryErrorCode: "LINQ_API_REQUEST_FAILED",
        deliveryErrorMessage: "Linq request POST /chats/stale/messages failed with HTTP 404. Chat not found",
        deliveryStatus: "failed",
        effectFingerprint: "dedupe-1",
        effectId: "outbox-1",
        journalMethod: "DELETE",
        journalStatus: null,
        providerMessageId: null,
        providerThreadId: null,
        retryable: false,
        target: null,
        targetKind: null,
      } satisfies HostedAssistantDeliveryOutcome,
    ]);

    expect(summary).toEqual({
      assistantDeliveryOutcomeCount: 1,
      assistantDeliverySentCount: 0,
      assistantDeliveryNonSentCount: 1,
      assistantDeliveryFirstNonSentChannel: "linq",
      assistantDeliveryFirstNonSentCode: "LINQ_API_REQUEST_FAILED",
      assistantDeliveryFirstNonSentMessage:
        "Linq request POST /chats/stale/messages failed with HTTP 404. Chat not found",
      assistantDeliveryFirstNonSentJournalMethod: "DELETE",
      assistantDeliveryFirstNonSentJournalStatus: "unknown",
      assistantDeliveryFirstNonSentStatus: "failed",
    });
  });
});
