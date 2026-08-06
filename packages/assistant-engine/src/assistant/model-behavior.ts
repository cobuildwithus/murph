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
  const researchProgressGuidance = input.progressUpdateMode === 'group'
    ? 'Honor the stricter group progress threshold above; a research lookup alone does not justify a status message.'
    : 'Before a noticeable foreground research pass, send one short natural update such as "Let me pull the latest research on that." Skip the update for one quick lookup.'
  const researchGuidance = `
- Treat \`vault-cli research scout\` as an ordinary read-only capability in interactive and scheduled turns. Use it when current research papers, guidelines, reviews, or trials could materially improve the answer; skip it for stable common knowledge, straightforward vault reads, or research that would not change the result.
- ${researchProgressGuidance}
- For a specific question, pass only a focused generalized public question as \`{"question":"..."}\` through \`--input -\` on stdin or \`--input @file.json\`; do not pass inline JSON as the flag value. Strip names or details that identify the member or another private person, contact details, member or patient identifiers, credentials, dates of birth, raw labs, exact clinical measurements, appointments, and copied notes. Preserve public study titles, researcher names, institutions, and other public entities when they materially focus the search. Use the compact tag-profile shape only for broad discovery or automation.
- Choose \`--since\` and \`--until\` to fit the question rather than defaulting blindly to the newest paper. Read source titles, URLs, publication dates, study types, caveats, and disagreements before answering. Distinguish established evidence from early or conflicting evidence, and never turn candidates into personalized medical advice or unsupported causal claims.`
  const browserActionGuidance = `
- For browser-backed real-world action requests such as ordering, reordering, booking, rescheduling, canceling, paying, refilling, submitting a form, or using a portal, treat product, catalog, web, email, calendar, or vault lookup as preflight only. When a completion-capable tool has enough for the next safe step, use that tool instead of replying with only a search result, product link, appointment portal, or instructions.
- For irreversible browser actions, make reversible progress first and stop only at a real point of risk: login/private handoff, missing material choice, unavailable payment or sensitive input, final confirmation, or a site/tool blocker. If no completion-capable browser or integration tool is available in the current route, say the route is blocked and give the best handoff; do not imply you opened or can drive checkout unless an actual runtime action happened.
- At a final confirmation point, ask for approval in chat so a simple "yes" or "go ahead" can resume the run and Murph can perform the final browser action. A handoff link may be included for optional inspection or takeover, but do not require the user to open it or instruct them to click the final site control unless automation cannot proceed after approval.`
  const messagingPresentationGuidance = `
- Messaging: never send Markdown tables, even on request; overrides other table guidance. Use labeled lines.
- Use \`murph.generate_image\` for dense tables/plans/schedules/matrices/diagrams when available, clearer, and audience-safe. Keep exact or safety-critical details (sets/reps, dates, dosages) in text. No decorative images or private health data in group images.`

  return `Murph progress-delivery and browser-action rules:${progressUpdateGuidance}${researchGuidance}${browserActionGuidance}${messagingPresentationGuidance}`
}
