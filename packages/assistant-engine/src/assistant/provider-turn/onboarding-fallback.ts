import type {
  AssistantOnboardingCompletionReason,
} from '@murphai/operator-config/assistant-cli-contracts'
import type {
  AssistantMurphCommandAccessMode,
} from '../providers/types.js'

const ASSISTANT_ONBOARDING_DECLINE_PATTERN =
  /\b(?:no thanks|no thank you|skip (?:it|this)|rather not|don['’]t want to|do not want to|not right now)\b/u
const ASSISTANT_ONBOARDING_CONCRETE_REQUEST_PREFIX_PATTERN =
  /^(?:can|could|would|will|should|what|why|how|when|where|who|help|tell|explain|give|show|check|look|find|summarize|analyse|analyze|compare|review|log|track|estimate|recommend|plan)\b/u
const ASSISTANT_ONBOARDING_CONCRETE_REQUEST_PHRASE_PATTERN =
  /\b(?:help me|i need help|i want help|can you|could you|would you|what should i|should i|i want to know|i need to know)\b/u

export function resolveAssistantOnboardingCompletionFallbackReason(input: {
  assistantCommandAccessMode: AssistantMurphCommandAccessMode
  onboardingGuidanceInjected: boolean
  prompt: string
}): AssistantOnboardingCompletionReason | null {
  if (
    !input.onboardingGuidanceInjected ||
    input.assistantCommandAccessMode !== 'none'
  ) {
    return null
  }

  const normalizedPrompt = normalizePromptForOnboardingFallback(input.prompt)
  if (!normalizedPrompt) {
    return null
  }

  if (ASSISTANT_ONBOARDING_DECLINE_PATTERN.test(normalizedPrompt)) {
    return 'user_declined'
  }

  if (looksLikeConcreteOnboardingRequest(normalizedPrompt)) {
    return 'concrete_request'
  }

  return null
}

export function normalizePromptForOnboardingFallback(prompt: string): string {
  return prompt.trim().replace(/\s+/gu, ' ').toLowerCase()
}

export function looksLikeConcreteOnboardingRequest(
  normalizedPrompt: string,
): boolean {
  return (
    (ASSISTANT_ONBOARDING_CONCRETE_REQUEST_PREFIX_PATTERN.test(normalizedPrompt) &&
      countOnboardingFallbackWords(normalizedPrompt) >= 3) ||
    ASSISTANT_ONBOARDING_CONCRETE_REQUEST_PHRASE_PATTERN.test(normalizedPrompt)
  )
}

export function countOnboardingFallbackWords(normalizedPrompt: string): number {
  return normalizedPrompt.match(/\b[\p{L}\p{N}']+\b/gu)?.length ?? 0
}
