import { HostedBillingStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { isHostedMemberActivationPending } from "./activation-progress";

describe("hosted member activation progress", () => {
  it("does not model activation progress in web-owned ingress state", async () => {
    await expect(isHostedMemberActivationPending({
      billingStatus: HostedBillingStatus.active,
      memberId: "member_123",
      prisma: {},
    })).resolves.toBe(false);
  });

  it("returns false for inactive billing states", async () => {
    await expect(isHostedMemberActivationPending({
      billingStatus: HostedBillingStatus.not_started,
      memberId: "member_123",
      prisma: {},
    })).resolves.toBe(false);
  });
});
