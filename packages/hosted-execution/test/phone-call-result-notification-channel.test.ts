import { describe, expect, it } from "vitest";

import {
  buildHostedPhoneCallResultDeliveryKey,
  hostedPhoneCallStartRequestSchema,
  isHostedPhoneCallResultPreProviderRouteFailureCode,
  parseHostedPhoneCallResultDeliveryKey,
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
  it("accepts the bounded Telegram direct result channel", () => {
    expect(hostedPhoneCallStartRequestSchema.parse({
      brief: VALID_BRIEF,
      originSessionId: "session_phone_call",
      requestKey: "phone_call_request",
      resultNotificationChannel: "telegram",
    }).resultNotificationChannel).toBe("telegram");
  });

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

  it("round-trips only generation-scoped delivery keys", () => {
    const key = buildHostedPhoneCallResultDeliveryKey({
      generation: 3,
      phoneCallId: "hpc_result_delivery",
    });

    expect(key).toBe(
      "phone-call-result:hpc_result_delivery:generation:3",
    );
    expect(parseHostedPhoneCallResultDeliveryKey(key)).toEqual({
      generation: 3,
      phoneCallId: "hpc_result_delivery",
    });
    expect(parseHostedPhoneCallResultDeliveryKey(
      "phone-call-result:hpc_result_delivery",
    )).toBeNull();
    expect(parseHostedPhoneCallResultDeliveryKey(
      "phone-call-result:hpc_result_delivery:generation:0",
    )).toBeNull();
  });

  it("classifies only exact pre-provider route-loss codes", () => {
    expect(isHostedPhoneCallResultPreProviderRouteFailureCode(
      "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
    )).toBe(true);
    expect(isHostedPhoneCallResultPreProviderRouteFailureCode(
      "ASSISTANT_EXTERNAL_THREAD_ROUTE_AUTHORITY_STALE",
    )).toBe(true);
    expect(isHostedPhoneCallResultPreProviderRouteFailureCode(
      "ASSISTANT_DELIVERY_AMBIGUOUS",
    )).toBe(false);
    expect(isHostedPhoneCallResultPreProviderRouteFailureCode(null)).toBe(false);
  });
});
