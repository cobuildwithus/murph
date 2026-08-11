import { describe, expect, it } from "vitest";

import {
  HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION,
  hostedRuntimeAssistantPersonalizationModelToolRequestSchema,
  parseHostedRuntimeAssistantPersonalizationToolAuthority,
  parseHostedRuntimeAssistantPersonalizationToolRequest,
  parseHostedRuntimeAssistantPersonalizationToolResponse,
} from "../src/assistant-personalization.ts";

describe("hosted assistant personalization contract", () => {
  it("accepts only canonical accepted-input or scheduled-occurrence authority", () => {
    expect(parseHostedRuntimeAssistantPersonalizationToolAuthority({
      assistantInputId: "ain_0123456789abcdef0123456789abcdef",
      toolCallId: " call_style_one ",
    })).toEqual({
      assistantInputId: "ain_0123456789abcdef0123456789abcdef",
      toolCallId: "call_style_one",
    });
    expect(parseHostedRuntimeAssistantPersonalizationToolAuthority({
      automationId: "automation_daily_style",
      occurrenceAt: "2026-08-06T14:30:00.000Z",
      toolCallId: "call_style_two",
    })).toEqual({
      automationId: "automation_daily_style",
      occurrenceAt: "2026-08-06T14:30:00.000Z",
      toolCallId: "call_style_two",
    });

    for (const authority of [
      { assistantInputId: "input_1" },
      { assistantInputId: "ain_0123456789ABCDEF0123456789ABCDEF" },
      { automationId: "automation_daily_style" },
      { occurrenceAt: "2026-08-06T14:30:00.000Z" },
      {
        automationId: "automation_daily_style",
        occurrenceAt: "not-a-time",
      },
      { preferenceCausalSeq: "42" },
      {
        assistantInputId: "ain_0123456789abcdef0123456789abcdef",
        preferenceCausalSeq: "42",
      },
      {
        assistantInputId: "ain_0123456789abcdef0123456789abcdef",
        automationId: "automation_daily_style",
        occurrenceAt: "2026-08-06T14:30:00.000Z",
      },
      {
        assistantInputId: "ain_0123456789abcdef0123456789abcdef",
        toolCallId: "",
      },
    ]) {
      expect(() => parseHostedRuntimeAssistantPersonalizationToolAuthority(
        authority,
      )).toThrow();
    }
  });

  it("accepts strict read and non-empty update requests", () => {
    expect(parseHostedRuntimeAssistantPersonalizationToolRequest({
      action: "read",
    })).toEqual({ action: "read" });
    expect(parseHostedRuntimeAssistantPersonalizationToolRequest({
      action: "update",
      mainPersona: "scientist",
      supportingPersona: "classic",
      tone: "casual",
      voice: "warm",
    })).toEqual({
      action: "update",
      mainPersona: "scientist",
      supportingPersona: "classic",
      tone: "casual",
      voice: "warm",
    });
  });

  it("keeps sparse personality set/reset updates internal to transport", () => {
    const updateRequest = {
      action: HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION,
      personality: {
        detail: null,
        humor: 8,
      },
    } as const;

    expect(parseHostedRuntimeAssistantPersonalizationToolRequest(updateRequest))
      .toEqual(updateRequest);
    expect(hostedRuntimeAssistantPersonalizationModelToolRequestSchema.safeParse(
      updateRequest,
    ).success).toBe(false);
  });

  it("rejects the retired direct-vault causal-sequence action", () => {
    expect(() => parseHostedRuntimeAssistantPersonalizationToolRequest({
      action: "resolve_preference_causal_seq",
    })).toThrow();
  });

  it("rejects empty, unknown, and out-of-domain updates", () => {
    expect(() => parseHostedRuntimeAssistantPersonalizationToolRequest({
      action: "update",
    })).toThrow("requires a main persona, supporting persona, tone, or voice");
    expect(() => parseHostedRuntimeAssistantPersonalizationToolRequest({
      action: "update",
      mainPersona: "scientist",
    })).toThrow("require both main and supporting persona fields");
    expect(() => parseHostedRuntimeAssistantPersonalizationToolRequest({
      action: "update",
      supportingPersona: null,
    })).toThrow("require both main and supporting persona fields");
    expect(() => parseHostedRuntimeAssistantPersonalizationToolRequest({
      action: "update",
      mainPersona: "scientist",
      supportingPersona: "scientist",
    })).toThrow("Supporting persona must differ");
    expect(() => parseHostedRuntimeAssistantPersonalizationToolRequest({
      action: "read",
      tone: "casual",
    })).toThrow();
    expect(() => parseHostedRuntimeAssistantPersonalizationToolRequest({
      action: "update",
      model: "gpt-5.6-sol",
    })).toThrow();
    expect(() => parseHostedRuntimeAssistantPersonalizationToolRequest({
      action: HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION,
      personality: {},
    })).toThrow("requires at least one setting");
    expect(() => parseHostedRuntimeAssistantPersonalizationToolRequest({
      action: HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION,
      personality: { humor: 11 },
    })).toThrow();
    expect(() => parseHostedRuntimeAssistantPersonalizationToolRequest({
      action: HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION,
      personality: { humor: 2.5 },
    })).toThrow();
    expect(() => parseHostedRuntimeAssistantPersonalizationToolRequest({
      action: HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION,
      personality: { surprise: 4 },
    })).toThrow();
    expect(() => parseHostedRuntimeAssistantPersonalizationToolRequest({
      action: HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION,
      personality: { humor: 4 },
      tone: "casual",
    })).toThrow();
  });

  it("parses saved and unchanged tone/voice results with read-only model context", () => {
    expect(parseHostedRuntimeAssistantPersonalizationToolResponse({
      action: "update",
      result: {
        mainPersona: "scientist",
        model: "gpt-5.6-terra",
        modelChangeAppliesNextRun: false,
        modelUpdated: false,
        solAvailable: false,
        status: "saved",
        supportingPersona: "classic",
        tone: "formal",
        voice: "warm",
      },
    })).toEqual({
      action: "update",
      result: {
        mainPersona: "scientist",
        model: "gpt-5.6-terra",
        modelChangeAppliesNextRun: false,
        modelUpdated: false,
        solAvailable: false,
        status: "saved",
        supportingPersona: "classic",
        tone: "formal",
        voice: "warm",
      },
    });
    expect(parseHostedRuntimeAssistantPersonalizationToolResponse({
      action: "update",
      result: {
        mainPersona: "classic",
        model: "gpt-5.6-terra",
        modelChangeAppliesNextRun: false,
        modelUpdated: false,
        solAvailable: true,
        status: "unchanged",
        supportingPersona: null,
        tone: "formal",
        voice: "warm",
      },
    })).toMatchObject({
      result: {
        status: "unchanged",
      },
    });
  });

  it("requires effective non-null tone and voice values in tool responses", () => {
    expect(() => parseHostedRuntimeAssistantPersonalizationToolResponse({
      action: "read",
      result: {
        mainPersona: "classic",
        model: "gpt-5.6-terra",
        solAvailable: false,
        supportingPersona: null,
        tone: null,
        voice: "upbeat",
      },
    })).toThrow();
    expect(() => parseHostedRuntimeAssistantPersonalizationToolResponse({
      action: "read",
      result: {
        mainPersona: "classic",
        model: "gpt-5.6-terra",
        solAvailable: false,
        supportingPersona: null,
        tone: "formal",
        voice: null,
      },
    })).toThrow();
  });

  it("parses full effective personality settings and field-local update outcomes", () => {
    const settings = {
      detail: { source: "default", value: 5 },
      humor: { source: "custom", value: 8 },
      push: { source: "default", value: 3 },
      unhinged: { source: "default", value: 0 },
    } as const;

    expect(parseHostedRuntimeAssistantPersonalizationToolResponse({
      action: HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION,
      result: {
        outcomes: {
          detail: "unchanged",
          humor: "superseded",
          push: "saved",
        },
        settings,
      },
    })).toEqual({
      action: HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION,
      result: {
        outcomes: {
          detail: "unchanged",
          humor: "superseded",
          push: "saved",
        },
        settings,
      },
    });
  });

  it("rejects incomplete personality snapshots, empty outcomes, and extra fields", () => {
    const settings = {
      detail: { source: "default", value: 5 },
      humor: { source: "custom", value: 8 },
      push: { source: "default", value: 3 },
      unhinged: { source: "default", value: 0 },
    } as const;

    for (const response of [
      {
        action: HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION,
        result: {
          outcomes: { humor: "superseded" },
          settings: {
            humor: settings.humor,
            push: settings.push,
          },
        },
      },
      {
        action: HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION,
        result: {
          outcomes: {},
          settings,
        },
      },
      {
        action: HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION,
        result: {
          outcomes: { humor: "saved" },
          settings,
          updated: true,
        },
      },
    ]) {
      expect(() => parseHostedRuntimeAssistantPersonalizationToolResponse(response))
        .toThrow();
    }

    expect(parseHostedRuntimeAssistantPersonalizationToolResponse({
      action: HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION,
      result: {
        outcomes: { humor: "unchanged" },
        settings: {
          ...settings,
          humor: { source: "default", value: 8 },
        },
      },
    })).toMatchObject({
      result: {
        settings: {
          humor: { source: "default", value: 8 },
        },
      },
    });
  });

  it("rejects impossible model, rejection, and duplicate update states", () => {
    const validResult = {
      mainPersona: "classic",
      model: "gpt-5.6-terra",
      modelChangeAppliesNextRun: false,
      modelUpdated: false,
      solAvailable: true,
      status: "saved",
      supportingPersona: null,
      tone: "formal",
      voice: "warm",
    } as const;

    for (const result of [
      { ...validResult, modelUpdated: true },
      { ...validResult, modelChangeAppliesNextRun: true },
      { ...validResult, rejectionReason: "sol_requires_edge" },
      { ...validResult, status: "rejected" },
      { ...validResult, styleUpdated: true },
      { ...validResult, updated: true },
    ]) {
      expect(() => parseHostedRuntimeAssistantPersonalizationToolResponse({
        action: "update",
        result,
      })).toThrow();
    }
  });
});
