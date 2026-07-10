import { z } from "zod";

import { withContractMetadata } from "./schema-metadata.ts";

export const preferencesDocumentRelativePath = "bank/preferences.json";
export const preferencesDocumentSchemaVersion = 1;

export const assistantTonePreferenceValues = ["casual", "formal"] as const;
export const assistantTonePreferenceSchema = z.enum(assistantTonePreferenceValues);

export const assistantPersonalitySettingIds = ["humor", "push", "detail"] as const;
export const assistantPersonalitySettingSchema = z.enum(assistantPersonalitySettingIds);
export const assistantPersonalityScoreSchema = z.number().int().min(0).max(10);
export const assistantPersonalityPreferencesSchema = z
  .object({
    humor: assistantPersonalityScoreSchema.optional(),
    push: assistantPersonalityScoreSchema.optional(),
    detail: assistantPersonalityScoreSchema.optional(),
  })
  .strict();
export const assistantPersonalityScoresSchema = z
  .object({
    humor: assistantPersonalityScoreSchema,
    push: assistantPersonalityScoreSchema,
    detail: assistantPersonalityScoreSchema,
  })
  .strict();

export type AssistantPersonalitySettingId = z.infer<typeof assistantPersonalitySettingSchema>;
export type AssistantPersonalityPreferences = z.infer<typeof assistantPersonalityPreferencesSchema>;
export type AssistantPersonalityScores = z.infer<typeof assistantPersonalityScoresSchema>;

export const defaultAssistantPersonalityScores = Object.freeze({
  humor: 3,
  push: 3,
  detail: 5,
}) satisfies AssistantPersonalityScores;

export const assistantVoiceOptionIdValues = [
  "classic",
  "drill-sergeant",
  "grandpa",
  "country",
  "jamaican",
  "radio-host",
  "deep-calm",
  "warm",
  "husky",
  "storyteller",
  "british-warm",
  "late-night",
  "easygoing",
  "northern",
  "football-announcer",
  "sweet",
  "mysterious",
  "upbeat",
  "narrator",
  "expressive",
  "bubbly",
  "smooth",
] as const;
export const assistantVoiceOptionIdSchema = z.enum(assistantVoiceOptionIdValues);
export const assistantVoiceGenderValues = ["male", "female"] as const;
export const assistantVoiceGenderSchema = z.enum(assistantVoiceGenderValues);

export interface AssistantVoiceOption {
  description: string;
  elevenLabsVoiceId: string | null;
  gender: AssistantVoiceGender;
  id: AssistantVoiceOptionId;
  label: string;
  previewPath: string;
}

export const assistantVoiceOptions = [
  {
    description: "Clear, positive, and energetic.",
    elevenLabsVoiceId: "tnSpp4vdxKPjI9w0GnoV",
    gender: "female",
    id: "upbeat",
    label: "Classic Murph",
    previewPath: "/audio/murph-voices/upbeat.mp3",
  },
  {
    description: "Quick, wry, and a little nerdy.",
    elevenLabsVoiceId: null,
    gender: "male",
    id: "classic",
    label: "New York",
    previewPath: "/audio/murph-voices/classic.mp3",
  },
  {
    description: "Direct, intense, and commanding.",
    elevenLabsVoiceId: "DGzg6RaUqxGRTHSBjfgF",
    gender: "male",
    id: "drill-sergeant",
    label: "Drill sergeant",
    previewPath: "/audio/murph-voices/drill-sergeant.mp3",
  },
  {
    description: "Warm, older, and familiar.",
    elevenLabsVoiceId: "NOpBlnGInO9m6vDvFkFC",
    gender: "male",
    id: "grandpa",
    label: "Grandpa",
    previewPath: "/audio/murph-voices/grandpa.mp3",
  },
  {
    description: "Deep, raspy, and Texas-flavored.",
    elevenLabsVoiceId: "Bj9UqZbhQsanLzgalpEG",
    gender: "male",
    id: "country",
    label: "Country",
    previewPath: "/audio/murph-voices/country.mp3",
  },
  {
    description: "Deep and island-inflected.",
    elevenLabsVoiceId: "dhwafD61uVd8h85wAZSE",
    gender: "male",
    id: "jamaican",
    label: "Jamaican, deep",
    previewPath: "/audio/murph-voices/jamaican.mp3",
  },
  {
    description: "Polished, broadcast-ready, and British.",
    elevenLabsVoiceId: "nrD2uNU2IUYtedZegcGx",
    gender: "male",
    id: "radio-host",
    label: "Radio host",
    previewPath: "/audio/murph-voices/radio-host.mp3",
  },
  {
    description: "Low, even, and steady.",
    elevenLabsVoiceId: "Gubgw9l4dtIoQA9YZHgx",
    gender: "male",
    id: "deep-calm",
    label: "Deep and calming",
    previewPath: "/audio/murph-voices/deep-calm.mp3",
  },
  {
    description: "Soft, friendly, and conversational.",
    elevenLabsVoiceId: "EST9Ui6982FZPSi7gCHi",
    gender: "female",
    id: "warm",
    label: "Warm and friendly",
    previewPath: "/audio/murph-voices/warm.mp3",
  },
  {
    description: "Raspy, confident, and bold.",
    elevenLabsVoiceId: "EkK5I93UQWFDigLMpZcX",
    gender: "male",
    id: "husky",
    label: "Husky and bold",
    previewPath: "/audio/murph-voices/husky.mp3",
  },
  {
    description: "Measured, narrative, and British.",
    elevenLabsVoiceId: "NNl6r8mD7vthiJatiJt1",
    gender: "male",
    id: "storyteller",
    label: "British storyteller",
    previewPath: "/audio/murph-voices/storyteller.mp3",
  },
  {
    description: "Warm, clear, and British.",
    elevenLabsVoiceId: "exsUS4vynmxd379XN4yO",
    gender: "female",
    id: "british-warm",
    label: "British, warm",
    previewPath: "/audio/murph-voices/british-warm.mp3",
  },
  {
    description: "Calm, neutral, and late-night.",
    elevenLabsVoiceId: "BpjGufoPiobT79j2vtj4",
    gender: "female",
    id: "late-night",
    label: "Late night radio",
    previewPath: "/audio/murph-voices/late-night.mp3",
  },
  {
    description: "Casual, relaxed, and light.",
    elevenLabsVoiceId: "1SM7GgM6IMuvQlz2BwM3",
    gender: "male",
    id: "easygoing",
    label: "Easygoing",
    previewPath: "/audio/murph-voices/easygoing.mp3",
  },
  {
    description: "Distinctive, offbeat, and northern.",
    elevenLabsVoiceId: "wo6udizrrtpIxWGp2qJk",
    gender: "male",
    id: "northern",
    label: "Eccentric northerner",
    previewPath: "/audio/murph-voices/northern.mp3",
  },
  {
    description: "Big, energetic, and game-day.",
    elevenLabsVoiceId: "gU0LNdkMOQCOrPrwtbee",
    gender: "male",
    id: "football-announcer",
    label: "Football announcer",
    previewPath: "/audio/murph-voices/football-announcer.mp3",
  },
  {
    description: "Gentle, natural, and sweet.",
    elevenLabsVoiceId: "OZxMHsGaBmV5pjMIDIn0",
    gender: "female",
    id: "sweet",
    label: "Sweet and natural",
    previewPath: "/audio/murph-voices/sweet.mp3",
  },
  {
    description: "Quiet, intriguing, and a little dramatic.",
    elevenLabsVoiceId: "Z3R5wn05IrDiVCyEkUrK",
    gender: "female",
    id: "mysterious",
    label: "Mysterious",
    previewPath: "/audio/murph-voices/mysterious.mp3",
  },
  {
    description: "Steady, clear, and bookish.",
    elevenLabsVoiceId: "RILOU7YmBhvwJGDGjNmP",
    gender: "female",
    id: "narrator",
    label: "Audiobook narrator",
    previewPath: "/audio/murph-voices/narrator.mp3",
  },
  {
    description: "Warm, animated, and expressive.",
    elevenLabsVoiceId: "rCmVtv8cYU60uhlsOo1M",
    gender: "female",
    id: "expressive",
    label: "Warm and expressive",
    previewPath: "/audio/murph-voices/expressive.mp3",
  },
  {
    description: "Lively, bright, and playful.",
    elevenLabsVoiceId: "uYXf8XasLslADfZ2MB4u",
    gender: "female",
    id: "bubbly",
    label: "Bubbly",
    previewPath: "/audio/murph-voices/bubbly.mp3",
  },
  {
    description: "Smooth and easy to listen to.",
    elevenLabsVoiceId: "aRlmTYIQo6Tlg5SlulGC",
    gender: "female",
    id: "smooth",
    label: "Smooth and sweet",
    previewPath: "/audio/murph-voices/smooth.mp3",
  },
] as const satisfies readonly AssistantVoiceOption[];

export const defaultAssistantVoiceOptionId = "upbeat" satisfies AssistantVoiceOptionId;

export const workoutUnitPreferencesSchema = z
  .object({
    weight: z.enum(["lb", "kg"]).optional(),
    bodyMeasurement: z.enum(["cm", "in"]).optional(),
  })
  .strict();

export const wearablePreferenceProviderValues = ["garmin", "oura", "strava", "whoop"] as const;
export const wearablePreferenceProviderSchema = z.enum(wearablePreferenceProviderValues);
const wearablePreferenceProviderOrder = new Map<WearablePreferenceProvider, number>(
  wearablePreferenceProviderValues.map((provider, index) => [provider, index] as const),
);

export const wearablePreferencesSchema = z
  .object({
    desiredProviders: z.array(wearablePreferenceProviderSchema).default([]),
  })
  .strict();

export const assistantPreferencesSchema = z
  .object({
    tone: assistantTonePreferenceSchema.optional(),
    voice: z.string().min(1).optional(),
    personality: assistantPersonalityPreferencesSchema.optional(),
  })
  .strict();

export const preferencesDocumentSchema = withContractMetadata(
  z
    .object({
      schemaVersion: z.literal(preferencesDocumentSchemaVersion),
      updatedAt: z.string().min(1),
      assistant: assistantPreferencesSchema.optional(),
      workoutUnitPreferences: workoutUnitPreferencesSchema.default({}),
      wearablePreferences: wearablePreferencesSchema,
    })
    .strict(),
  "@murphai/contracts/preferences-document.schema.json",
  "Murph Preferences Document",
);

export type WorkoutUnitPreferences = z.infer<typeof workoutUnitPreferencesSchema>;
export type WearablePreferenceProvider = z.infer<typeof wearablePreferenceProviderSchema>;
export type WearablePreferences = z.infer<typeof wearablePreferencesSchema>;
export type AssistantTonePreference = z.infer<typeof assistantTonePreferenceSchema>;
export type AssistantVoiceOptionId = z.infer<typeof assistantVoiceOptionIdSchema>;
export type AssistantVoiceGender = z.infer<typeof assistantVoiceGenderSchema>;
export type AssistantPreferences = z.infer<typeof assistantPreferencesSchema>;
export type PreferencesDocument = z.infer<typeof preferencesDocumentSchema>;

export function isWearablePreferenceProvider(value: unknown): value is WearablePreferenceProvider {
  return typeof value === "string" && wearablePreferenceProviderOrder.has(value as WearablePreferenceProvider);
}

export function isAssistantTonePreference(value: unknown): value is AssistantTonePreference {
  return typeof value === "string" && assistantTonePreferenceValues.includes(value as AssistantTonePreference);
}

export function isAssistantPersonalitySettingId(
  value: unknown,
): value is AssistantPersonalitySettingId {
  return (
    typeof value === "string" &&
    assistantPersonalitySettingIds.includes(value as AssistantPersonalitySettingId)
  );
}

export function resolveAssistantPersonalityScores(
  preferences?: AssistantPersonalityPreferences | null,
): AssistantPersonalityScores {
  return assistantPersonalityScoresSchema.parse({
    ...defaultAssistantPersonalityScores,
    ...(preferences ?? {}),
  });
}

export function isAssistantVoiceOptionId(value: unknown): value is AssistantVoiceOptionId {
  return typeof value === "string" && assistantVoiceOptionIdValues.includes(value as AssistantVoiceOptionId);
}

export function resolveAssistantVoiceOption(
  voiceId: string | null | undefined,
): AssistantVoiceOption | null {
  if (!isAssistantVoiceOptionId(voiceId)) {
    return null;
  }

  return assistantVoiceOptions.find((option) => option.id === voiceId) ?? null;
}

export function resolveAssistantVoiceOptionElevenLabsVoiceId(
  voiceId: string | null | undefined,
): string | null {
  // No stored preference means the shared default voice; explicit `classic`
  // and stale roster ids stay null so callers fall back to the env voice.
  return (
    resolveAssistantVoiceOption(voiceId ?? defaultAssistantVoiceOptionId)?.elevenLabsVoiceId ??
    null
  );
}

export function normalizeWearablePreferenceProviders(
  providers: readonly WearablePreferenceProvider[] | null | undefined,
): WearablePreferenceProvider[] {
  return [...new Set(providers ?? [])].sort(
    (left, right) =>
      (wearablePreferenceProviderOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (wearablePreferenceProviderOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
}

export function createEmptyPreferencesDocument(now = new Date()): PreferencesDocument {
  return preferencesDocumentSchema.parse({
    schemaVersion: preferencesDocumentSchemaVersion,
    updatedAt: now.toISOString(),
    workoutUnitPreferences: {},
    wearablePreferences: {
      desiredProviders: [],
    },
  });
}
