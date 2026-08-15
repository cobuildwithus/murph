import { describe, expect, it } from "vitest";

import {
  hostedPhoneCallStartRequestSchema,
  parseHostedPhoneCallResultNotificationChannel,
} from "../src/phone-calls.js";

const VALID_BRIEF = {
  allowTransferToUser: false,
  goal: "Confirm the reservation.",
  instructions: [],
  shareableFacts: {},
  successCriteria: "The reservation status is known.",
  timeZone: "America/New_York",
  to: {
    phoneNumber: "+14045550123",
  },
};

describe("hosted phone-call result notification channels", () => {
  it.each(["linq", "telegram"] as const)(
    "accepts the bounded %s direct result channel",
    (resultNotificationChannel) => {
      expect(hostedPhoneCallStartRequestSchema.parse({
        brief: VALID_BRIEF,
        originSessionId: "session_phone_call",
        requestKey: "phone_call_request",
        resultNotificationChannel,
      }).resultNotificationChannel).toBe(resultNotificationChannel);
    },
  );

  it("rejects unsupported result channels", () => {
    expect(() => hostedPhoneCallStartRequestSchema.parse({
      brief: VALID_BRIEF,
      originSessionId: "session_phone_call",
      requestKey: "phone_call_request",
      resultNotificationChannel: "email",
    })).toThrow();
  });

  it("keeps legacy calls without a stored channel compatible", () => {
    expect(parseHostedPhoneCallResultNotificationChannel(null)).toBeNull();
    expect(parseHostedPhoneCallResultNotificationChannel(undefined)).toBeNull();
  });
});
