import {
  isAssistantVoiceOptionId,
  type AssistantBasePersonaId,
  type AssistantPersonaId,
  type AssistantPersonalityPreferences,
  type AssistantPersonalityScores,
  type AssistantPreferences,
  type AssistantTonePreference,
  type AssistantVoiceOptionId,
} from "./preferences.ts";

export interface AssistantBasePersonaOption {
  defaultTone: AssistantTonePreference;
  defaultVoiceId: AssistantVoiceOptionId;
  description: string;
  id: AssistantBasePersonaId;
  label: string;
  personality: AssistantPersonalityScores;
  previewText: string;
  recommendedVoiceIds: readonly AssistantVoiceOptionId[];
  sample: string;
  supportDescription: string;
}

export interface AssistantPersonaOption
  extends Omit<AssistantBasePersonaOption, "id"> {
  id: AssistantPersonaId;
  mainId: AssistantBasePersonaId;
  promptBody: string;
  supportingId: AssistantBasePersonaId | null;
}

export interface AssistantEffectiveStyle {
  persona: AssistantPersonaId;
  personality: AssistantPersonalityScores;
  tone: AssistantTonePreference;
  voice: AssistantVoiceOptionId;
}

export const defaultAssistantPersonaId = "classic" satisfies AssistantPersonaId;

export const assistantBasePersonaOptions = [
  {
    defaultTone: "formal",
    defaultVoiceId: "upbeat",
    description: "Balanced, warm, and adaptable.",
    id: "classic",
    label: "Classic",
    personality: { humor: 3, push: 3, detail: 5, unhinged: 0 },
    previewText:
      "You missed the workout you planned. Want to do a shorter version now, or figure out what keeps breaking the plan?",
    recommendedVoiceIds: ["upbeat", "warm", "deep-calm", "classic", "expressive"],
    sample: "Be balanced and adapt to whatever I need.",
    supportDescription: "Adds balance and flexibility.",
  },
] as const satisfies readonly AssistantBasePersonaOption[];

export const defaultAssistantPersonaOption: AssistantPersonaOption = {
  ...assistantBasePersonaOptions[0],
  mainId: "classic",
  supportingId: null,
  promptBody:
    "Stay balanced, warm, capable, and adaptable. Lead with the most useful answer, read the member’s capacity, and adjust directness, detail, and encouragement without becoming bland or evasive.",
};

export const assistantPersonaOptions = [defaultAssistantPersonaOption];

export function resolveAssistantEffectiveStyle(
  preferences?: Pick<
    AssistantPreferences,
    "persona" | "personality" | "tone" | "voice"
  > | null,
): AssistantEffectiveStyle {
  const persona = defaultAssistantPersonaOption;
  const voice = isAssistantVoiceOptionId(preferences?.voice)
    ? preferences.voice
    : persona.defaultVoiceId;
  const personality: AssistantPersonalityScores = {
    ...persona.personality,
    ...(preferences?.personality ?? {}),
  };

  return {
    persona: persona.id,
    personality,
    tone: preferences?.tone ?? persona.defaultTone,
    voice,
  };
}

export function resolveAssistantEffectivePersonalityScores(input: {
  persona?: AssistantPersonaId | null;
  personality?: AssistantPersonalityPreferences | null;
}): AssistantPersonalityScores {
  return resolveAssistantEffectiveStyle({
    ...(input.persona ? { persona: input.persona } : {}),
    ...(input.personality ? { personality: input.personality } : {}),
  }).personality;
}
