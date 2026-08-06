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
    })).toBe(call);
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
    })).toBe(call);
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

  it("turns the completed human leg into an uncertainty-aware follow-up", () => {
    const result = prepareRetellCallResult({
      call: {
        call_analysis: {
          custom_analysis_data: {
            follow_up: "Approval was needed before proceeding.",
            outcome: "needs_user",
            result: "The automated leg did not complete the requested action before transfer.",
          },
        },
        call_id: "retell_call_transfer",
        disconnection_reason: "call_transfer",
        transfer_end_timestamp: 1_782_408_600_000,
      },
      event: "transfer_ended",
    });

    expect(result.call_analysis?.custom_analysis_data).toMatchObject({
      follow_up: expect.stringContaining("Ask the user what happened after the handoff"),
      outcome: "needs_user",
      result: expect.stringContaining(
        "Murph successfully connected the user to the call recipient",
      ),
    });
    expect(result.call_analysis?.custom_analysis_data?.result).not.toContain(
      "did not complete the requested action",
    );
    expect(result.call_analysis?.custom_analysis_data?.follow_up).not.toContain(
      "Approval was needed before proceeding",
    );

    const mapped = mapRetellCallAnalysis(result);
    const instructions = buildPhoneCallResultNotificationInstructions({
      brief: BRIEF,
      result: mapped,
    });
    expect(mapped).toMatchObject({
      outcome: "needs_user",
      summary: expect.stringContaining("post-handoff outcome is unknown"),
    });
    expect(instructions).toContain("Ask the user what happened after the handoff");
    expect(instructions).toContain(
      "Murph successfully connected the user to the call recipient",
    );
    expect(instructions).not.toContain("did not complete the requested action");
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

    expect(result?.call_analysis?.custom_analysis_data).toMatchObject({
      outcome: "needs_user",
      result: expect.stringContaining("post-handoff outcome is unknown"),
    });
  });
});
