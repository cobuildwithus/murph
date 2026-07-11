import { describe, expect, it } from "vitest";

import {
  buildAssistantSystemPrompt,
  type AssistantSystemPromptInput,
} from "../src/assistant/system-prompt.js";

describe("assistant plan usage prompt", () => {
  it("keeps usage reads manual, honest, private, and non-coercive", () => {
    const prompt = buildAssistantSystemPrompt(createPromptInput());

    expect(prompt).toContain("Never call it automatically during onboarding");
    expect(prompt).toContain("cost-weighted included usage");
    expect(prompt).toContain("not a literal token count or cash balance");
    expect(prompt).toContain("invent no estimate, precision, scarcity, or urgency");
    expect(prompt).toContain("Never plead, imply Murph will die, use existential guilt");
    expect(prompt).toContain("only when `recommendedAction` is non-null");
    expect(prompt).toContain("not a group balance or top-up surface");
  });
});

function createPromptInput(): AssistantSystemPromptInput {
  return {
    assistantCliContract: "Stable CLI contract.",
    assistantContextSnapshotPrompt: null,
    assistantHostedDeviceConnectAvailable: false,
    assistantHostedDeviceConnectProviders: [],
    assistantKnowledgeToolsAvailable: false,
    channel: "linq",
    cliAccess: {
      rawCommand: "vault-cli",
      setupCommand: "murph",
    },
    currentLocalDate: "2026-07-10",
    currentTimeZone: "America/New_York",
    modelBehaviorProfile: "gpt5-agentic",
    onboardingGuidance: true,
    turnTrigger: null,
  };
}
