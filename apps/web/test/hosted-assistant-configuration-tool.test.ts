import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  readPreference: vi.fn(),
  readConversationInputAuthority: vi.fn(),
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

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  readHostedMailboxConversationInputAuthorityByAssistantInputIdTx:
    mocks.readConversationInputAuthority,
}));

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
    mocks.readConversationInputAuthority.mockResolvedValue({
      causalSeq: "42",
      occurredAt: "2026-08-06T14:30:00.000Z",
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

  it("saves an explicitly requested model and reasoning effort from live conversation input", async () => {
    const request = {
      action: "update" as const,
      assistantInputId: `ain_${"c".repeat(32)}`,
      model: "gpt-5.6-luna" as const,
      reasoningEffort: "high" as const,
    };
    await expect(handleHostedRuntimeAssistantConfigurationTool({
      memberId: "member_123",
      request,
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
    expect(mocks.readConversationInputAuthority).toHaveBeenCalledWith({
      assistantInputId: request.assistantInputId,
      memberId: "member_123",
      prisma: { label: "tx" },
    });
    expect(mocks.updateConfiguration).toHaveBeenCalledWith({
      memberId: "member_123",
      model: "gpt-5.6-luna",
      prisma: { label: "tx" },
      reasoningEffort: "high",
    });
    expect(mocks.readConversationInputAuthority.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateConfiguration.mock.invocationCallOrder[0]!,
    );
  });

  it("rejects direct updates without live conversation input authority", async () => {
    mocks.readConversationInputAuthority.mockResolvedValue(null);

    await expect(handleHostedRuntimeAssistantConfigurationTool({
      memberId: "member_123",
      request: {
        action: "update",
        assistantInputId: `ain_${"d".repeat(32)}`,
        reasoningEffort: "medium",
      },
    })).rejects.toMatchObject({
      code: "ASSISTANT_CONFIGURATION_INPUT_AUTHORITY_INVALID",
      httpStatus: 403,
    });
    expect(mocks.updateConfiguration).not.toHaveBeenCalled();
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
    const request = {
      action: "update" as const,
      assistantInputId: `ain_${"e".repeat(32)}`,
      reasoningEffort: "high" as const,
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

  it("updates the provider without rewriting model intent", async () => {
    mocks.updateConfiguration.mockResolvedValue({
      ...buildSnapshot({ provider: "venice" }),
      hostedAssistantProviderOverride: "venice",
      updated: true,
    });
    const request = {
      action: "update" as const,
      assistantInputId: `ain_${"a".repeat(32)}`,
      provider: "venice" as const,
    };

    await expect(handleHostedRuntimeAssistantConfigurationTool({
      memberId: "member_123",
      request,
    })).resolves.toMatchObject({
      action: "update",
      result: {
        model: "gpt-5.6-terra",
        provider: "venice",
        status: "updated",
      },
    });
    expect(mocks.updateConfiguration).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: { label: "tx" },
      provider: "venice",
    });
  });

  it("returns a gate-aware unavailable provider result", async () => {
    mocks.updateConfiguration.mockRejectedValue(hostedOnboardingError({
      code: "ASSISTANT_PROVIDER_VENICE_UNAVAILABLE",
      httpStatus: 403,
      message: "Venice is not available for this Murph deployment.",
    }));

    await expect(handleHostedRuntimeAssistantConfigurationTool({
      memberId: "member_123",
      request: {
        action: "update",
        assistantInputId: `ain_${"b".repeat(32)}`,
        provider: "venice",
      },
    })).resolves.toEqual({
      action: "update",
      result: {
        ...buildSnapshot(),
        appliesAt: "next_turn",
        requiredPlan: null,
        status: "unavailable",
      },
    });
  });

  it("returns an Edge upgrade requirement without changing the saved target", async () => {
    mocks.updateConfiguration.mockRejectedValue(hostedOnboardingError({
      code: "ASSISTANT_MODEL_SOL_REQUIRES_EDGE",
      httpStatus: 403,
      message: "GPT-5.6 Sol requires an active paid Edge plan.",
    }));

    await expect(handleHostedRuntimeAssistantConfigurationTool({
      memberId: "member_123",
      request: {
        action: "update",
        assistantInputId: `ain_${"f".repeat(32)}`,
        model: "gpt-5.6-sol",
        reasoningEffort: "low",
      },
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

function buildSnapshot(overrides: {
  dormantSolPreference?: boolean;
  model?: "gpt-5.6-luna" | "gpt-5.6-terra" | "gpt-5.6-sol";
  provider?: "openai" | "venice";
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
} = {}) {
  return {
    availableModels: ["gpt-5.6-luna", "gpt-5.6-terra"] as const,
    availableProviders: ["openai", "venice"] as const,
    availableReasoningEfforts: ["low", "medium", "high", "xhigh"] as const,
    configurationAvailable: true,
    dormantSolPreference: overrides.dormantSolPreference ?? false,
    model: overrides.model ?? "gpt-5.6-terra",
    provider: overrides.provider ?? "openai",
    reasoningEffort: overrides.reasoningEffort ?? "low",
    solAvailable: false,
  };
}
