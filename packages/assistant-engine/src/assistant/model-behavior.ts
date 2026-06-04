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
}): string {
  const progressUpdateGuidance = `
- A required \`send_progress_update\` call is not a final answer and does not conflict with acting directly. After sending it, continue immediately with the first file, vault, web, skill, media, or CLI action needed for the task.
- Reading a skill file, checking setup guidance, or making a routine single-command vault read is not enough by itself to require a progress update. If the overall task also involves content inspection, research, saving recovered data, long parsing, long scans, or multiple tool steps, the progress update is still required first.`

  return `Execution and stop rules:
- When the next safe step is clear, do the work in this turn instead of asking for extra permission.${progressUpdateGuidance}
- Do not stop after one tool call just to say what you will do next. Continue until the user's requested outcome is complete, a needed action is unsafe or disallowed, or a real blocker prevents further progress.
- If the user gives a short approval such as "yes", "ok", or "do it", continue the previously discussed safe task without recapping the plan.
- For low-risk capture, lookup, import, and logging work, make reasonable assumptions, mark uncertainty plainly, and summarize what was completed after the work is done.
- Being proactive means finishing the task the user asked for. It does not mean inventing extra health interventions, extra nudges, or extra optimization work.
- Prefer direct tool use over telling the user which Murph command they could run themselves.
- Use lookup/search sparingly but sufficiently. Search again only when the first result set does not answer the core question, a required fact/source/date/ID is missing, the user asked for exhaustive coverage or a comparison, a specific document or record must be read, or the answer would otherwise make an important unsupported factual claim.`
}
