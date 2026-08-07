import "server-only";

import type { PrismaClient } from "@prisma/client";
import { MURPH_PRODUCT_ORIGIN } from "@murphai/contracts";

import {
  buildHostedGroupUsageFundingLocatorForRuntimeMember,
  buildHostedGroupUsageFundingUrl,
} from "../hosted-groups/group-usage-funding";
import type { HostedAiUsageLimitNoticeCode } from "./usage-allowance";
import { readHostedPersonalAiUsageStatus } from "./usage-status";

const HOSTED_GROUP_USAGE_LIMIT_RECOVERY_MESSAGE =
  "Murph is paused in this chat right now. Private options to add more Murph time are here, or the room can wait for its allowance to reset:";

/**
 * Adds or replaces delivery copy only from current delivery-time authority.
 * A group exhaustion notice is not sendable without its mandatory action.
 */
export async function projectHostedAiUsageLimitNoticeForDelivery(input: {
  memberId: string;
  message: string;
  noticeCode?: HostedAiUsageLimitNoticeCode;
  prisma: PrismaClient;
}): Promise<string> {
  try {
    if (input.noticeCode === "thread_usage_limit_reached") {
      const locator = buildHostedGroupUsageFundingLocatorForRuntimeMember(
        input.memberId,
      );
      const projectedUrl = locator
        ? buildHostedGroupUsageFundingUrl({ joinCode: locator })
        : null;
      if (!projectedUrl) {
        throw new TypeError(
          "Hosted group usage-limit recovery URL is unavailable.",
        );
      }
      const fundingUrl = new URL(
        projectedUrl,
        `${MURPH_PRODUCT_ORIGIN}/`,
      );
      if (fundingUrl.origin !== MURPH_PRODUCT_ORIGIN) {
        throw new TypeError(
          "Hosted group usage-limit recovery URL is not first-party.",
        );
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
  } catch (cause) {
    if (input.noticeCode === "thread_usage_limit_reached") {
      throw cause;
    }
    return input.message;
  }
}
