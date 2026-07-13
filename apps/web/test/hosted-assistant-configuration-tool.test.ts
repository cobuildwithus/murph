import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeApproval: vi.fn(),
  getPrisma: vi.fn(),
  readPreference: vi.fn(),
  transaction: vi.fn(),
  updateConfiguration: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/assistant-model-preference", () => ({
  readHostedMemberAssistantModelPreference: mocks.readPreference,
  updateHostedMemberAssistantConfigurationTx: mocks.updateConfiguration,
}));

vi.mock("@/src/lib/action-approvals", () => ({
  consumeHostedActionApproval: mocks.consumeApproval,
}));

import {
  buildHostedAssistantConfigurationApprovalConsumerId,
  buildHostedAssistantConfigurationApprovalRequest,
} from "@murphai/hosted-execution/assistant-configuration-approval";

import {
  handleHostedRuntimeAssistantConfigurationTool,
} from "@/src/lib/hosted-execution/assistant-configuration-tool";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

describe("hosted runtime assistant configuration tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => (
        callback({ label: "tx" })
      ),
    );
    mocks.getPrisma.mockReturnValue({
      $transaction: mocks.transaction,
    });
    mocks.readPreference.mockResolvedValue(buildSnapshot());
    mocks.consumeApproval.mockResolvedValue({
      approvalGeneration: "b".repeat(64),
      approvalId: `haa_${"a".repeat(32)}`,
      status: "approved",
    });
    mocks.updateConfiguration.mockResolvedValue({
      ...buildSnapshot({
        model: "gpt-5.6-luna",
        reasoningEffort: "high",
      }),
      hostedAssistantModelOverride: "gpt-5.6-luna",
      hostedAssistantReasoningEffortOverride: "high",
      updated: true,
    });
  });

  it("reads the canonical saved target and available choices", async () => {
    await expect(handleHostedRuntimeAssistantConfigurationTool({
      memberId: "member_123",
      request: { action: "read" },
    })).resolves.toEqual({
      action: "read",
      result: buildSnapshot(),
    });
    expect(mocks.readPreference).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: expect.any(Object),
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("saves an explicitly requested model and reasoning effort for the next turn", async () => {
    await expect(handleHostedRuntimeAssistantConfigurationTool({
      memberId: "member_123",
      request: buildUpdateRequest({
        model: "gpt-5.6-luna",
        reasoningEffort: "high",
      }),
    })).resolves.toEqual({
      action: "update",
      result: {
        ...buildSnapshot({
          model: "gpt-5.6-luna",
          reasoningEffort: "high",
        }),
        appliesAt: "next_turn",
        requiredPlan: null,
        status: "updated",
      },
    });
    expect(mocks.consumeApproval).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: { label: "tx" },
      request: buildUpdateRequest({
        model: "gpt-5.6-luna",
        reasoningEffort: "high",
      }).approval,
    });
    expect(mocks.updateConfiguration).toHaveBeenCalledWith({
      memberId: "member_123",
      model: "gpt-5.6-luna",
      prisma: { label: "tx" },
      reasoningEffort: "high",
    });
    expect(mocks.consumeApproval.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateConfiguration.mock.invocationCallOrder[0]!,
    );
  });

  it("updates reasoning without rewriting a dormant model preference", async () => {
    mocks.updateConfiguration.mockResolvedValue({
      ...buildSnapshot({
        model: "gpt-5.6-terra",
        reasoningEffort: "high",
      }),
      hostedAssistantReasoningEffortOverride: "high",
      updated: true,
    });
    const target = {
      model: "gpt-5.6-terra" as const,
      reasoningEffort: "high" as const,
    };
    const approvalRequest = buildHostedAssistantConfigurationApprovalRequest({
      changes: { reasoningEffort: "high" },
      returnContactKind: "text",
      target,
    });
    const request = {
      action: "update" as const,
      approval: {
        approvalGeneration: "b".repeat(64),
        consumerId: buildHostedAssistantConfigurationApprovalConsumerId(
          approvalRequest,
        ),
        request: approvalRequest,
      },
      reasoningEffort: "high" as const,
      target,
    };

    await expect(handleHostedRuntimeAssistantConfigurationTool({
      memberId: "member_123",
      request,
    })).resolves.toMatchObject({
      action: "update",
      result: {
        model: "gpt-5.6-terra",
        reasoningEffort: "high",
        status: "updated",
      },
    });
    expect(mocks.updateConfiguration).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: { label: "tx" },
      reasoningEffort: "high",
    });
  });

  it("rejects approval for a different exact target before opening a transaction", async () => {
    const request = buildUpdateRequest({
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
    });

    await expect(handleHostedRuntimeAssistantConfigurationTool({
      memberId: "member_123",
      request: {
        ...request,
        target: {
          ...request.target,
          model: "gpt-5.6-terra",
        },
      },
    })).rejects.toMatchObject({
      code: "ACTION_APPROVAL_UNAVAILABLE",
      httpStatus: 403,
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.consumeApproval).not.toHaveBeenCalled();
    expect(mocks.updateConfiguration).not.toHaveBeenCalled();
  });

  it("rolls back when current state no longer resolves to the approved target", async () => {
    mocks.updateConfiguration.mockResolvedValue({
      ...buildSnapshot({
        model: "gpt-5.6-luna",
        reasoningEffort: "high",
      }),
      hostedAssistantModelOverride: "gpt-5.6-luna",
      hostedAssistantReasoningEffortOverride: "high",
      updated: true,
    });
    const request = buildUpdateRequest({
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
    });

    await expect(handleHostedRuntimeAssistantConfigurationTool({
      memberId: "member_123",
      request,
    })).rejects.toMatchObject({
      code: "ACTION_APPROVAL_UNAVAILABLE",
      httpStatus: 403,
    });
    expect(mocks.consumeApproval).toHaveBeenCalledOnce();
    expect(mocks.updateConfiguration).toHaveBeenCalledOnce();
  });

  it("does not update when approval cannot be consumed", async () => {
    mocks.consumeApproval.mockResolvedValue({
      approvalId: `haa_${"a".repeat(32)}`,
      status: "expired",
    });

    await expect(handleHostedRuntimeAssistantConfigurationTool({
      memberId: "member_123",
      request: buildUpdateRequest({
        model: "gpt-5.6-luna",
        reasoningEffort: "high",
      }),
    })).rejects.toMatchObject({
      code: "ACTION_APPROVAL_UNAVAILABLE",
      httpStatus: 403,
    });
    expect(mocks.updateConfiguration).not.toHaveBeenCalled();
  });

  it("returns an Edge upgrade requirement without changing the saved target", async () => {
    mocks.updateConfiguration.mockRejectedValue(hostedOnboardingError({
      code: "ASSISTANT_MODEL_SOL_REQUIRES_EDGE",
      httpStatus: 403,
      message: "GPT-5.6 Sol requires an active paid Edge plan.",
    }));

    await expect(handleHostedRuntimeAssistantConfigurationTool({
      memberId: "member_123",
      request: buildUpdateRequest({
        model: "gpt-5.6-sol",
        reasoningEffort: "low",
      }),
    })).resolves.toEqual({
      action: "update",
      result: {
        ...buildSnapshot(),
        appliesAt: "next_turn",
        requiredPlan: "edge",
        status: "upgrade_required",
      },
    });
  });
});

function buildUpdateRequest(input: {
  model: "gpt-5.6-luna" | "gpt-5.6-terra" | "gpt-5.6-sol";
  reasoningEffort: "low" | "medium" | "high" | "xhigh";
}) {
  const approvalRequest = buildHostedAssistantConfigurationApprovalRequest({
    changes: input,
    returnContactKind: "text",
    target: input,
  });
  return {
    action: "update" as const,
    approval: {
      approvalGeneration: "b".repeat(64),
      consumerId: buildHostedAssistantConfigurationApprovalConsumerId(
        approvalRequest,
      ),
      request: approvalRequest,
    },
    ...input,
    target: input,
  };
}

function buildSnapshot(overrides: {
  dormantSolPreference?: boolean;
  model?: "gpt-5.6-luna" | "gpt-5.6-terra" | "gpt-5.6-sol";
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
} = {}) {
  return {
    availableModels: ["gpt-5.6-luna", "gpt-5.6-terra"] as const,
    availableReasoningEfforts: ["low", "medium", "high", "xhigh"] as const,
    configurationAvailable: true,
    dormantSolPreference: overrides.dormantSolPreference ?? false,
    model: overrides.model ?? "gpt-5.6-terra",
    reasoningEffort: overrides.reasoningEffort ?? "low",
    solAvailable: false,
  };
}
