import { HostedBillingStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  type HostedPrivyCompletionRepairDependencies,
  type HostedPrivyVerificationCompleter,
  withHostedPrivyCompletionRepairs,
} from "@/src/lib/hosted-onboarding/privy-completion-repair";

describe("Privy completion repairs", () => {
  it("surfaces secondary Telegram conflicts and restores recoverable incomplete billing", async () => {
    const result = buildCompletionResult({
      billingStatus: HostedBillingStatus.incomplete,
      stage: "checkout",
    });
    const complete: HostedPrivyVerificationCompleter = vi.fn(async () => result);
    const syncHostedMemberTelegramRoutingBinding = vi.fn(async () => {});
    const dependencies: HostedPrivyCompletionRepairDependencies = {
      readHostedMemberOwnsSubscription: vi.fn(async () => true),
      syncHostedMemberTelegramRoutingBinding,
    };

    const repaired = await withHostedPrivyCompletionRepairs(
      complete,
      dependencies,
    )({
      authMethod: "phone",
      identity: {
        phone: {
          number: "+15551234567",
          verifiedAt: 1_785_000_000,
        },
        telegram: {
          firstName: "Ada",
          lastName: null,
          photoUrl: null,
          telegramUserId: "42",
          username: "ada",
        },
        userId: "privy_ada",
      },
    });

    expect(repaired.stage).toBe("active");
    expect(syncHostedMemberTelegramRoutingBinding).toHaveBeenCalledWith({
      memberId: "member_ada",
      telegramUserId: "42",
    });
  });

  it("does not turn first-time incomplete checkout into recovery", async () => {
    const result = buildCompletionResult({
      billingStatus: HostedBillingStatus.incomplete,
      stage: "checkout",
    });
    const complete: HostedPrivyVerificationCompleter = vi.fn(async () => result);
    const dependencies: HostedPrivyCompletionRepairDependencies = {
      readHostedMemberOwnsSubscription: vi.fn(async () => false),
      syncHostedMemberTelegramRoutingBinding: vi.fn(async () => {}),
    };

    const repaired = await withHostedPrivyCompletionRepairs(
      complete,
      dependencies,
    )({
      authMethod: "phone",
      identity: {
        phone: {
          number: "+15551234567",
          verifiedAt: 1_785_000_000,
        },
        telegram: null,
        userId: "privy_ada",
      },
    });

    expect(repaired.stage).toBe("checkout");
    expect(dependencies.syncHostedMemberTelegramRoutingBinding).not.toHaveBeenCalled();
  });

  it("propagates a secondary Telegram ownership conflict", async () => {
    const conflict = new Error("telegram conflict");
    const complete: HostedPrivyVerificationCompleter = vi.fn(async () =>
      buildCompletionResult({
        billingStatus: HostedBillingStatus.not_started,
        stage: "checkout",
      })
    );
    const dependencies: HostedPrivyCompletionRepairDependencies = {
      readHostedMemberOwnsSubscription: vi.fn(async () => false),
      syncHostedMemberTelegramRoutingBinding: vi.fn(async () => {
        throw conflict;
      }),
    };

    await expect(withHostedPrivyCompletionRepairs(complete, dependencies)({
      authMethod: "email",
      identity: {
        email: {
          address: "ada@example.com",
          verifiedAt: 1_785_000_000,
        },
        phone: null,
        telegram: {
          firstName: "Ada",
          lastName: null,
          photoUrl: null,
          telegramUserId: "42",
          username: "ada",
        },
        userId: "privy_ada",
      },
    })).rejects.toBe(conflict);
  });
});

function buildCompletionResult(input: {
  billingStatus: HostedBillingStatus;
  stage: "active" | "activating" | "blocked" | "checkout";
}): Awaited<ReturnType<HostedPrivyVerificationCompleter>> {
  return {
    initialVisitEligible: false,
    inviteCode: "invite_ada",
    joinUrl: "https://withmurph.ai/join/invite_ada",
    member: {
      billingStatus: input.billingStatus,
      id: "member_ada",
      suspendedAt: null,
    },
    memberId: "member_ada",
    messagingSetupRequired: false,
    stage: input.stage,
  } as Awaited<ReturnType<HostedPrivyVerificationCompleter>>;
}
