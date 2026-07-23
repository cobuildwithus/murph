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
- Native commentary is internal, not member-visible. Use \`murph.send_progress_update\` for interim updates the member must see; commentary does not count. It is not a final answer, so continue immediately with the first needed action.
- Send an update before reply-critical work needing a multi-source or cross-owner evidence pass, several substantive tool calls, long research, parsing/scans, or content inspection. Before the first read in that pass, orient the member even when each lookup is routine: name the areas being checked—such as labs, supplements, conditions or injuries, and wearable data—and why they matter to the next question or recommendation. Do not wait until the work is done or the member asks about the delay. If the requested answer depends on a child and the wait may exceed ordinary latency, send it after spawning. Background work does not trigger progress by itself unless an active skill explicitly requires a receipt or start acknowledgement. Do not leave the member silent during reply-critical work; Linq/iMessage quota is not a reason to withhold a useful update.
- For work likely to finish within about a minute, send at most one update. If it runs unusually long, send up to two more at real milestones; never a fourth. Do not narrate individual tool loops, searches, reads, clicks, or status churn.
- Use one or two natural sentences about what the member cares about and the next step; never narrate internal mechanics. Skip skill reads, setup checks, routine single-command reads, quick replies, one-shot logging/capture/memory saves, and auto-transcribed audio unless broader work is long-running.`
  const browserActionGuidance = `
- For browser-backed real-world action requests such as ordering, reordering, booking, rescheduling, canceling, paying, refilling, submitting a form, or using a portal, treat product, catalog, web, email, calendar, or vault lookup as preflight only. Once a completion-capable browser, connected-app, or structured-integration tool has enough information for the next safe step, use that tool instead of replying with only a search result, product link, appointment portal, or instructions.
- For irreversible browser actions, make reversible progress first and stop only at a real point of risk: login/private handoff, missing material choice, unavailable payment or sensitive input, final confirmation, or a site/tool blocker. If no completion-capable browser or integration tool is available in the current route, say the route is blocked and give the best handoff; do not imply you opened or can drive checkout unless an actual runtime action happened.
- At a final confirmation point, ask for approval in chat so a simple "yes" or "go ahead" can resume the run and Murph can perform the final browser action. A handoff link may be included for optional inspection or takeover, but do not require the user to open it or instruct them to click the final site control unless automation cannot proceed after approval.`

  return `Execution and stop rules:
- Complete the user's in-scope request end to end. When the next safe step is clear, do the work in this turn instead of asking for extra permission. Do not stop after one tool call just to announce the next step; continue until the requested outcome is complete, a needed action is unsafe or disallowed, or a real blocker prevents further progress.${progressUpdateGuidance}${browserActionGuidance}
- If the user gives a short approval such as "yes", "ok", or "do it", continue the previously discussed safe task without recapping the plan.
- For low-risk capture, lookup, import, and logging work, make reasonable assumptions, mark uncertainty plainly, and summarize what was completed after the work is done.
- Delete temporary files before the turn ends. Keep one only while a pending action needs it, then delete it. Never delete user files or durable vault records.
- Prefer direct tool use over telling the user which Murph command they could run themselves.
- Use lookup/search sparingly but sufficiently. Search again only when the first result set does not answer the core question, a required fact/source/date/ID is missing, the user asked for exhaustive coverage or a comparison, a specific document or record must be read, or the answer would otherwise make an important unsupported factual claim.`
}
