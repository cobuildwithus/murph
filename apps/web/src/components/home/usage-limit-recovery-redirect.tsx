"use client";

import { useEffect } from "react";
import {
  HOSTED_ADD_USAGE_SETTINGS_URL,
  type HostedPlanUsageRecommendedAction,
} from "@murphai/hosted-execution/plan-usage";

import type { HostedAiUsageGateNoticeCode } from "@/src/lib/hosted-execution/usage-allowance";

const HOSTED_SUBSCRIPTION_SETTINGS_URL = "/settings#subscription";

interface UsageLimitRecoveryRedirectProps {
  noticeCode: HostedAiUsageGateNoticeCode;
  recommendedAction?: HostedPlanUsageRecommendedAction | null;
}

export function UsageLimitRecoveryRedirect({
  noticeCode,
  recommendedAction = null,
}: UsageLimitRecoveryRedirectProps) {
  const recoveryUrl = resolveUsageLimitRecoveryUrl({
    noticeCode,
    recommendedAction,
  });

  useEffect(() => {
    if (recoveryUrl) {
      window.location.replace(recoveryUrl);
    }
  }, [recoveryUrl]);

  return null;
}

export function resolveUsageLimitRecoveryUrl(input: {
  noticeCode: HostedAiUsageGateNoticeCode | null;
  recommendedAction: HostedPlanUsageRecommendedAction | null;
}): string | null {
  if (
    input.noticeCode === null
    || input.noticeCode === "thread_usage_limit_reached"
  ) {
    return null;
  }

  if (input.recommendedAction) {
    return input.recommendedAction.url;
  }

  switch (input.noticeCode) {
    case "edge_usage_limit_reached":
    case "family_usage_limit_reached":
    case "pulse_upgrade_edge":
      return HOSTED_ADD_USAGE_SETTINGS_URL;
    case "group_upgrade_pulse":
    case "trial_conversion_pending":
    case "trial_usage_limit_reached":
      return HOSTED_SUBSCRIPTION_SETTINGS_URL;
  }
}
