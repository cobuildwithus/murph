import { describe, expect, it } from "vitest";

import {
  parseHostedRuntimeAssistantPersonalizationToolRequest,
  parseHostedRuntimeAssistantPersonalizationToolResponse,
} from "../src/assistant-personalization.ts";

describe("hosted assistant personalization contract", () => {
  it("accepts strict read and non-empty update requests", () => {
    expect(parseHostedRuntimeAssistantPersonalizationToolRequest({
      action: "read",
    })).toEqual({ action: "read" });
    expect(parseHostedRuntimeAssistantPersonalizationToolRequest({
      action: "update",
      tone: "casual",
      voice: "warm",
    })).toEqual({
      action: "update",
      tone: "casual",
      voice: "warm",
    });
  });

  it("rejects empty, unknown, and out-of-domain updates", () => {
    expect(() => parseHostedRuntimeAssistantPersonalizationToolRequest({
      action: "update",
    })).toThrow("requires a tone or voice");
    expect(() => parseHostedRuntimeAssistantPersonalizationToolRequest({
      action: "read",
      tone: "casual",
    })).toThrow();
    expect(() => parseHostedRuntimeAssistantPersonalizationToolRequest({
      action: "update",
      model: "gpt-5.6-sol",
    })).toThrow();
  });

  it("parses saved, unchanged, and safely rejected effective results", () => {
    expect(parseHostedRuntimeAssistantPersonalizationToolResponse({
      action: "update",
      result: {
        model: "gpt-5.6-terra",
        modelChangeAppliesNextRun: false,
        modelUpdated: false,
        rejectionReason: null,
        solAvailable: false,
        status: "saved",
        styleUpdated: false,
        tone: "formal",
        updated: true,
        voice: "warm",
      },
    })).toMatchObject({
      result: {
        modelUpdated: false,
        status: "saved",
        updated: true,
      },
    });
    expect(parseHostedRuntimeAssistantPersonalizationToolResponse({
      action: "update",
      result: {
        model: "gpt-5.6-sol",
        modelChangeAppliesNextRun: true,
        modelUpdated: true,
        rejectionReason: null,
        solAvailable: true,
        status: "saved",
        styleUpdated: false,
        tone: "formal",
        updated: true,
        voice: "warm",
      },
    })).toMatchObject({
      action: "update",
      result: {
        modelChangeAppliesNextRun: true,
        status: "saved",
      },
    });
    expect(parseHostedRuntimeAssistantPersonalizationToolResponse({
      action: "update",
      result: {
        model: "gpt-5.6-terra",
        modelChangeAppliesNextRun: false,
        modelUpdated: false,
        rejectionReason: null,
        solAvailable: true,
        status: "unchanged",
        styleUpdated: false,
        tone: "formal",
        updated: false,
        voice: "warm",
      },
    })).toMatchObject({
      result: {
        status: "unchanged",
        updated: false,
      },
    });
    expect(parseHostedRuntimeAssistantPersonalizationToolResponse({
      action: "update",
      result: {
        model: "gpt-5.6-terra",
        modelChangeAppliesNextRun: false,
        modelUpdated: false,
        rejectionReason: "sol_requires_edge",
        solAvailable: false,
        status: "rejected",
        styleUpdated: false,
        tone: "formal",
        updated: false,
        voice: "warm",
      },
    })).toMatchObject({
      result: {
        model: "gpt-5.6-terra",
        rejectionReason: "sol_requires_edge",
        updated: false,
      },
    });
  });

  it("requires effective non-null tone and voice values in tool responses", () => {
    expect(() => parseHostedRuntimeAssistantPersonalizationToolResponse({
      action: "read",
      result: {
        model: "gpt-5.6-terra",
        solAvailable: false,
        tone: null,
        voice: "upbeat",
      },
    })).toThrow();
    expect(() => parseHostedRuntimeAssistantPersonalizationToolResponse({
      action: "read",
      result: {
        model: "gpt-5.6-terra",
        solAvailable: false,
        tone: "formal",
        voice: null,
      },
    })).toThrow();
  });

  it("rejects response statuses that misrepresent effective changes", () => {
    expect(() => parseHostedRuntimeAssistantPersonalizationToolResponse({
      action: "update",
      result: {
        model: "gpt-5.6-terra",
        modelChangeAppliesNextRun: false,
        modelUpdated: false,
        rejectionReason: null,
        solAvailable: true,
        status: "saved",
        styleUpdated: false,
        tone: "formal",
        updated: false,
        voice: "warm",
      },
    })).toThrow("status must match");
    expect(() => parseHostedRuntimeAssistantPersonalizationToolResponse({
      action: "update",
      result: {
        model: "gpt-5.6-sol",
        modelChangeAppliesNextRun: false,
        modelUpdated: true,
        rejectionReason: null,
        solAvailable: true,
        status: "saved",
        styleUpdated: false,
        tone: "formal",
        updated: true,
        voice: "warm",
      },
    })).toThrow("next-run state");
  });
});
