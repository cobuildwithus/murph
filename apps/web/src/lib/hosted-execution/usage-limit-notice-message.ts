import "server-only";

import type { PrismaClient } from "@prisma/client";
import { MURPH_PRODUCT_ORIGIN } from "@murphai/contracts";

import { readHostedGroupFundingRecoveryStatus } from "../hosted-groups/group-usage-funding";
import type { HostedAiUsageLimitNoticeCode } from "./usage-allowance";
import { readHostedPersonalAiUsageStatus } from "./usage-status";

const HOSTED_GROUP_USAGE_LIMIT_RECOVERY_MESSAGE =
  "Murph is paused in this chat right now. Private options to add more Murph time are here, or the room can wait for its allowance to reset:";

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
      const status = await readHostedGroupFundingRecoveryStatus({
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
      return `${HOSTED_GROUP_USAGE_LIMIT_RECOVERY_MESSAGE}\n${fundingUrl.toString()}`;
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
