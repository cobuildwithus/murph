import "server-only";

import {
  createHostedPhoneLookupKeyReadCandidates,
} from "./contact-privacy";
import {
  countHostedMemberHomeLinqBindingsByRecipientPhone,
} from "./hosted-member-routing-store";
import type { HostedLinqAssignableHomeLine } from "./linq-line-store";
import { normalizePhoneNumber } from "./phone";
import type { HostedOnboardingReadClient } from "./shared";

export const HOSTED_LINQ_ACTIVE_DIRECT_MEMBER_PLANNING_MESSAGES = 10;
export const HOSTED_LINQ_PROVISIONED_GROUP_THREAD_PLANNING_MESSAGES = 25;

export interface HostedLinqLinePlanningLoad {
  activeDirectMemberCount: number;
  plannedMessages: number;
  provisionedGroupThreadCount: number;
}

export interface HostedLinqLinePlanningLoadSnapshot {
  byRecipientPhone: ReadonlyMap<string, HostedLinqLinePlanningLoad>;
  projectionCoverageComplete: boolean;
  unprojectedGroupThreadCount: number;
}

/**
 * Reads the two canonical route owners and derives a set-based planning view.
 * Legacy null thread projections are surfaced explicitly. Assignment adds
 * their weight to every line only while rollout coverage is incomplete, which
 * prevents an unknown group from being mistaken for known spare capacity
 * without inventing a mutable aggregate or attributing it to an owner line.
 */
export async function readHostedLinqLinePlanningLoadSnapshot(input: {
  excludedActiveMemberId?: string | null;
  lines: readonly HostedLinqAssignableHomeLine[];
  now: Date;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedLinqLinePlanningLoadSnapshot> {
  const lookup = buildHostedLinqLineAccountLookup(input.lines);
  const recipientPhones = [...lookup.recipientPhones];

  if (recipientPhones.length === 0) {
    return {
      byRecipientPhone: new Map(),
      projectionCoverageComplete: true,
      unprojectedGroupThreadCount: 0,
    };
  }

  const [activeDirectMembers, projectedGroupCounts] = await Promise.all([
    countHostedMemberHomeLinqBindingsByRecipientPhone({
      ...(input.excludedActiveMemberId
        ? { excludedMemberId: input.excludedActiveMemberId }
        : {}),
      now: input.now,
      prisma: input.prisma,
      recipientPhones,
    }),
    input.prisma.hostedThreadRoute.groupBy({
      by: ["accountLookupKey"],
      where: {
        channel: "linq",
        OR: [
          { accountLookupKey: null },
          {
            accountLookupKey: {
              in: [...lookup.recipientPhoneByAccountLookupKey.keys()],
            },
          },
        ],
      },
      _count: {
        _all: true,
      },
    }),
  ]);

  const provisionedGroupsByRecipientPhone = new Map<string, number>(
    recipientPhones.map((recipientPhone) => [recipientPhone, 0]),
  );
  let unprojectedGroupThreadCount = 0;
  for (const groupedCount of projectedGroupCounts) {
    const accountLookupKey = groupedCount.accountLookupKey;
    if (accountLookupKey === null) {
      unprojectedGroupThreadCount += groupedCount._count._all;
      continue;
    }
    const recipientPhone = accountLookupKey
      ? lookup.recipientPhoneByAccountLookupKey.get(accountLookupKey)
      : null;
    if (!recipientPhone) {
      continue;
    }
    provisionedGroupsByRecipientPhone.set(
      recipientPhone,
      (provisionedGroupsByRecipientPhone.get(recipientPhone) ?? 0)
        + groupedCount._count._all,
    );
  }

  return {
    byRecipientPhone: new Map(recipientPhones.map((recipientPhone) => {
      const activeDirectMemberCount = activeDirectMembers.get(recipientPhone) ?? 0;
      const provisionedGroupThreadCount =
        provisionedGroupsByRecipientPhone.get(recipientPhone) ?? 0;
      return [
        recipientPhone,
        {
          activeDirectMemberCount,
          plannedMessages:
            activeDirectMemberCount
              * HOSTED_LINQ_ACTIVE_DIRECT_MEMBER_PLANNING_MESSAGES
            + provisionedGroupThreadCount
              * HOSTED_LINQ_PROVISIONED_GROUP_THREAD_PLANNING_MESSAGES,
          provisionedGroupThreadCount,
        },
      ] as const;
    })),
    projectionCoverageComplete: unprojectedGroupThreadCount === 0,
    unprojectedGroupThreadCount,
  };
}

export function buildHostedLinqAssignmentPlanningMessages(
  snapshot: HostedLinqLinePlanningLoadSnapshot,
): ReadonlyMap<string, number> {
  const unattributedPlanningMessages = snapshot.unprojectedGroupThreadCount
    * HOSTED_LINQ_PROVISIONED_GROUP_THREAD_PLANNING_MESSAGES;

  return new Map(
    [...snapshot.byRecipientPhone].map(([recipientPhone, load]) => [
      recipientPhone,
      load.plannedMessages + unattributedPlanningMessages,
    ]),
  );
}

function buildHostedLinqLineAccountLookup(
  lines: readonly HostedLinqAssignableHomeLine[],
): {
  recipientPhoneByAccountLookupKey: Map<string, string>;
  recipientPhones: Set<string>;
} {
  const recipientPhoneByAccountLookupKey = new Map<string, string>();
  const recipientPhones = new Set<string>();

  for (const line of lines) {
    const recipientPhone = normalizePhoneNumber(line.phoneNumber);
    if (!recipientPhone) {
      throw new TypeError("Hosted Linq planning load requires valid line phones.");
    }
    recipientPhones.add(recipientPhone);

    const lookupKeys = new Set([
      line.phoneNumberLookupKey,
      ...createHostedPhoneLookupKeyReadCandidates(recipientPhone),
    ]);
    for (const accountLookupKey of lookupKeys) {
      const existingRecipientPhone =
        recipientPhoneByAccountLookupKey.get(accountLookupKey);
      if (existingRecipientPhone && existingRecipientPhone !== recipientPhone) {
        throw new Error(
          "Hosted Linq planning load found an ambiguous line account lookup key.",
        );
      }
      recipientPhoneByAccountLookupKey.set(accountLookupKey, recipientPhone);
    }
  }

  return {
    recipientPhoneByAccountLookupKey,
    recipientPhones,
  };
}
