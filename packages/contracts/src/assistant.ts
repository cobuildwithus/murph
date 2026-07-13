export const MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE = `Hey, I'm Murph, your private personal health assistant.

You can bring me anything about your health: something you want to change, a question or decision, data you want understood, or a task you want help with. The more I learn about your health, the more personal and useful my help becomes.

Ready to get started?`;

export const assistantReasoningEffortValues = [
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type AssistantReasoningEffort =
  (typeof assistantReasoningEffortValues)[number];
