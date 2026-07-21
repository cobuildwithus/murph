import "server-only";

import type { PrismaClient } from "@prisma/client";
import { MURPH_PRODUCT_ORIGIN } from "@murphai/contracts";

import { readHostedGroupUsageStatus } from "../hosted-groups/group-usage-funding";
import type { HostedAiUsageLimitNoticeCode } from "./usage-allowance";
import { readHostedPersonalAiUsageStatus } from "./usage-status";

/**
 * Adds the personal top-up action only from current delivery-time authority.
 * Any projection failure deliberately leaves the already-neutral notice alone.
 */
export async function projectHostedAiUsageLimitNoticeForDelivery(input: {
  memberId: string;
  message: string;
  noticeCode?: HostedAiUsageLimitNoticeCode;
  prisma: PrismaClient;
}): Promise<string> {
  try {
    if (
      input.noticeCode === "thread_usage_low"
      || input.noticeCode === "thread_usage_limit_reached"
    ) {
      const status = await readHostedGroupUsageStatus({
        prisma: input.prisma,
        runtimeMemberId: input.memberId,
      });
      const expectedCapacityState = input.noticeCode === "thread_usage_low"
        ? "low"
        : "exhausted";
      if (
        status?.capacityState !== expectedCapacityState
        || !status.fundingUrl
      ) {
        return input.message;
      }
      const fundingUrl = new URL(status.fundingUrl, `${MURPH_PRODUCT_ORIGIN}/`);
      if (fundingUrl.origin !== MURPH_PRODUCT_ORIGIN) {
        return input.message;
      }
      return `${input.message}\n\nAdd group usage: ${fundingUrl.toString()}`;
    }

    const usageStatus = await readHostedPersonalAiUsageStatus({
      memberId: input.memberId,
      prisma: input.prisma,
    });
    const action = usageStatus.recommendedAction;
    if (action?.kind !== "add_usage") {
      return input.message;
    }

    const actionUrl = new URL(action.url, `${MURPH_PRODUCT_ORIGIN}/`);
    if (actionUrl.origin !== MURPH_PRODUCT_ORIGIN) {
      return input.message;
    }

    return `${input.message}\n\n${action.label}: ${actionUrl.toString()}`;
  } catch {
    return input.message;
  }
}
