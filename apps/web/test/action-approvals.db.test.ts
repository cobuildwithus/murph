import { createHash, randomUUID } from "node:crypto";

import type {
  HostedActionApprovalRequest,
  HostedActionApprovalResult,
} from "@murphai/hosted-execution/action-approval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  HostedSensitiveActionChallengeForTest,
  HostedWebTestkitDeps,
} from "./support/hosted-web-testkit";
import { createHostedWebTestkitDeps } from "./support/hosted-web-testkit";

const mocks = vi.hoisted(() => ({
  resolveHostedPublicOrigin: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/hosted-web/public-url", () => ({
  resolveHostedPublicOrigin: mocks.resolveHostedPublicOrigin,
}));

import {
  consumeHostedActionApproval,
  decideHostedActionApprovalTx,
  requirePendingHostedActionApproval,
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
    await deps.prisma.hostedMember.create({
      data: {
        billingStatus: "active",
        id: memberId,
      },
    });
    return { deps, memberId };
  }

  it("commits a generation-scoped pending-effect wake with each approval decision", async () => {
    const { deps, memberId } = await setup();
    const firstRequest = await requestHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T16:00:00.000Z"),
      prisma: deps.prisma,
      request: REQUEST,
    });
    const firstPending = await requirePendingHostedActionApproval({
      approvalId: firstRequest.approvalId,
      memberId,
      now: new Date("2026-06-25T16:01:00.000Z"),
      prisma: deps.prisma,
    });
    const firstDecision = await deps.prisma.$transaction((tx) =>
      decideHostedActionApprovalTx({
        approval: firstPending,
        challenge: verifiedApprovalChallenge(firstPending, memberId),
        decision: "approved",
        memberId,
        now: new Date("2026-06-25T16:01:00.000Z"),
        tx,
      }));

    expect(firstDecision.approval.status).toBe("approved");
    expect(firstDecision.runtimeResume).toEqual({
      lane: "system",
      laneSeq: expect.stringMatching(/^[1-9][0-9]*$/u),
      mailboxItemId: expect.any(String),
      userId: memberId,
    });
    const firstWake = await deps.prisma.hostedMailboxItem.findUniqueOrThrow({
      where: { id: firstDecision.runtimeResume.mailboxItemId },
    });
    expect(firstWake).toMatchObject({
      dedupeKey: expect.stringMatching(
        /^runtime-control:pending-effects-reconcile:[0-9a-f]{64}$/u,
      ),
      kind: "runtime.pending-effects-reconcile-requested",
      lane: "system",
      userId: memberId,
    });

    const firstApproved = await requestHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T16:01:30.000Z"),
      prisma: deps.prisma,
      request: REQUEST,
    });
    if (firstApproved.status !== "approved") {
      throw new Error("Expected the first action approval to be approved.");
    }
    await consumeHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T16:02:00.000Z"),
      prisma: deps.prisma,
      request: consumeRequest(firstApproved, "delivery_generation_one"),
    });

    const secondRequest = await requestHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T16:03:00.000Z"),
      prisma: deps.prisma,
      request: REQUEST,
    });
    expect(secondRequest.status).toBe("pending");
    const secondPending = await requirePendingHostedActionApproval({
      approvalId: secondRequest.approvalId,
      memberId,
      now: new Date("2026-06-25T16:04:00.000Z"),
      prisma: deps.prisma,
    });
    const secondDecision = await deps.prisma.$transaction((tx) =>
      decideHostedActionApprovalTx({
        approval: secondPending,
        challenge: verifiedApprovalChallenge(secondPending, memberId),
        decision: "approved",
        memberId,
        now: new Date("2026-06-25T16:04:00.000Z"),
        tx,
      }));

    const secondWake = await deps.prisma.hostedMailboxItem.findUniqueOrThrow({
      where: { id: secondDecision.runtimeResume.mailboxItemId },
    });
    expect(secondWake.dedupeKey).not.toBe(firstWake.dedupeKey);
    expect(BigInt(secondDecision.runtimeResume.laneSeq)).toBeGreaterThan(
      BigInt(firstDecision.runtimeResume.laneSeq),
    );
  });

  it("rolls back the approval decision when its durable wake cannot append", async () => {
    const { deps, memberId } = await setup();
    const requested = await requestHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T17:00:00.000Z"),
      prisma: deps.prisma,
      request: REQUEST,
    });
    const pending = await requirePendingHostedActionApproval({
      approvalId: requested.approvalId,
      memberId,
      now: new Date("2026-06-25T17:01:00.000Z"),
      prisma: deps.prisma,
    });

    await expect(deps.prisma.$transaction(async (tx) => {
      const failingTx = new Proxy(tx, {
        get(target, property, receiver) {
          if (property === "$queryRaw") {
            return async () => {
              throw new Error("synthetic mailbox append failure");
            };
          }
          return Reflect.get(target, property, receiver);
        },
      });
      return decideHostedActionApprovalTx({
        approval: pending,
        decision: "denied",
        memberId,
        now: new Date("2026-06-25T17:01:00.000Z"),
        tx: failingTx,
      });
    })).rejects.toThrow("synthetic mailbox append failure");

    const stored = await requireApprovalRow(deps, requested.approvalId);
    expect(stored.approvalStatus).toBe("pending");
    expect(stored.decidedAt).toBeNull();
    await expect(deps.prisma.hostedMailboxItem.count({
      where: {
        kind: "runtime.pending-effects-reconcile-requested",
        userId: memberId,
      },
    })).resolves.toBe(0);
  });

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

  it("does not idempotently re-consume the same delivery after expiry", async () => {
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
      expiresAt: new Date("2026-06-25T16:03:00.000Z"),
      memberId,
      now: new Date("2026-06-25T16:01:00.000Z"),
    });

    await expect(consumeHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T16:02:00.000Z"),
      prisma: deps.prisma,
      request: consumeRequest(approved, "delivery_retry"),
    })).resolves.toEqual(approved);

    await expect(consumeHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T16:04:00.000Z"),
      prisma: deps.prisma,
      request: consumeRequest(approved, "delivery_retry"),
    })).resolves.toEqual({
      approvalId: requested.approvalId,
      status: "expired",
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

  it("does not let a stale delivery consume a refreshed approval generation", async () => {
    const { deps, memberId } = await setup();
    const requested = await requestHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T16:00:00.000Z"),
      prisma: deps.prisma,
      request: REQUEST,
    });
    const firstApproved = await approveExistingAction({
      approvalId: requested.approvalId,
      deps,
      expiresAt: new Date("2026-06-25T16:16:00.000Z"),
      memberId,
      now: new Date("2026-06-25T16:01:00.000Z"),
    });
    const firstRow = await requireApprovalRow(deps, requested.approvalId);
    const challenges = deps.prisma.hostedSensitiveActionChallenge;
    let refreshedBeforeConsume = false;
    const staleRacePrisma = {
      hostedSensitiveActionChallenge: {
        findFirst: (args: unknown) => challenges.findFirst(args),
        updateMany: async (args: unknown) => {
          if (!refreshedBeforeConsume) {
            refreshedBeforeConsume = true;
            await challenges.update({
              data: {
                approvalStatus: "approved",
                consumedAt: null,
                consumedBy: null,
                decidedAt: new Date("2026-06-25T16:02:00.000Z"),
                expiresAt: new Date("2026-06-25T16:17:00.000Z"),
                tokenHash: `approval-token-${randomUUID()}`,
              },
              where: { approvalKey: requested.approvalId },
            });
          }
          return challenges.updateMany(args);
        },
        upsert: (args: unknown) => challenges.upsert(args),
      },
    };

    await expect(consumeHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T16:02:00.000Z"),
      prisma: staleRacePrisma,
      request: consumeRequest(firstApproved, "delivery_stale"),
    })).resolves.toEqual({
      approvalId: requested.approvalId,
      status: "expired",
    });
    expect(refreshedBeforeConsume).toBe(true);

    const afterStaleConsume = await requireApprovalRow(deps, requested.approvalId);
    expect(afterStaleConsume.approvalStatus).toBe("approved");
    expect(afterStaleConsume.consumedAt).toBeNull();
    expect(afterStaleConsume.consumedBy).toBeNull();
    expect(afterStaleConsume.tokenHash).not.toBe(firstRow.tokenHash);

    const secondApproved = await requestHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T16:02:30.000Z"),
      prisma: deps.prisma,
      request: REQUEST,
    });
    if (secondApproved.status !== "approved") {
      throw new Error("Expected refreshed hosted action approval to be approved.");
    }
    expect(secondApproved.approvalGeneration).not.toBe(
      firstApproved.approvalGeneration,
    );

    await expect(consumeHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T16:03:00.000Z"),
      prisma: deps.prisma,
      request: consumeRequest(secondApproved, "delivery_current"),
    })).resolves.toEqual(secondApproved);
  });

  it("consumes approved legacy null-channel requests that used the old action hash", async () => {
    const { deps, memberId } = await setup();
    const legacyRequest = {
      actionFingerprint: REQUEST.actionFingerprint,
      actionId: REQUEST.actionId,
      actionKind: REQUEST.actionKind,
      presentation: REQUEST.presentation,
    };
    const requested = await requestHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T16:00:00.000Z"),
      prisma: deps.prisma,
      request: legacyRequest,
    });
    const legacyActionHash = hashLegacyNullReturnContactKindRequest({
      memberId,
      request: legacyRequest,
    });

    await deps.prisma.hostedSensitiveActionChallenge.update({
      data: {
        actionHash: legacyActionHash,
        approvalStatus: "approved",
        bindingHash: legacyActionHash,
        consumedAt: null,
        consumedBy: null,
        decidedAt: new Date("2026-06-25T16:01:00.000Z"),
        expiresAt: new Date("2026-06-25T16:16:00.000Z"),
        returnContactKind: null,
        tokenHash: `approval-token-${randomUUID()}`,
      },
      where: { approvalKey: requested.approvalId },
    });

    const approved = await requestHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T16:02:00.000Z"),
      prisma: deps.prisma,
      request: legacyRequest,
    });
    if (approved.status !== "approved") {
      throw new Error("Expected legacy hosted action approval to be approved.");
    }

    await expect(consumeHostedActionApproval({
      memberId,
      now: new Date("2026-06-25T16:03:00.000Z"),
      prisma: deps.prisma,
      request: {
        approvalGeneration: approved.approvalGeneration,
        consumerId: "legacy_delivery",
        request: legacyRequest,
      },
    })).resolves.toEqual(approved);

    const consumed = await requireApprovalRow(deps, requested.approvalId);
    expect(consumed.consumedAt?.toISOString()).toBe("2026-06-25T16:03:00.000Z");
    expect(consumed.consumedBy).toBe("legacy_delivery");
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

function verifiedApprovalChallenge(
  pending: Awaited<ReturnType<typeof requirePendingHostedActionApproval>>,
  memberId: string,
) {
  return {
    bindingHash: pending.bindingHash,
    expiresAt: pending.expiresAt,
    kind: "assistant.action.approve" as const,
    memberId,
    tokenHash: pending.tokenHash,
  };
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

function hashLegacyNullReturnContactKindRequest(input: {
  memberId: string;
  request: {
    actionFingerprint: string;
    actionId: string;
    actionKind: string;
    presentation: {
      body: string;
      title: string;
    };
  };
}): string {
  return createHash("sha256")
    .update([
      "murph-action-approval-request-hash-v1",
      input.memberId,
      JSON.stringify([
        "murph.hosted-action-approval-request.v1",
        input.request.actionId,
        input.request.actionKind,
        input.request.actionFingerprint,
        input.request.presentation.title,
        input.request.presentation.body,
      ]),
    ].join("\n"))
    .digest("hex");
}

async function requireApprovalRow(
  deps: HostedWebTestkitDeps,
  approvalId: string,
): Promise<HostedSensitiveActionChallengeForTest> {
  const row = await deps.prisma.hostedSensitiveActionChallenge.findFirst({
    where: { approvalKey: approvalId },
  });
  if (!row) {
    throw new Error(`Missing approval row: ${approvalId}`);
  }
  return row;
}
