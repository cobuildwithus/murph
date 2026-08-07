import { describe, expect, it } from "vitest";

import {
  parseHostedRuntimeGroupToolRequest,
  parseHostedRuntimeGroupToolResponse,
} from "../src/parsers/runtime-control.js";

const MESSAGE_REF = `ain_${"a".repeat(32)}`;
const SIGNUP_URL =
  "https://www.withmurph.ai/r/murph_signup_referral_v1.signed-token";

describe("signup referral group-tool parsing", () => {
  it("accepts direct and provider-authenticated group requests", () => {
    expect(parseHostedRuntimeGroupToolRequest({
      action: "create_signup_referral_link",
    })).toEqual({
      action: "create_signup_referral_link",
    });

    expect(parseHostedRuntimeGroupToolRequest({
      action: "create_signup_referral_link",
      participant: {
        assistantInputId: MESSAGE_REF,
        senderHandle: "+14045550100",
        source: "linq",
      },
    })).toEqual({
      action: "create_signup_referral_link",
      participant: {
        assistantInputId: MESSAGE_REF,
        senderHandle: "+14045550100",
        source: "linq",
      },
    });
  });

  it("rejects model-supplied member attribution", () => {
    expect(() => parseHostedRuntimeGroupToolRequest({
      action: "create_signup_referral_link",
      referrerMemberId: "member_guessed",
    })).toThrow(/not allowed/u);
  });

  it("parses success and unavailable responses", () => {
    expect(parseHostedRuntimeGroupToolResponse({
      action: "create_signup_referral_link",
      result: {
        expiresAt: "2026-08-06T22:30:00.000Z",
        signupUrl: SIGNUP_URL,
        status: "ok",
      },
    })).toEqual({
      action: "create_signup_referral_link",
      result: {
        expiresAt: "2026-08-06T22:30:00.000Z",
        signupUrl: SIGNUP_URL,
        status: "ok",
      },
    });

    expect(parseHostedRuntimeGroupToolResponse({
      action: "create_signup_referral_link",
      result: {
        status: "unavailable",
        unavailableReason: "requesting_participant_required",
      },
    })).toEqual({
      action: "create_signup_referral_link",
      result: {
        status: "unavailable",
        unavailableReason: "requesting_participant_required",
      },
    });
  });

  it("rejects unsupported response statuses", () => {
    expect(() => parseHostedRuntimeGroupToolResponse({
      action: "create_signup_referral_link",
      result: { status: "pending" },
    })).toThrow();
  });

  it("rejects noncanonical expiry evidence", () => {
    expect(() => parseHostedRuntimeGroupToolResponse({
      action: "create_signup_referral_link",
      result: {
        expiresAt: "tomorrow",
        signupUrl: SIGNUP_URL,
        status: "ok",
      },
    })).toThrow(/timestamp/u);
  });
});
