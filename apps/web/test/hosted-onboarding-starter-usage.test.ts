import { describe, expect, it } from "vitest";

import {
  buildHostedStarterUsageLifetimePeriod,
} from "@/src/lib/hosted-onboarding/starter-usage";

describe("hosted Starter usage policy", () => {
  it("returns a stable lifetime persistence window without sharing mutable Dates", () => {
    const first = buildHostedStarterUsageLifetimePeriod();
    const second = buildHostedStarterUsageLifetimePeriod();

    expect(first).toEqual({
      periodEnd: new Date("2099-12-31T23:59:59.999Z"),
      periodStart: new Date(0),
    });
    expect(second).toEqual(first);
    expect(second.periodStart).not.toBe(first.periodStart);
    expect(second.periodEnd).not.toBe(first.periodEnd);

    first.periodStart.setUTCFullYear(2030);
    expect(second.periodStart).toEqual(new Date(0));
  });

});
