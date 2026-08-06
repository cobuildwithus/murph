import {
  readRetellTransferEndAt,
  type RetellCallPayload,
} from "./retell-payloads";

const RETELL_TRANSFER_DISCONNECTION_REASON = "call_transfer";
const TRANSFERRED_CALL_SUMMARY =
  "Murph successfully connected the user to the call recipient and then left the conversation. Murph cannot observe what the user and recipient agreed after the handoff, so the final post-handoff outcome is unknown.";
const TRANSFERRED_CALL_CONTEXT_PREFIX =
  " Before the handoff, the automated call reported: ";
const TRANSFERRED_CALL_FOLLOW_UP =
  "Ask the user what happened after the handoff and whether the call goal was completed. Do not claim it was or was not completed. After the user confirms the details, offer a relevant next step such as a reminder when useful.";

export type RetellResultWebhookEvent = "call_analyzed" | "transfer_ended";

/**
 * Returns the provider payload that may safely finalize Murph's call result.
 * A call_analyzed event for a successful transfer describes only the automated
 * leg, so it is deferred until Retell reports the end of the human leg.
 */
export function prepareRetellCallResult(input: {
  call: RetellCallPayload;
  event: "transfer_ended";
}): RetellCallPayload;
export function prepareRetellCallResult(input: {
  call: RetellCallPayload;
  event: "call_analyzed";
}): RetellCallPayload | null;
export function prepareRetellCallResult(input: {
  call: RetellCallPayload;
  event: RetellResultWebhookEvent;
}): RetellCallPayload | null {
  if (input.event === "call_analyzed") {
    if (!isRetellTransferredCall(input.call)) {
      return input.call;
    }
    if (!readRetellTransferEndAt(input.call)) {
      return null;
    }
  }

  return {
    ...input.call,
    call_analysis: {
      ...(input.call.call_analysis ?? {}),
      custom_analysis_data: {
        ...(input.call.call_analysis?.custom_analysis_data ?? {}),
        follow_up: TRANSFERRED_CALL_FOLLOW_UP,
        outcome: "needs_user",
        result: buildTransferredCallSummary(input.call),
      },
    },
  };
}

function buildTransferredCallSummary(call: RetellCallPayload): string {
  const preHandoffContext = readTransferredCallPreHandoffContext(call);
  return preHandoffContext
    ? `${TRANSFERRED_CALL_SUMMARY}${TRANSFERRED_CALL_CONTEXT_PREFIX}${preHandoffContext}`
    : TRANSFERRED_CALL_SUMMARY;
}

function readTransferredCallPreHandoffContext(
  call: RetellCallPayload,
): string | null {
  const value = call.call_analysis?.custom_analysis_data?.result;
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  if (!text) {
    return null;
  }
  return text;
}

function isRetellTransferredCall(call: RetellCallPayload): boolean {
  return call.disconnection_reason?.trim().toLowerCase()
    === RETELL_TRANSFER_DISCONNECTION_REASON;
}
