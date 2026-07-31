import "server-only";

import type { PrismaClient } from "@prisma/client";
import { MURPH_PRODUCT_ORIGIN } from "@murphai/contracts";

import { readHostedGroupUsageStatus } from "../hosted-groups/group-usage-funding";
import {
  HOSTED_SPONSORED_GROUP_PAUSE_MESSAGE,
  renderUserFacingMessage,
} from "../hosted-messages/user-facing-messages";
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
      if (status?.sponsorshipStatus === "sponsored") {
        return HOSTED_SPONSORED_GROUP_PAUSE_MESSAGE;
      }
      if (
        !status?.fundingNeeded
        || !status.fundingUrl
      ) {
        return input.message;
      }
      const fundingUrl = new URL(status.fundingUrl, `${MURPH_PRODUCT_ORIGIN}/`);
      if (fundingUrl.origin !== MURPH_PRODUCT_ORIGIN) {
        return input.message;
      }
      /**
       * Only this branch knows the group can actually be funded right now, so
       * it owns the ask. A live monthly sponsorship suppresses this branch,
       * leaving only the neutral group pause notice without payer or amount
       * details.
       */
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
