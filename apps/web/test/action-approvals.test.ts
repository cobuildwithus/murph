import { randomUUID } from "node:crypto";

import type { HostedSensitiveActionChallenge } from "@prisma/client";
import type {
  HostedActionApprovalRequest,
  HostedActionApprovalResult,
} from "@murphai/hosted-execution/action-approval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedWebTestkitDeps } from "./support/hosted-web-testkit";
import {
  createHostedWebTestkitDeps,
  seedHostedActiveMember,
} from "./support/hosted-web-testkit";

const mocks = vi.hoisted(() => ({
  resolveHostedPublicOrigin: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/hosted-web/public-url", () => ({
  resolveHostedPublicOrigin: mocks.resolveHostedPublicOrigin,
}));

import {
  consumeHostedActionApproval,
  requestHostedActionApproval,
} from "@/src/lib/action-approvals";

const REQUEST: HostedActionApprovalRequest = {
  actionFingerprint: "b".repeat(64),
  actionId: `vault-file-send:${"a".repeat(64)}`,
  actionKind: "vault.file.send.v1",
  presentation: {
    body: "Send report.pdf to this conversation.",
    title: "Send a file?",
  },
  returnContactKind: "text",
};

describe("hosted action approvals", () => {
  let deps: HostedWebTestkitDeps | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveHostedPublicOrigin.mockReturnValue("https://withmurph.ai");
  });

  afterEach(async () => {
    await deps?.prisma.$disconnect();
    deps = null;
  });

  async function setup() {
    deps = await createHostedWebTestkitDeps();
    const memberId = `member_action_${randomUUID().replaceAll("-", "")}`;
    await seedHostedActiveMember({
      environment: deps.environment,
      memberId,
    });
    return { deps, memberId };
  }

  it("consumes an approved action once per approval generation and refreshes later", async () => {
    const { deps, memberId } = await setup();
    const requested = await requestHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T16:00:00.000Z"),
      prisma: deps.prisma,
      request: REQUEST,
    });

    expect(requested.status).toBe("pending");
    if (requested.status !== "pending") {
      throw new Error("Expected a pending hosted action approval.");
    }
    expect(requested.approvalUrl).toBe(
      `https://withmurph.ai/approve/${requested.approvalId}`,
    );

    const firstApproved = await approveExistingAction({
      approvalId: requested.approvalId,
      deps,
      expiresAt: new Date("2026-06-25T16:16:00.000Z"),
      memberId,
      now: new Date("2026-06-25T16:01:30.000Z"),
    });

    await expect(consumeHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T16:02:00.000Z"),
      prisma: deps.prisma,
      request: consumeRequest(firstApproved, "delivery_1"),
    })).resolves.toEqual(firstApproved);

    const consumed = await requireApprovalRow(deps, requested.approvalId);
    expect(consumed.consumedAt?.toISOString()).toBe("2026-06-25T16:02:00.000Z");
    expect(consumed.consumedBy).toBe("delivery_1");

    await expect(consumeHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T16:02:30.000Z"),
      prisma: deps.prisma,
      request: consumeRequest(firstApproved, "delivery_1"),
    })).resolves.toEqual(firstApproved);

    await expect(consumeHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T16:03:00.000Z"),
      prisma: deps.prisma,
      request: consumeRequest(firstApproved, "delivery_2"),
    })).resolves.toEqual({
      approvalId: requested.approvalId,
      status: "expired",
    });

    const refreshed = await requestHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T16:04:00.000Z"),
      prisma: deps.prisma,
      request: REQUEST,
    });
    expect(refreshed).toMatchObject({
      approvalId: requested.approvalId,
      expiresAt: "2026-06-25T16:19:00.000Z",
      status: "pending",
    });

    const refreshedRow = await requireApprovalRow(deps, requested.approvalId);
    expect(refreshedRow.approvalStatus).toBe("pending");
    expect(refreshedRow.consumedAt).toBeNull();
    expect(refreshedRow.consumedBy).toBeNull();
    expect(refreshedRow.decidedAt).toBeNull();

    const secondApproved = await approveExistingAction({
      approvalId: requested.approvalId,
      deps,
      expiresAt: new Date("2026-06-25T16:20:00.000Z"),
      memberId,
      now: new Date("2026-06-25T16:05:30.000Z"),
    });
    expect(secondApproved.approvalGeneration).not.toBe(
      firstApproved.approvalGeneration,
    );

    await expect(consumeHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T16:06:00.000Z"),
      prisma: deps.prisma,
      request: consumeRequest(firstApproved, "delivery_3"),
    })).resolves.toEqual({
      approvalId: requested.approvalId,
      status: "expired",
    });

    await expect(consumeHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T16:06:30.000Z"),
      prisma: deps.prisma,
      request: consumeRequest(secondApproved, "delivery_3"),
    })).resolves.toEqual(secondApproved);
  });

  it("refreshes expired or denied attempts instead of permanently blocking retries", async () => {
    const { deps, memberId } = await setup();
    const requested = await requestHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T16:00:00.000Z"),
      prisma: deps.prisma,
      request: REQUEST,
    });
    await deps.prisma.hostedSensitiveActionChallenge.update({
      data: {
        expiresAt: new Date("2026-06-25T16:10:00.000Z"),
      },
      where: { approvalKey: requested.approvalId },
    });

    const afterExpiry = await requestHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T16:11:00.000Z"),
      prisma: deps.prisma,
      request: REQUEST,
    });
    expect(afterExpiry).toMatchObject({
      approvalId: requested.approvalId,
      expiresAt: "2026-06-25T16:26:00.000Z",
      status: "pending",
    });

    await deps.prisma.hostedSensitiveActionChallenge.update({
      data: {
        approvalStatus: "denied",
        decidedAt: new Date("2026-06-25T16:12:00.000Z"),
      },
      where: { approvalKey: requested.approvalId },
    });

    const afterDenial = await requestHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T16:13:00.000Z"),
      prisma: deps.prisma,
      request: REQUEST,
    });
    expect(afterDenial).toMatchObject({
      approvalId: requested.approvalId,
      expiresAt: "2026-06-25T16:28:00.000Z",
      status: "pending",
    });
    expect((await requireApprovalRow(deps, requested.approvalId)).decidedAt)
      .toBeNull();
  });

  it("does not consume an approved action after its delivery window expires", async () => {
    const { deps, memberId } = await setup();
    const requested = await requestHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T16:00:00.000Z"),
      prisma: deps.prisma,
      request: REQUEST,
    });
    const approved = await approveExistingAction({
      approvalId: requested.approvalId,
      deps,
      expiresAt: new Date("2026-06-25T16:02:00.000Z"),
      memberId,
      now: new Date("2026-06-25T16:01:00.000Z"),
    });

    await expect(consumeHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T16:03:00.000Z"),
      prisma: deps.prisma,
      request: consumeRequest(approved, "delivery_expired"),
    })).resolves.toEqual({
      approvalId: requested.approvalId,
      status: "expired",
    });
    expect((await requireApprovalRow(deps, requested.approvalId)).consumedAt)
      .toBeNull();

    await expect(requestHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T16:04:00.000Z"),
      prisma: deps.prisma,
      request: REQUEST,
    })).resolves.toMatchObject({
      approvalId: requested.approvalId,
      expiresAt: "2026-06-25T16:19:00.000Z",
      status: "pending",
    });
  });

  it("only grants one concurrent delivery consumer", async () => {
    const { deps, memberId } = await setup();
    const requested = await requestHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T16:00:00.000Z"),
      prisma: deps.prisma,
      request: REQUEST,
    });
    const approved = await approveExistingAction({
      approvalId: requested.approvalId,
      deps,
      expiresAt: new Date("2026-06-25T16:16:00.000Z"),
      memberId,
      now: new Date("2026-06-25T16:01:00.000Z"),
    });

    const outcomes = await Promise.all([
      consumeHostedActionApproval({
        memberId,
        now: new Date("2026-06-25T16:02:00.000Z"),
        prisma: deps.prisma,
        request: consumeRequest(approved, "delivery_a"),
      }),
      consumeHostedActionApproval({
        memberId,
        now: new Date("2026-06-25T16:02:00.000Z"),
        prisma: deps.prisma,
        request: consumeRequest(approved, "delivery_b"),
      }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "approved"))
      .toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "expired"))
      .toEqual([{ approvalId: requested.approvalId, status: "expired" }]);
  });
});

async function approveExistingAction(input: {
  approvalId: string;
  deps: HostedWebTestkitDeps;
  expiresAt: Date;
  memberId: string;
  now: Date;
}): Promise<Extract<HostedActionApprovalResult, { status: "approved" }>> {
  await input.deps.prisma.hostedSensitiveActionChallenge.update({
    data: {
      approvalStatus: "approved",
      consumedAt: null,
      consumedBy: null,
      decidedAt: input.now,
      expiresAt: input.expiresAt,
      tokenHash: `approval-token-${randomUUID()}`,
    },
    where: { approvalKey: input.approvalId },
  });

  const approved = await requestHostedActionApproval({
    memberId: input.memberId,
    now: input.now,
    prisma: input.deps.prisma,
    request: REQUEST,
  });
  if (approved.status !== "approved") {
    throw new Error("Expected approved hosted action approval.");
  }
  return approved;
}

function consumeRequest(
  approval: Extract<HostedActionApprovalResult, { status: "approved" }>,
  consumerId: string,
) {
  return {
    approvalGeneration: approval.approvalGeneration,
    consumerId,
    request: REQUEST,
  };
}

async function requireApprovalRow(
  deps: HostedWebTestkitDeps,
  approvalId: string,
): Promise<HostedSensitiveActionChallenge> {
  const row = await deps.prisma.hostedSensitiveActionChallenge.findFirst({
    where: { approvalKey: approvalId },
  });
  if (!row) {
    throw new Error(`Missing approval row: ${approvalId}`);
  }
  return row;
}
