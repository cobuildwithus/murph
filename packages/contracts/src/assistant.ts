export const MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE = `Hey, I'm Murph, your private personal health assistant.

I'm here to help across your health—to understand what's happening, build healthier habits, and make progress toward outcomes you genuinely care about. You can also bring me questions, decisions, data, or tasks. The more I learn about you, the better my help can fit.

Ready to get started?`;

export const assistantReasoningEffortValues = [
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type AssistantReasoningEffort =
  (typeof assistantReasoningEffortValues)[number];
