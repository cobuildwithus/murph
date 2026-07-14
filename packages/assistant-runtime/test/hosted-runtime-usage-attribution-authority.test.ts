import { describe, expect, it } from "vitest";

import {
  createHostedRuntimeUsageAttributionAuthority,
} from "../src/hosted-runtime/usage-attribution-authority.ts";

const FIRST_ATTRIBUTION = {
  allowanceSource: "direct_trial",
  billingPlanCode: "launch_monthly",
  kind: "period",
  limitUsdMicros: "1234567",
  periodEnd: "2026-04-08T00:00:00.000Z",
  periodStart: "2026-04-01T00:00:00.000Z",
} as const;
const SECOND_ATTRIBUTION = {
  groupId: "hbag_second_family",
  kind: "family",
} as const;

describe("hosted runtime usage attribution authority", () => {
  it("binds a first attributed wake after an unattributed runtime start", () => {
    const authority = createHostedRuntimeUsageAttributionAuthority(null);

    expect(authority.resolve([], null)).toBeNull();
    authority.recordAssistantInputs({
      assistantInputIds: ["assistant_input_first"],
      usageAttribution: FIRST_ATTRIBUTION,
    });

    expect(authority.resolve(["assistant_input_first"], null)).toEqual(
      FIRST_ATTRIBUTION,
    );
    expect(authority.readLatest()).toEqual(FIRST_ATTRIBUTION);
  });

  it("keeps delayed earlier usage on its accepted-input proof after a later wake", () => {
    const authority = createHostedRuntimeUsageAttributionAuthority(FIRST_ATTRIBUTION);
    authority.recordAssistantInputs({
      assistantInputIds: ["assistant_input_first"],
      usageAttribution: FIRST_ATTRIBUTION,
    });
    authority.recordLatest(SECOND_ATTRIBUTION);
    authority.recordAssistantInputs({
      assistantInputIds: ["assistant_input_second"],
      usageAttribution: SECOND_ATTRIBUTION,
    });

    expect(authority.resolve(
      ["assistant_input_first"],
      SECOND_ATTRIBUTION,
    )).toEqual(FIRST_ATTRIBUTION);
    expect(authority.resolve(
      ["assistant_input_second"],
      FIRST_ATTRIBUTION,
    )).toEqual(SECOND_ATTRIBUTION);
    expect(authority.resolve(
      ["assistant_input_first"],
      SECOND_ATTRIBUTION,
    )).toEqual(FIRST_ATTRIBUTION);
  });
});
