import { describe, expect, it } from "vitest";
import { HOSTED_ADD_USAGE_SETTINGS_URL } from "@murphai/hosted-execution/plan-usage";

import { resolveUsageLimitRecoveryUrl } from "@/src/components/home/usage-limit-recovery-redirect";

const CHANGE_PLAN_ACTION = {
  kind: "change_plan",
  label: "Start Pulse",
  targetPlanCode: "launch_monthly",
  url: "https://withmurph.ai/settings#subscription",
} as const;

describe("resolveUsageLimitRecoveryUrl", () => {
  it.each([
    "edge_usage_limit_reached",
    "family_usage_limit_reached",
    "pulse_upgrade_edge",
  ] as const)("opens Add usage for %s", (noticeCode) => {
    expect(resolveUsageLimitRecoveryUrl({
      noticeCode,
      recommendedAction: null,
    })).toBe(HOSTED_ADD_USAGE_SETTINGS_URL);
  });

  it.each([
    "group_upgrade_pulse",
    "trial_conversion_pending",
    "trial_usage_limit_reached",
  ] as const)("opens subscription settings for %s without an available action", (noticeCode) => {
    expect(resolveUsageLimitRecoveryUrl({
      noticeCode,
      recommendedAction: null,
    })).toBe("/settings#subscription");
  });

  it("prefers the server-projected recovery action", () => {
    expect(resolveUsageLimitRecoveryUrl({
      noticeCode: "trial_conversion_pending",
      recommendedAction: CHANGE_PLAN_ACTION,
    })).toBe(CHANGE_PLAN_ACTION.url);
  });

  it("does not redirect thread-funded group limits", () => {
    expect(resolveUsageLimitRecoveryUrl({
      noticeCode: "thread_usage_limit_reached",
      recommendedAction: null,
    })).toBeNull();
  });

  it("does not redirect without a usage notice", () => {
    expect(resolveUsageLimitRecoveryUrl({
      noticeCode: null,
      recommendedAction: null,
    })).toBeNull();
  });
});
