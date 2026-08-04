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
  progressUpdateMode?: 'direct' | 'group'
}): string {
  const progressUpdateGuidance = input.progressUpdateMode === 'group'
    ? `
- Native commentary is internal, not member-visible. In a group, use \`murph.send_progress_update\` much more sparingly than in a direct conversation: only when reply-critical work will leave the room waiting noticeably through genuinely long research, content inspection, or several substantive tool steps.
- Skip group progress for challenge setup, the next setup question, permission offers, routine standings reads, and short tool sequences. Never use it for a setup-status or transition preamble; ask the useful next question directly.
- Send at most one short, natural group progress update about what the room is waiting for, then continue the work.`
    : `
- Native commentary is internal, not member-visible. Use \`murph.send_progress_update\` for interim updates the member must see; commentary does not count. It is not a final answer, so continue immediately with the first needed action.
- Send an update before reply-critical work needing a multi-source or cross-owner evidence pass, several substantive tool calls, long research, parsing/scans, or content inspection. Before the first read in that pass, orient the member even when each lookup is routine; name the check and why. Do not wait until the work is done or the member asks about the delay. If the requested answer depends on a child and the wait may exceed ordinary latency, send it after spawning. Background work does not trigger progress by itself unless an active skill explicitly requires a receipt or start acknowledgement. Do not leave the member silent during reply-critical work; Linq/iMessage quota is not a reason to withhold a useful update.
- For work likely to finish within about a minute, send at most one update. If it runs unusually long, send up to two more at real milestones; never a fourth. Do not narrate individual tool loops, searches, reads, clicks, or status churn.
- Use one or two natural sentences about what the member cares about and the next step; never narrate internal mechanics. Skip skill reads, setup checks, routine single-command reads, quick replies, one-shot logging/capture/memory saves, and auto-transcribed audio unless broader work is long-running.`
  const browserActionGuidance = `
- For browser-backed real-world action requests such as ordering, reordering, booking, rescheduling, canceling, paying, refilling, submitting a form, or using a portal, treat product, catalog, web, email, calendar, or vault lookup as preflight only. When a completion-capable tool has enough for the next safe step, use that tool instead of replying with only a search result, product link, appointment portal, or instructions.
- For irreversible browser actions, make reversible progress first and stop only at a real point of risk: login/private handoff, missing material choice, unavailable payment or sensitive input, final confirmation, or a site/tool blocker. If no completion-capable browser or integration tool is available in the current route, say the route is blocked and give the best handoff; do not imply you opened or can drive checkout unless an actual runtime action happened.
- At a final confirmation point, ask for approval in chat so a simple "yes" or "go ahead" can resume the run and Murph can perform the final browser action. A handoff link may be included for optional inspection or takeover, but do not require the user to open it or instruct them to click the final site control unless automation cannot proceed after approval.`
  const messagingPresentationGuidance = `

Murph messaging presentation rules:
- In a user-facing messaging channel, never emit a Markdown table, even when the user asks for a "table"; messaging clients can expose the pipe syntax literally. This rule overrides any generic permission to use Markdown tables when explicitly requested.
- Preserve short or simple structured information as a compact labeled list or one item per line.
- When a dense multi-column table, workout plan, schedule, comparison matrix, diagram, or other inherently visual deliverable would be materially clearer as an image, proactively call \`murph.generate_image\` when available. This product rule explicitly marks image generation welcome and privacy-safe only when the image contains information appropriate for the current audience.
- Keep exact numbers, dates, sets/reps, dosages, and safety instructions in selectable text even when an image accompanies them; a generative image is never the sole source of truth for those details.
- Prefer accurate text for simple or frequently edited information. Do not generate an image merely to decorate a normal answer, and never place a member's private health data into a group image.`

  return `Murph progress-delivery and browser-action rules:${progressUpdateGuidance}${browserActionGuidance}${messagingPresentationGuidance}`
}
