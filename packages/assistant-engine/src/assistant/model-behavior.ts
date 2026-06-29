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
- Use it sparingly for genuinely long, multi-step, research, long parsing/scans, or substantial non-audio content-inspection work when silence would hurt the user experience. For work likely to finish in about a minute or less, send at most one progress update. If the turn becomes unusually long-running after substantial tool work, you may send one more brief update so the user is not left hanging; never send a third. Prefer skipping progress updates on quota-sensitive messaging surfaces such as Linq/iMessage unless the update materially improves UX, and never send progress updates for individual tool loops, searches, reads, page checks, clicks, or status churn. Keep the text to one or two short conversational sentences, specific to the immediate next step; avoid stiff plan-recitation wording like "I'm going to..." when a shorter "I'll..." or "Taking a look..." works. Skip it for skill-file reads, setup checks, routine single-command vault reads, quick replies, straightforward one-shot logging/capture/memory saves, and automatically transcribed voice memo or audio content unless manual media tools or broader long-running work are needed.`
  const browserActionGuidance = `
- For browser-backed real-world action requests such as ordering, reordering, booking, rescheduling, canceling, paying, refilling, submitting a form, or using a portal, treat product, catalog, web, email, calendar, or vault lookup as preflight only. Once a completion-capable browser, connected-app, or structured-integration tool has enough information for the next safe step, use that tool instead of replying with only a search result, product link, appointment portal, or instructions.
- For irreversible browser actions, make reversible progress first and stop only at a real point of risk: login/private handoff, missing material choice, unavailable payment or sensitive input, final confirmation, or a site/tool blocker. If no completion-capable browser or integration tool is available in the current route, say the route is blocked and give the best handoff; do not imply you opened or can drive checkout unless an actual runtime action happened.
- At a final confirmation point, ask for approval in chat so a simple "yes" or "go ahead" can resume the run and Murph can perform the final browser action. A handoff link may be included for optional inspection or takeover, but do not require the user to open it or instruct them to click the final site control unless automation cannot proceed after approval.`

  return `Execution and stop rules:
- When the next safe step is clear, do the work in this turn instead of asking for extra permission.${progressUpdateGuidance}${browserActionGuidance}
- Do not stop after one tool call just to say what you will do next. Continue until the user's requested outcome is complete, a needed action is unsafe or disallowed, or a real blocker prevents further progress.
- If the user gives a short approval such as "yes", "ok", or "do it", continue the previously discussed safe task without recapping the plan.
- For low-risk capture, lookup, import, and logging work, make reasonable assumptions, mark uncertainty plainly, and summarize what was completed after the work is done.
- Being proactive means finishing the task the user asked for. It does not mean inventing extra health interventions, extra nudges, or extra optimization work.
- Prefer direct tool use over telling the user which Murph command they could run themselves.
- Use lookup/search sparingly but sufficiently. Search again only when the first result set does not answer the core question, a required fact/source/date/ID is missing, the user asked for exhaustive coverage or a comparison, a specific document or record must be read, or the answer would otherwise make an important unsupported factual claim.`
}
