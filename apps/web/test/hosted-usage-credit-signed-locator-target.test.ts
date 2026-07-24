import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildHostedGroupUsageFundingLocatorForRuntimeMember,
  normalizeHostedGroupUsageJoinCode,
} from "@/src/lib/hosted-groups/group-usage-funding";
import { projectHostedUsageCreditPurchaseTarget } from "@/src/lib/hosted-onboarding/usage-credit-purchase-status-service";

const TEST_HMAC_KEY = Buffer.alloc(32, 7).toString("base64url");
const ROTATED_HMAC_KEY = Buffer.alloc(32, 9).toString("base64url");

function buildPurchase(locator: string) {
  return {
    beneficiaryMemberId: "member_group_runtime",
    checkoutSuccessUrl:
      `https://www.withmurph.ai/groups/fund/${encodeURIComponent(locator)}`
      + "?usageCheckout=success&usagePurchase=hucp_1",
    id: "hucp_1",
    payerMemberId: "member_payer_1",
  };
}

describe("signed funding locator purchase-target lifecycle", () => {
  beforeEach(() => {
    process.env.HOSTED_APP_SESSION_HMAC_KEY = TEST_HMAC_KEY;
  });

  it("reprojects a persisted signed-locator return target as the exact group", () => {
    const locator =
      buildHostedGroupUsageFundingLocatorForRuntimeMember("member_group_runtime");

    expect(locator).not.toBeNull();
    expect(projectHostedUsageCreditPurchaseTarget(buildPurchase(locator ?? "")))
      .toEqual({
        beneficiaryMemberId: "member_group_runtime",
        groupJoinCode: locator,
        kind: "group",
      });
  });

  it("revokes persisted signed-locator targets when the app-session key rotates", () => {
    const locator =
      buildHostedGroupUsageFundingLocatorForRuntimeMember("member_group_runtime");
    process.env.HOSTED_APP_SESSION_HMAC_KEY = ROTATED_HMAC_KEY;

    // Documented revocation semantics: rotation invalidates delivered
    // codeless-group funding links, so the persisted purchase target fails
    // legible verification instead of silently matching.
    expect(() => projectHostedUsageCreditPurchaseTarget(buildPurchase(locator ?? "")))
      .toThrowError(/could not be verified/u);
    expect(normalizeHostedGroupUsageJoinCode(locator)).toBeNull();
  });
});
