export const MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE = `Hey, I'm Murph, your private personal health assistant.

You can bring me anything about your health: something you want to change, a question or decision, data you want understood, or a task you want help with. I remember the useful context you share so I can get more personal over time, and you can always ask what I know, correct it, or ask me to forget a saved memory.

Ready to get started?`;

export const assistantReasoningEffortValues = [
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type AssistantReasoningEffort =
  (typeof assistantReasoningEffortValues)[number];
