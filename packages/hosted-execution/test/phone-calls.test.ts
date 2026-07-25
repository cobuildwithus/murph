import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  hostedPhoneCallBriefSchema,
  hostedPhoneCallStartRequestSchema,
  hostedPhoneCallStartResponseSchema,
  isHostedPhoneCallEmergencyNumber,
} from "../src/phone-calls.js";

const VALID_BRIEF = {
  to: {
    phoneNumber: "+12125550123",
    label: "Eye doctor's office",
  },
  callerName: "Alex",
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

  it("defaults optional disclosure and transfer authority without broadening authority", () => {
    const parsed = hostedPhoneCallBriefSchema.parse({
      to: {
        phoneNumber: "+12125550123",
      },
      timeZone: "America/New_York",
      goal: "Ask whether appointments are available on Friday, June 26, 2026.",
      successCriteria: "The office gives availability for the requested day.",
    });

    expect(parsed.allowTransferToUser).toBe(false);
    expect(parsed.callerName).toBeUndefined();
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
      inboundMailboxItemIds: ["mailbox_group_1", "mailbox_group_2"],
      originSessionId: "session_phone_call",
      requestKey: "turn-123:tool-1",
    })).toMatchObject({
      inboundMailboxItemIds: ["mailbox_group_1", "mailbox_group_2"],
      originSessionId: "session_phone_call",
      requestKey: "turn-123:tool-1",
    });
    expect(hostedPhoneCallStartRequestSchema.parse({
      brief: VALID_BRIEF,
      originSessionId: "session_direct_phone_call",
      requestKey: "turn-124:tool-1",
    })).not.toHaveProperty("inboundMailboxItemIds");
  });

  it("keeps start responses bounded to transport lifecycle states", () => {
    expect(hostedPhoneCallStartResponseSchema.parse({
      phoneCallId: "hpc_123",
      status: "calling",
    }).status).toBe("calling");
  });
});

describe("hosted phone call emergency dialing block", () => {
  it("blocks bare emergency and crisis short codes", () => {
    for (const number of ["911", "112", "999", "000", "988", "110", "119"]) {
      expect(isHostedPhoneCallEmergencyNumber(number)).toBe(true);
    }
  });

  it("blocks emergency codes that hide behind a country calling code", () => {
    for (const number of ["+1911", "+44999", "+61000", "+1988", "+49112"]) {
      expect(isHostedPhoneCallEmergencyNumber(number)).toBe(true);
    }
  });

  it("blocks emergency codes written with separators", () => {
    for (const number of ["9-1-1", "(911)", "+1 (911)", "9 1 1"]) {
      expect(isHostedPhoneCallEmergencyNumber(number)).toBe(true);
    }
  });

  // The country-code branch must never swallow a real subscriber number. The
  // India cases matter most: +91 is a country code whose digits begin an
  // emergency code, and +1 numbers in the 911 area are ordinary NANP numbers.
  it("leaves ordinary subscriber numbers dialable", () => {
    for (const number of [
      "+12125550123",
      "+15550000001",
      "+442071838750",
      "+911234567890",
      "+19115550123",
      "+8613800138000",
    ]) {
      expect(isHostedPhoneCallEmergencyNumber(number)).toBe(false);
    }
  });

  it("refuses to parse a brief that targets an emergency number", () => {
    expect(() => hostedPhoneCallBriefSchema.parse({
      ...VALID_BRIEF,
      to: { phoneNumber: "+1911" },
    })).toThrow();
  });

  // The emergency rule is layered after the E.164 regex specifically so the
  // generated tool schema still carries `pattern`. A refinement alone would
  // silently strip it and leave the model without the format hint.
  it("keeps the model-facing tool schema pattern for the dialed number", () => {
    const serialized = JSON.stringify(
      z.toJSONSchema(hostedPhoneCallBriefSchema, { io: "input" }),
    );
    expect(serialized).toContain("pattern");
    expect(serialized).toContain("[1-9]");
  });
});
