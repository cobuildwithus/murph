import { expect, it } from "vitest";
import { buildAssistantSystemPrompt } from "../src/assistant/system-prompt.js";
it.each([false, true])("composes canonical demographic persistence without gender inference (onboarding=%s)", onboardingGuidance => {
  const prompt = buildAssistantSystemPrompt({ assistantCliContract: null, assistantContextSnapshotPrompt: null,
    channel: "linq", cliAccess: { rawCommand: "vault-cli" }, conversationScope: "direct",
    currentLocalDate: "2026-01-01", currentTimeZone: "UTC", hostedRuntime: true,
    modelBehaviorProfile: "gpt5-agentic", onboardingGuidance, ordinaryInboundTurn: true,
  });
  expect(prompt).toContain("vault-cli memory set-demographics");
  expect(prompt).toContain("source statement date");
  expect(prompt).toContain("never from gender, names, or pronouns");
  expect(prompt).toContain("Age stays a dated approximate fact");
  expect(prompt).toContain("unresolved receipt");
  expect(prompt).not.toContain("Identity or Context memory for optional demographics");
});
