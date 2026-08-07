import "server-only";

import type { PrismaClient } from "@prisma/client";
import { MURPH_PRODUCT_ORIGIN } from "@murphai/contracts";

import { readHostedGroupUsageStatus } from "../hosted-groups/group-usage-funding";
import { renderUserFacingMessage } from "../hosted-messages/user-facing-messages";
import type { HostedAiUsageLimitNoticeCode } from "./usage-allowance";
import { readHostedPersonalAiUsageStatus } from "./usage-status";

/**
 * Adds or replaces delivery copy only from current delivery-time authority.
 * Any projection failure leaves the canonical notice unchanged.
 */
export async function projectHostedAiUsageLimitNoticeForDelivery(input: {
  memberId: string;
  message: string;
  noticeCode?: HostedAiUsageLimitNoticeCode;
  prisma: PrismaClient;
}): Promise<string> {
  try {
    if (input.noticeCode === "thread_usage_limit_reached") {
      const status = await readHostedGroupUsageStatus({
        prisma: input.prisma,
        runtimeMemberId: input.memberId,
      });
      if (
        !status?.fundingNeeded
        || !status.fundingUrl
      ) {
        return input.message;
      }
      const fundingUrl = new URL(
        status.fundingUrl,
        `${MURPH_PRODUCT_ORIGIN}/`,
      );
      if (fundingUrl.origin !== MURPH_PRODUCT_ORIGIN) {
        return input.message;
      }
      const funding = renderUserFacingMessage({
        context: { fundingUrl: fundingUrl.toString() },
        key: "linq.ai_usage.thread_limit_funding",
        seed: input.memberId,
      });
      return `${input.message}\n\n${funding.text}`;
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
