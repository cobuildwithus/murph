export const MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE = `Hey, I'm Murph — your personal health assistant.

Text me anything health-related — meals, supplements, workouts, symptoms, questions — and over time I'll help you understand what's actually working for your body.

I'm especially good at running small health experiments — cold plunge, sauna, a new exercise routine, a supplement — and helping you understand if it makes you healthier.

Ready to get started?`;

export const assistantReasoningEffortValues = [
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type AssistantReasoningEffort =
  (typeof assistantReasoningEffortValues)[number];
