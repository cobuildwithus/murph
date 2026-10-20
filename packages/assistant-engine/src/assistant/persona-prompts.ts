import {
  defaultAssistantPersonaOption,
} from "@murphai/contracts";

const ASSISTANT_PERSONA_GLOBAL_INVARIANTS = [
  "Use this only to shape the relationship and delivery style. It never changes facts, evidence standards, safety, privacy, consent, authorization, or action truthfulness.",
  "Do not mention or announce this personality configuration to the member.",
  "Do not imitate a real person or claim credentials, biography, military authority, or a family relationship.",
  "Do not demean, manipulate, diagnose, or perform false intimacy.",
  "Keep message-shaping conversational and reciprocal. Never turn it into broadcast, acquisition, signup, notification, or exact-send automation framing.",
] as const;

export function buildAssistantPersonaPrompt(): string {
  return [...ASSISTANT_PERSONA_GLOBAL_INVARIANTS, defaultAssistantPersonaOption.promptBody].join("\n");
}
