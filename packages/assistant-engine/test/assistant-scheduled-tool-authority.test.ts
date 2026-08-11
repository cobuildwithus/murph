import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { describe, expect, it, vi } from "vitest";

const preferenceMocks = vi.hoisted(() => ({
  showAssistantPersonality: vi.fn(async () => ({
    settings: {
      detail: { source: "default", value: 5 },
      humor: { source: "default", value: 5 },
      push: { source: "default", value: 5 },
      unhinged: { source: "default", value: 0 },
    },
    updated: false,
  })),
}));

vi.mock("@murphai/vault-usecases/preferences", () => ({
  ...preferenceMocks,
  resetAllAssistantPersonalitySettings: vi.fn(),
  resetAssistantPersonalitySetting: vi.fn(),
  setAssistantPersonalitySetting: vi.fn(),
}));

import {
  executeMurphDynamicToolRequest,
} from "../src/assistant-codex/dynamic-tools.ts";
import {
  createAssistantHostedScheduledRequestKey,
  resolveAssistantHostedScheduledInvocationScope,
  type AssistantHostedScheduledInvocationScope,
  type AssistantHostedToolContext,
} from "../src/assistant/hosted-tool-context.ts";

const OCCURRENCE_AT = "2026-08-06T14:30:00.000Z";

describe("scheduled assistant tool authority", () => {
  it("represents an exact cron occurrence without fabricating an assistant input", () => {
    const exact = scheduledScope();
    const replay = scheduledScope();
    const next = scheduledScope("2026-08-07T14:30:00.000Z");

    expect(exact).toEqual(replay);
    expect(exact.origin).toEqual({
      automationId: "automation_scheduled_tools",
      kind: "automation_occurrence",
      occurrenceAt: OCCURRENCE_AT,
    });
    expect(next.origin).not.toEqual(exact.origin);
    expect(JSON.stringify(exact)).not.toMatch(/ain_[0-9a-f]{32}/u);
    expect(createAssistantHostedScheduledRequestKey({
      operation: "clinical-records-connect-link",
      origin: replay.origin,
    })).toBe(createAssistantHostedScheduledRequestKey({
      operation: "clinical-records-connect-link",
      origin: exact.origin,
    }));
    expect(createAssistantHostedScheduledRequestKey({
      operation: "clinical-records-connect-link",
      origin: next.origin,
    })).not.toBe(createAssistantHostedScheduledRequestKey({
      operation: "clinical-records-connect-link",
      origin: exact.origin,
    }));
    expect(resolveAssistantHostedScheduledInvocationScope({
      conversationScope: "direct",
      messageInput: {
        scheduledInvocationAuthority: {
          automationId: "automation_scheduled_tools",
          occurrenceAt: OCCURRENCE_AT,
        },
        scheduledOccurrenceAt: "2026-08-06T14:31:00.000Z",
        turnTrigger: "automation-cron",
      },
      originSessionId: "session_scheduled_tools",
    })).toBeNull();
  });

  it("uses scheduled authority for Clinical Records and personalization mutations", async () => {
    const scope = scheduledScope();
    const createConnectLink = vi.fn(async () => ({
      connectUrl:
        `https://withmurph.ai/records/connect#clinicalRecordsIntent=cr_${"a".repeat(32)}`,
      expiresAt: "2026-08-06T14:45:00.000Z",
      ok: true as const,
    }));
    const personalizationRequest = vi.fn(async () => ({
      action: "update" as const,
      result: {
        mainPersona: "classic" as const,
        model: "gpt-5.6-terra" as const,
        modelChangeAppliesNextRun: false as const,
        modelUpdated: false as const,
        solAvailable: true,
        status: "saved" as const,
        supportingPersona: null,
        tone: "casual" as const,
        voice: "warm" as const,
      },
    }));
    const context = hostedToolContext(scope, {
      clinicalRecordsConnectLinkTool: { createConnectLink },
      personalizationTool: { request: personalizationRequest },
    });

    const clinical = parseTool("create_clinical_records_connect_link", {});
    const personalization = parseTool("personalization", {
      action: "update",
      tone: "casual",
    });
    const clinicalResult = await execute(clinical, context);
    const personalizationResult = await execute(personalization, context);

    expect(clinicalResult.rpcResult.success).toBe(true);
    expect(createConnectLink).toHaveBeenCalledWith({
      requestKey: expect.stringMatching(/^scheduled_[0-9a-f]{64}$/u),
      signal: null,
    });
    expect(personalizationResult.rpcResult.success).toBe(true);
    expect(personalizationRequest).toHaveBeenCalledWith(
      { action: "update", tone: "casual" },
      {
        automationId: "automation_scheduled_tools",
        occurrenceAt: OCCURRENCE_AT,
        toolCallId: "call-test",
      },
    );
  });

  it("uses scheduled authority for assistant-style mutations", async () => {
    const scope = scheduledScope();
    const personalizationRequest = vi.fn(async () => ({
      action: "update_personality" as const,
      result: {
        outcomes: { humor: "saved" as const },
        settings: {
          detail: { source: "default" as const, value: 5 },
          humor: { source: "custom" as const, value: 8 },
          push: { source: "default" as const, value: 5 },
          unhinged: { source: "default" as const, value: 0 },
        },
      },
    }));
    const context = hostedToolContext(scope, {
      personalizationTool: { request: personalizationRequest },
    });
    const request = parseTool("assistant_style", {
      action: "set",
      setting: "humor",
      value: 8,
    });

    const result = await executeMurphDynamicToolRequest({
      assistantStyleSettingsAvailable: true,
      env: {},
      fetchImpl: fetch,
      hostedToolContext: context,
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
      vaultRoot: "/tmp/scheduled-style-vault",
    });

    expect(result.rpcResult.success).toBe(true);
    expect(personalizationRequest).toHaveBeenCalledWith(
      {
        action: "update_personality",
        personality: { humor: 8 },
      },
      {
        automationId: "automation_scheduled_tools",
        occurrenceAt: OCCURRENCE_AT,
        toolCallId: "call-test",
      },
    );
  });

  it("keeps scheduled image generation synchronous and message-free", async () => {
    const scope = scheduledScope();
    const launch = vi.fn(() => "started" as const);
    const context = hostedToolContext(scope, {
      imageGenerationLauncher: { launch },
    });
    const request = parseTool("generate_image", {
      prompt: "A handwritten thank-you note",
    });

    const result = await execute(request, context, {
      vaultRoot: "/tmp/scheduled-image-vault",
    });

    expect(result.rpcResult).toEqual({
      success: false,
      contentItems: [{
        text: "OPENAI_API_KEY is required for image generation",
        type: "inputText",
      }],
    });
    expect(launch).not.toHaveBeenCalled();
    expect(JSON.stringify(launch.mock.calls)).not.toMatch(
      /originAssistantInputId/u,
    );
  });
});

function scheduledScope(
  occurrenceAt = OCCURRENCE_AT,
): AssistantHostedScheduledInvocationScope {
  const scope = resolveAssistantHostedScheduledInvocationScope({
    conversationScope: "direct",
    messageInput: {
      scheduledInvocationAuthority: {
        automationId: "automation_scheduled_tools",
        occurrenceAt,
      },
      scheduledOccurrenceAt: occurrenceAt,
      turnTrigger: "automation-cron",
    },
    originSessionId: "session_scheduled_tools",
  });
  if (!scope) throw new Error("Expected scheduled invocation scope.");
  return scope;
}

function hostedToolContext(
  scope: AssistantHostedScheduledInvocationScope,
  additions: Partial<AssistantHostedToolContext> = {},
): AssistantHostedToolContext {
  return {
    ...additions,
    computerToolsAvailable: false,
    currentAssistantInputId: () => null,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    currentInvocationScope: () => scope,
    currentUserActionScope: () => null,
    sendVaultFile: async () => {
      throw new Error("unavailable");
    },
    vaultFileSendAvailable: false,
  };
}

function parseTool(tool: string, args: unknown) {
  const request = readTestMurphDynamicToolRequest({
    method: "item/tool/call",
    params: {
      arguments: args,
      namespace: "murph",
      tool,
    },
  });
  if (!request) throw new Error(`Expected ${tool} request.`);
  return request;
}

async function execute(
  request: NonNullable<ReturnType<typeof readTestMurphDynamicToolRequest>>,
  hostedToolContext: AssistantHostedToolContext,
  options: { vaultRoot?: string } = {},
) {
  return await executeMurphDynamicToolRequest({
    env: {},
    fetchImpl: fetch,
    hostedToolContext,
    nextUsageOrdinal: () => 0,
    progressDelivery: null,
    request,
    ...(options.vaultRoot ? { vaultRoot: options.vaultRoot } : {}),
  });
}
