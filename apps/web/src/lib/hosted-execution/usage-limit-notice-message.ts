import "server-only";

import type { PrismaClient } from "@prisma/client";
import {
  buildHostedGroupUsageFundingLocatorForRuntimeMember,
  buildHostedGroupUsageFundingUrl,
} from "../hosted-groups/group-usage-funding";
import { resolveHostedPublicBaseUrl } from "../hosted-web/public-url";
import type { HostedAiUsageLimitNoticeCode } from "./usage-allowance";

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
      const publicBaseUrl = resolveHostedPublicBaseUrl();
      if (!publicBaseUrl) {
        throw new TypeError(
          "Hosted group usage-limit recovery URL is unavailable.",
        );
      }
      const locator = buildHostedGroupUsageFundingLocatorForRuntimeMember(
        input.memberId,
      );
      const projectedUrl = locator
        ? buildHostedGroupUsageFundingUrl({
            joinCode: locator,
            publicBaseUrl,
          })
        : null;
      if (!projectedUrl) {
        throw new TypeError(
          "Hosted group usage-limit recovery URL is unavailable.",
        );
      }
      const trustedOrigin = new URL(publicBaseUrl).origin;
      const fundingUrl = new URL(projectedUrl);
      if (fundingUrl.origin !== trustedOrigin) {
        throw new TypeError(
          "Hosted group usage-limit recovery URL is not first-party.",
        );
      }
      return `${HOSTED_GROUP_USAGE_LIMIT_RECOVERY_MESSAGE}\n${fundingUrl.toString()}`;
    }

    return input.message;
  } catch (cause) {
    if (input.noticeCode === "thread_usage_limit_reached") {
      throw cause;
    }
    return input.message;
  }
}
