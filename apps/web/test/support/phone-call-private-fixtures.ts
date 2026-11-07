import {
  hostedPhoneCallBriefSchema,
  hostedPhoneCallResultSchema,
  type HostedPhoneCallBrief,
  type HostedPhoneCallResult,
} from "@murphai/hosted-execution/phone-calls";

// Synchronous fixtures for the hosted secure-box codec installed by setup-env.
export function encodeHostedPhoneCallBriefFixture(input: {
  memberId: string;
  value: HostedPhoneCallBrief;
}): string {
  return encodePrivateFixture("brief", input.memberId, hostedPhoneCallBriefSchema.parse(input.value));
}

export function encodeHostedPhoneCallResultFixture(input: {
  memberId: string;
  value: HostedPhoneCallResult;
}): string {
  return encodePrivateFixture("result", input.memberId, hostedPhoneCallResultSchema.parse(input.value));
}

function encodePrivateFixture(field: "brief" | "result", memberId: string, value: unknown): string {
  return `hsb-test:${Buffer.from(JSON.stringify({
    lane: "hosted-member-private-field",
    scope: `hosted-phone-call:${field}`,
    userId: memberId,
    value: JSON.stringify(value),
  }), "utf8").toString("base64url")}`;
}
