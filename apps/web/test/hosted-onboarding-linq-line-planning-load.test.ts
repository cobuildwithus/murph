import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";

const mocks = vi.hoisted(() => ({
  countHostedMemberHomeLinqBindingsByRecipientPhone: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  countHostedMemberHomeLinqBindingsByRecipientPhone:
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone,
}));

import {
  buildHostedLinqAssignmentPlanningMessages,
  HOSTED_LINQ_ACTIVE_DIRECT_MEMBER_PLANNING_MESSAGES,
  HOSTED_LINQ_PROVISIONED_GROUP_THREAD_PLANNING_MESSAGES,
  readHostedLinqLinePlanningLoadSnapshot,
} from "@/src/lib/hosted-onboarding/linq-line-planning-load";

describe("readHostedLinqLinePlanningLoadSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("weights active direct members and provisioned Linq group routes", async () => {
    const lineOne = buildLine("+15550100001");
    const lineTwo = buildLine("+15550100002");
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockResolvedValue(
      new Map([
        [lineOne.phoneNumber, 3],
        [lineTwo.phoneNumber, 1],
      ]),
    );
    const prisma = buildPrisma({
      projectedGroups: [
        { accountLookupKey: lineOne.phoneNumberLookupKey, count: 2 },
        { accountLookupKey: lineTwo.phoneNumberLookupKey, count: 4 },
      ],
      unprojectedGroups: 0,
    });

    const snapshot = await readHostedLinqLinePlanningLoadSnapshot({
      lines: [lineOne, lineTwo],
      now: new Date("2026-07-29T12:00:00.000Z"),
      prisma: prisma as never,
    });

    expect(snapshot.byRecipientPhone.get(lineOne.phoneNumber)).toEqual({
      activeDirectMemberCount: 3,
      plannedMessages:
        3 * HOSTED_LINQ_ACTIVE_DIRECT_MEMBER_PLANNING_MESSAGES
        + 2 * HOSTED_LINQ_PROVISIONED_GROUP_THREAD_PLANNING_MESSAGES,
      provisionedGroupThreadCount: 2,
    });
    expect(snapshot.byRecipientPhone.get(lineTwo.phoneNumber)).toEqual({
      activeDirectMemberCount: 1,
      plannedMessages:
        HOSTED_LINQ_ACTIVE_DIRECT_MEMBER_PLANNING_MESSAGES
        + 4 * HOSTED_LINQ_PROVISIONED_GROUP_THREAD_PLANNING_MESSAGES,
      provisionedGroupThreadCount: 4,
    });
    expect(snapshot.projectionCoverageComplete).toBe(true);
  });

  it("attributes groups to their canonical route account, independent of owner home-line placement", async () => {
    const ownerHomeLine = buildLine("+15550100001");
    const routedGroupLine = buildLine("+15550100002");
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockResolvedValue(
      new Map([[ownerHomeLine.phoneNumber, 1]]),
    );
    const prisma = buildPrisma({
      projectedGroups: [
        { accountLookupKey: routedGroupLine.phoneNumberLookupKey, count: 1 },
      ],
      unprojectedGroups: 0,
    });

    const snapshot = await readHostedLinqLinePlanningLoadSnapshot({
      lines: [ownerHomeLine, routedGroupLine],
      now: new Date("2026-07-29T12:00:00.000Z"),
      prisma: prisma as never,
    });

    expect(snapshot.byRecipientPhone.get(ownerHomeLine.phoneNumber)).toMatchObject({
      activeDirectMemberCount: 1,
      provisionedGroupThreadCount: 0,
    });
    expect(snapshot.byRecipientPhone.get(routedGroupLine.phoneNumber)).toMatchObject({
      activeDirectMemberCount: 0,
      provisionedGroupThreadCount: 1,
    });
    expect(prisma.hostedThreadRoute.groupBy).toHaveBeenCalledWith({
      by: ["accountLookupKey"],
      where: {
        channel: "linq",
        OR: [
          { accountLookupKey: null },
          {
            accountLookupKey: {
              in: expect.arrayContaining([
                ownerHomeLine.phoneNumberLookupKey,
                routedGroupLine.phoneNumberLookupKey,
              ]),
            },
          },
        ],
      },
      _count: {
        _all: true,
      },
    });
  });

  it("surfaces legacy null coverage and conservatively prevents false spare capacity", async () => {
    const lineOne = buildLine("+15550100001");
    const lineTwo = buildLine("+15550100002");
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockResolvedValue(new Map());
    const prisma = buildPrisma({
      projectedGroups: [],
      unprojectedGroups: 2,
    });

    const snapshot = await readHostedLinqLinePlanningLoadSnapshot({
      lines: [lineOne, lineTwo],
      now: new Date("2026-07-29T12:00:00.000Z"),
      prisma: prisma as never,
    });
    const assignmentPlanningMessages =
      buildHostedLinqAssignmentPlanningMessages(snapshot);

    expect(snapshot).toMatchObject({
      projectionCoverageComplete: false,
      unprojectedGroupThreadCount: 2,
    });
    expect(assignmentPlanningMessages.get(lineOne.phoneNumber)).toBe(50);
    expect(assignmentPlanningMessages.get(lineTwo.phoneNumber)).toBe(50);
  });
});

function buildLine(phoneNumber: string) {
  const phoneNumberLookupKey = createHostedPhoneLookupKey(phoneNumber);
  if (!phoneNumberLookupKey) {
    throw new Error("Expected a line lookup key.");
  }
  return {
    assignmentWeight: 100,
    maxNewConversationsPerDay: 50,
    phoneNumber,
    phoneNumberHint: `*** ${phoneNumber.slice(-4)}`,
    phoneNumberLookupKey,
    proactiveConversationCount: 0,
    proactiveConversationDayUtc: new Date("2026-07-29T00:00:00.000Z"),
  };
}

function buildPrisma(input: {
  projectedGroups: readonly { accountLookupKey: string; count: number }[];
  unprojectedGroups: number;
}) {
  return {
    hostedThreadRoute: {
      groupBy: vi.fn().mockResolvedValue([
        ...input.projectedGroups.map((group) => ({
          accountLookupKey: group.accountLookupKey,
          _count: {
            _all: group.count,
          },
        })),
        ...(input.unprojectedGroups > 0
          ? [{
              accountLookupKey: null,
              _count: {
                _all: input.unprojectedGroups,
              },
            }]
          : []),
      ]),
    },
  };
}
