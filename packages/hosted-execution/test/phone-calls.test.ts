import { describe, expect, it } from "vitest";
import * as z from "@murphai/contracts/zod-runtime";

import {
  HOSTED_SCHEDULED_PHONE_CALL_REQUEST_KEY_PREFIX,
  hostedPhoneCallBriefSchema,
  hostedPhoneCallStartRequestSchema,
  hostedPhoneCallStartResponseSchema,
  isHostedScheduledPhoneCallRequestKey,
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
      groupRequester: {
        assistantInputId: "ain_22222222222222222222222222222222",
        senderHandle: "7770001",
        source: "telegram",
      },
      originSessionId: "session_phone_call",
      requestKey: "turn-123:tool-1",
    })).toMatchObject({
      groupRequester: {
        assistantInputId: "ain_22222222222222222222222222222222",
        senderHandle: "7770001",
        source: "telegram",
      },
      originSessionId: "session_phone_call",
      requestKey: "turn-123:tool-1",
    });
    expect(hostedPhoneCallStartRequestSchema.parse({
      brief: VALID_BRIEF,
      originSessionId: "session_direct_phone_call",
      requestKey: "turn-124:tool-1",
    })).not.toHaveProperty("groupRequester");
  });

  it("rejects malformed exact group requester evidence", () => {
    expect(() => hostedPhoneCallStartRequestSchema.parse({
      brief: VALID_BRIEF,
      groupRequester: {
        assistantInputId: "ain_not_exact",
        senderHandle: "7770001",
        source: "telegram",
      },
      originSessionId: "session_phone_call",
      requestKey: "turn-123:tool-1",
    })).toThrow();
  });

  it("keeps the legacy mailbox-evidence request additive during rollout", () => {
    expect(hostedPhoneCallStartRequestSchema.parse({
      brief: VALID_BRIEF,
      inboundMailboxItemIds: ["mailbox_group_1"],
      originSessionId: "session_phone_call",
      requestKey: "turn-legacy:tool-1",
    })).toMatchObject({
      inboundMailboxItemIds: ["mailbox_group_1"],
    });
  });

  it("keeps start responses bounded to transport lifecycle states", () => {
    expect(hostedPhoneCallStartResponseSchema.parse({
      phoneCallId: "hpc_123",
      status: "calling",
    }).status).toBe("calling");
  });

  it("recognizes only exact scheduled occurrence request keys", () => {
    expect(isHostedScheduledPhoneCallRequestKey(
      `${HOSTED_SCHEDULED_PHONE_CALL_REQUEST_KEY_PREFIX}${"a".repeat(64)}`,
    )).toBe(true);
    expect(isHostedScheduledPhoneCallRequestKey(
      `phone_call_${"a".repeat(64)}`,
    )).toBe(false);
    expect(isHostedScheduledPhoneCallRequestKey(
      `${HOSTED_SCHEDULED_PHONE_CALL_REQUEST_KEY_PREFIX}${"g".repeat(64)}`,
    )).toBe(false);
  });
});

// Murph must never dial emergency or crisis dispatch. There is no dedicated
// emergency policy owner in production: the E.164 shape already makes every
// two- and three-digit code unrepresentable. These tests are the guarantee.
// If the accepted phone-number format is ever widened, they fail here rather
// than letting an automated emergency dial through.
describe("hosted phone call emergency dialing", () => {
  const EMERGENCY_AND_CRISIS_CODES = [
    // Universal / GSM
    "08", "000", "112", "911", "999",
    // Europe
    "15", "17", "18", "113", "115", "117", "118", "144", "155",
    // Americas, including the US/Canada suicide-and-crisis line
    "988", "190", "191", "192", "193",
    // Asia-Pacific
    "100", "101", "102", "103", "104", "106", "108", "110", "119", "120",
    "111", "122", "123", "125", "133", "995", "996", "997", "998",
    // Africa / Middle East
    "114", "116", "121", "124", "127", "199",
  ];

  it("cannot represent any emergency or crisis short code", () => {
    for (const number of EMERGENCY_AND_CRISIS_CODES) {
      expect(hostedPhoneCallBriefSchema.safeParse({
        ...VALID_BRIEF,
        to: { phoneNumber: number },
      }).success).toBe(false);
    }
  });

  it("cannot represent a country-code-prefixed emergency code", () => {
    for (const number of ["+1911", "+44999", "+61000", "+1988", "+49112"]) {
      expect(hostedPhoneCallBriefSchema.safeParse({
        ...VALID_BRIEF,
        to: { phoneNumber: number },
      }).success).toBe(false);
    }
  });

  // The rejection must come from length, not from anything that could be
  // confused with a subscriber number. These stay dialable, including the
  // India mobile whose country code begins with an emergency code's digits.
  it("still accepts ordinary subscriber numbers", () => {
    for (const number of [
      "+12125550123",
      "+15550000001",
      "+442071838750",
      "+911234567890",
      "+19115550123",
      "+8613800138000",
    ]) {
      expect(hostedPhoneCallBriefSchema.safeParse({
        ...VALID_BRIEF,
        to: { phoneNumber: number },
      }).success).toBe(true);
    }
  });

  it("keeps the model-facing tool schema pattern for the dialed number", () => {
    const serialized = JSON.stringify(
      z.toJSONSchema(hostedPhoneCallBriefSchema, { io: "input" }),
    );
    expect(serialized).toContain("pattern");
    expect(serialized).toContain("[1-9]");
  });
});
