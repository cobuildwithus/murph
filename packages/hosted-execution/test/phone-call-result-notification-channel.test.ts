import { describe, expect, it } from "vitest";

import {
  buildHostedPhoneCallResultDeliveryKey,
  hostedPhoneCallResultSchema,
  hostedPhoneCallStartRequestSchema,
  isHostedPhoneCallResultPreProviderRouteFailureCode,
  parseHostedPhoneCallResultDeliveryKey,
  parseHostedPhoneCallResultDeliveryOutcomeRequest,
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

  it("keeps the transfer follow-up policy bounded and legacy-compatible", () => {
    expect(hostedPhoneCallResultSchema.parse({
      outcome: "needs_user",
      summary: "The human conversation ended after Murph completed the handoff.",
    })).not.toHaveProperty("completionPolicy");
    expect(hostedPhoneCallResultSchema.parse({
      completionPolicy: "transfer_follow_up_required",
      outcome: "needs_user",
      summary: "The human conversation ended after Murph completed the handoff.",
    }).completionPolicy).toBe("transfer_follow_up_required");
    expect(() => hostedPhoneCallResultSchema.parse({
      completionPolicy: "provider_decides",
      outcome: "needs_user",
      summary: "The human conversation ended after Murph completed the handoff.",
    })).toThrow();
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

  it("requires exact Telegram route authority at provider entry", () => {
    expect(parseHostedPhoneCallResultDeliveryOutcomeRequest({
      generation: 3,
      phoneCallId: "hpc_result_delivery",
      routeAuthority: {
        channel: "telegram",
        containerMemberId: "member_result_delivery",
        threadId: "telegram_result_delivery",
      },
      status: "sending",
    })).toMatchObject({
      routeAuthority: {
        channel: "telegram",
        containerMemberId: "member_result_delivery",
        threadId: "telegram_result_delivery",
      },
      status: "sending",
    });
    expect(() => parseHostedPhoneCallResultDeliveryOutcomeRequest({
      generation: 3,
      phoneCallId: "hpc_result_delivery",
      status: "sending",
    })).toThrow();
  });

  it("keeps terminal delivery outcomes independent of route authority", () => {
    expect(parseHostedPhoneCallResultDeliveryOutcomeRequest({
      generation: 3,
      phoneCallId: "hpc_result_delivery",
      status: "sent",
    }).status).toBe("sent");
    expect(() => parseHostedPhoneCallResultDeliveryOutcomeRequest({
      generation: 3,
      phoneCallId: "hpc_result_delivery",
      routeAuthority: {
        channel: "telegram",
        containerMemberId: "member_result_delivery",
        threadId: "telegram_result_delivery",
      },
      status: "sent",
    })).toThrow();
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
