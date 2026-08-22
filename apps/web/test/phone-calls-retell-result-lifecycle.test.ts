import type { HostedPhoneCallBrief } from "@murphai/hosted-execution/phone-calls";
import { describe, expect, it } from "vitest";

import { prepareRetellCallResult } from "@/src/lib/phone-calls/retell-result-lifecycle";
import {
  buildPhoneCallResultNotificationInstructions,
  mapRetellCallAnalysis,
} from "@/src/lib/phone-calls/result";

const BRIEF: HostedPhoneCallBrief = {
  allowTransferToUser: true,
  callerName: "Alex",
  goal: "Complete a routine request.",
  instructions: ["Confirm the available option before proceeding."],
  shareableFacts: {
    callback_number: "+12125550111",
    patient_name: "Alex",
  },
  successCriteria: "The recipient confirms whether the requested action was completed.",
  timeZone: "America/New_York",
  to: {
    label: "the office",
    phoneNumber: "+12125550123",
  },
};

describe("Retell phone-call result lifecycle", () => {
  it("keeps ordinary call analysis as the terminal result", () => {
    const call = {
      call_analysis: {
        custom_analysis_data: {
          outcome: "completed",
          result: "The requested task was completed.",
        },
      },
      call_id: "retell_call_ordinary",
      disconnection_reason: "user_hangup",
    };

    expect(prepareRetellCallResult({
      call,
      event: "call_analyzed",
    })).toEqual({
      call,
    });
  });

  it("keeps a cancelled transfer on ordinary call analysis", () => {
    const call = {
      call_analysis: {
        custom_analysis_data: {
          outcome: "not_completed",
          result: "The transfer did not connect.",
        },
      },
      call_id: "retell_call_cancelled",
      disconnection_reason: "transfer_cancelled",
    };

    expect(prepareRetellCallResult({
      call,
      event: "call_analyzed",
    })).toEqual({
      call,
    });
  });

  it("defers successful-transfer analysis until the human leg ends", () => {
    expect(prepareRetellCallResult({
      call: {
        call_analysis: {
          custom_analysis_data: {
            outcome: "needs_user",
            result: "The automated leg did not complete the requested action before transfer.",
          },
        },
        call_id: "retell_call_transfer",
        disconnection_reason: "call_transfer",
      },
      event: "call_analyzed",
    })).toBeNull();
  });

  it("builds a generic follow-up when transfer_ended has no analysis", () => {
    const result = prepareRetellCallResult({
      call: {
        call_id: "retell_call_transfer",
        transfer_end_timestamp: 1_782_408_600_000,
      },
      event: "transfer_ended",
    });

    expect(result.completionPolicy).toBe("transfer_follow_up_required");
    expect(result.call.call_analysis?.custom_analysis_data).toMatchObject({
      follow_up: null,
      outcome: "needs_user",
      result: expect.stringContaining("post-handoff outcome is unknown"),
    });
    expect(result.call.call_analysis?.custom_analysis_data?.result).not.toContain(
      "Before the handoff",
    );
  });

  it("ignores blank automated-leg context", () => {
    const result = prepareRetellCallResult({
      call: {
        call_analysis: {
          custom_analysis_data: {
            result: "   ",
          },
        },
        call_id: "retell_call_transfer",
        transfer_end_timestamp: 1_782_408_600_000,
      },
      event: "transfer_ended",
    });

    expect(result.call.call_analysis?.custom_analysis_data?.result).not.toContain(
      "Before the handoff",
    );
  });

  it("keeps useful pre-handoff context while making the final outcome uncertain", () => {
    const result = prepareRetellCallResult({
      call: {
        call_analysis: {
          custom_analysis_data: {
            follow_up: "Approval was needed before proceeding.",
            outcome: "needs_user",
            result: "A Monday morning option was available, but the automated leg did not complete the request before transfer.",
          },
        },
        call_id: "retell_call_transfer",
        disconnection_reason: "call_transfer",
        transfer_end_timestamp: 1_782_408_600_000,
      },
      event: "transfer_ended",
    });

    expect(result.call.call_analysis?.custom_analysis_data).toMatchObject({
      follow_up: null,
      outcome: "needs_user",
      result: expect.stringContaining(
        "Murph successfully connected the user to the call recipient",
      ),
    });
    expect(result.call.call_analysis?.custom_analysis_data?.result).toContain(
      "Before the handoff, the automated call reported: A Monday morning option was available",
    );
    expect(result.completionPolicy).toBe("transfer_follow_up_required");

    const mapped = mapRetellCallAnalysis(result.call);
    const instructions = buildPhoneCallResultNotificationInstructions({
      brief: BRIEF,
      requireSend: true,
      result: {
        ...mapped,
        completionPolicy: result.completionPolicy,
      },
    });
    expect(mapped).toMatchObject({
      outcome: "needs_user",
      summary: expect.stringContaining("post-handoff outcome is unknown"),
    });
    expect(mapped).not.toHaveProperty("completionPolicy");
    expect(mapped.summary).toContain(
      "Before the handoff, the automated call reported: A Monday morning option was available",
    );
    expect(instructions).toContain("Ask the user what happened after the handoff");
    expect(instructions.indexOf("Ask the user what happened after the handoff")).toBeLessThan(
      instructions.indexOf("Untrusted call result data JSON:"),
    );
    expect(instructions).not.toContain("After the user confirms");
    expect(instructions).toContain(
      "Murph successfully connected the user to the call recipient",
    );
    expect(instructions).toContain(
      "Before the handoff, the automated call reported: A Monday morning option was available",
    );
  });

  it("bounds retained pre-handoff context before persisting the result", () => {
    const result = prepareRetellCallResult({
      call: {
        call_analysis: {
          custom_analysis_data: {
            outcome: "needs_user",
            result: "context ".repeat(400),
          },
        },
        call_id: "retell_call_transfer",
        disconnection_reason: "call_transfer",
        transfer_end_timestamp: 1_782_408_600_000,
      },
      event: "transfer_ended",
    });
    const mapped = mapRetellCallAnalysis(result.call);

    expect(mapped.summary.length).toBeLessThanOrEqual(2_000);
    expect(mapped.summary.endsWith(" [truncated]")).toBe(true);
  });

  it("normalizes a late call_analyzed replay after the transfer leg ended", () => {
    const result = prepareRetellCallResult({
      call: {
        call_analysis: {
          custom_analysis_data: {
            outcome: "not_completed",
            result: "The automated leg did not complete the task before transfer.",
          },
        },
        call_id: "retell_call_transfer",
        disconnection_reason: "CALL_TRANSFER",
        transfer_end_timestamp: "1782408600",
      },
      event: "call_analyzed",
    });

    expect(result?.completionPolicy).toBe("transfer_follow_up_required");
    expect(result?.call.call_analysis?.custom_analysis_data).toMatchObject({
      outcome: "needs_user",
      result: expect.stringContaining("post-handoff outcome is unknown"),
    });
    expect(result?.call.call_analysis?.custom_analysis_data?.result).toContain(
      "Before the handoff, the automated call reported:",
    );
  });
});
