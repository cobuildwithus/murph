import { describe, expect, it } from "vitest";

import {
  hostedPhoneCallBriefSchema,
  hostedPhoneCallStartRequestSchema,
  hostedPhoneCallStartResponseSchema,
} from "../src/phone-calls.js";

const VALID_BRIEF = {
  to: {
    phoneNumber: "+12125550123",
    label: "Eye doctor's office",
  },
  timeZone: "America/New_York",
  goal: "Schedule a routine eye examination for Friday, June 26, 2026.",
  shareableFacts: {
    patient_name: "Alex",
    callback_number: "+12125550111",
  },
  instructions: [
    "Only accept an appointment on Friday, June 26, 2026.",
    "Ask Murph before accepting a fee or a different date.",
  ],
  successCriteria: "The office confirms the exact appointment time and location.",
  allowTransferToUser: true,
};

describe("hosted phone call contracts", () => {
  it("parses the compact call brief primitive", () => {
    expect(hostedPhoneCallBriefSchema.parse(VALID_BRIEF)).toEqual(VALID_BRIEF);
  });

  it("defaults optional disclosure containers without broadening authority", () => {
    const parsed = hostedPhoneCallBriefSchema.parse({
      to: {
        phoneNumber: "+12125550123",
      },
      timeZone: "America/New_York",
      goal: "Ask whether appointments are available on Friday, June 26, 2026.",
      successCriteria: "The office gives availability for the requested day.",
    });

    expect(parsed.allowTransferToUser).toBe(true);
    expect(parsed.instructions).toEqual([]);
    expect(parsed.shareableFacts).toEqual({});
  });

  it("rejects non-E164 destination numbers", () => {
    expect(() => hostedPhoneCallBriefSchema.parse({
      ...VALID_BRIEF,
      to: {
        phoneNumber: "212-555-0123",
      },
    })).toThrow();
  });

  it("parses the server-owned start request", () => {
    expect(hostedPhoneCallStartRequestSchema.parse({
      brief: VALID_BRIEF,
      requestKey: "turn-123:tool-1",
    }).requestKey).toBe("turn-123:tool-1");
  });

  it("keeps start responses bounded to transport lifecycle states", () => {
    expect(hostedPhoneCallStartResponseSchema.parse({
      phoneCallId: "hpc_123",
      status: "calling",
    }).status).toBe("calling");
  });
});
