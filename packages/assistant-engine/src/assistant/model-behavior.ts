import {
  normalizeAssistantProviderConfig,
  type AssistantProviderConfigInput,
} from '@murphai/operator-config/assistant/provider-config'
import { normalizeNullableString } from './shared.js'

export const assistantModelBehaviorProfileValues = [
  'default',
  'gpt5-agentic',
] as const

export type AssistantModelBehaviorProfile =
  (typeof assistantModelBehaviorProfileValues)[number]

export function resolveAssistantModelBehaviorProfile(
  input: AssistantProviderConfigInput | null | undefined,
): AssistantModelBehaviorProfile {
  const normalized = normalizeAssistantProviderConfig(input)

  if (normalized.target.kind === 'codex-cli' && normalized.target.oss) {
    return 'default'
  }

  if (isAssistantGpt5FamilyModel(normalized.target.model)) {
    return 'gpt5-agentic'
  }

  if (
    normalized.target.kind === 'codex-cli' &&
    !normalized.target.oss &&
    !normalized.target.model
  ) {
    return 'gpt5-agentic'
  }

  return 'default'
}

export function isAssistantGpt5FamilyModel(
  model: string | null | undefined,
): boolean {
  const normalized = normalizeNullableString(model)?.toLowerCase()
  if (!normalized) {
    return false
  }

  const unprefixed = normalized.startsWith('openai/')
    ? normalized.slice('openai/'.length)
    : normalized

  return unprefixed.startsWith('gpt-5')
}

export function buildAssistantExecutionBehaviorText(input: {
  profile: AssistantModelBehaviorProfile
  progressUpdatesAvailable?: boolean
}): string {
  const progressUpdateGuidance =
    input.progressUpdatesAvailable === true
      ? `
- When a task will likely take noticeable time before the user sees a final reply, you may call \`send_progress_update\` once early with a brief user-facing acknowledgement. Use it for large PDFs, lab reports, research, long vault scans, or multi-step file processing.
- Progress updates must be truthful about what you are about to do and must not include conclusions you have not verified.
- For lab reports or blood tests, acknowledge receipt and say you will extract, check, or save results only if that is actually the intended work. Do not state interpretations, abnormalities, diagnoses, or recommendations in a progress update.`
      : ''
  const sections = [
    `Execution style:
- When the user asks you to log, update, inspect, connect, estimate, or look something up and the next step is clear, do the work in this turn instead of asking for extra permission.
- Before asking a clarifying question, first check the vault, recent conversation, attached files, and available lookup tools when those could resolve the ambiguity.
- Ask a clarifying question only when the ambiguity would materially change the write, the answer, or the safety posture.
- When you have enough context to act safely, start with the first real tool or CLI action rather than narrating a plan.
- Keep going until the requested task is finished or you hit a real blocker.
- If the user gives a short approval such as "yes", "ok", or "do it", continue without recapping the plan.
- For low-risk capture or lookup work, make reasonable assumptions, mark uncertainty plainly, and summarize what you did after the work is done.
- Being proactive means finishing the task the user asked for. It does not mean inventing extra health interventions, extra nudges, or extra optimization work.${progressUpdateGuidance}`,
  ]

  if (input.profile === 'gpt5-agentic') {
    sections.push(
      `GPT-5 execution bias:
- Commentary-only turns are incomplete when a safe low-risk next action is already clear.
- Do not stop after one tool call just to say what you will do next.
- Avoid soft-handoff phrasing like "I can do that", "let me know if you'd like me to...", or "would you like me to..." when the user already asked you to do the work.
- Prefer direct tool use over telling the user which Murph command they could run themselves.`,
    )
  }

  return sections.join('\n\n')
}
