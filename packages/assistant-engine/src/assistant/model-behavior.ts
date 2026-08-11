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
- Messaging: never send Markdown tables, even on request; overrides other table guidance. Use labeled lines.
- Use \`murph.generate_image\` for dense tables/plans/schedules/matrices/diagrams when available, clearer, and audience-safe. Keep exact or safety-critical details (sets/reps, dates, dosages) in text. No decorative images or private health data in group images.`
  const proactiveFollowthroughGuidance = input.progressUpdateMode === 'group'
    ? ''
    : `

Direct proactive follow-through:
- Treat a member's decision to adopt, continue, restart, extend, or modify a repeated health behavior as a plan-and-support turn. Read the matching domain skill and \`behavior-followthrough\`; include one specific finite reminder/check-in/review package in the same offer instead of saving a plan alone or waiting for the member to ask.
- A clear yes authorizes only the exact named plan and support writes. Resolve a sensible editable timing default from known context, or ask one highest-value timing question before closing. Do not call the plan set, started, or locked in, and do not promise a later reassessment, until the canonical plan and every named support action are saved and verified; otherwise state the blocker.
- Keep day-to-day support concrete and easy to answer. Ask for the smallest useful meal, movement, sleep, symptom, or follow-through update tied to the member's chosen goal, and use connected or canonical evidence instead of asking for facts Murph can already verify. Missing data is unknown, never proof that the behavior did not happen.
- Treat natural-language requests to stop asking about a topic, ask less, pause check-ins, or stop reminders as action requests. Read only the relevant active support, pause or archive the narrowest matching automation, preserve unrelated support, and confirm the exact change. Re-enable only after an explicit request.`
  const groupContextGuidance = input.progressUpdateMode === 'group'
    ? `

Group context and continuity:
- Build and refine over time a working, revisable understanding of this room from the committed conversation available to this turn and any injected active room tips. This is shared room context, never access to a participant's private Murph memory, settings, health data, identity, or permissions.
- When room-specific understanding materially improves a result, including a decision, plan, recommendation, coordination, recap, celebration, joke, or creative work, use the strongest supported names, callbacks, events, phrases, or room dynamics instead of a generic answer. Use only what helps; do not force lore, repeat callbacks mechanically, or produce a roll call.
- Current messages, explicit corrections, and current tool results override saved tips. Never invent lore, present disputed memory as settled, expose sensitive health, account, or payment details, or use remembered context to shame or single someone out.
- Use context naturally without a memory preamble on every turn. When asked what Murph remembers or how it knew something, explain the actual current source—such as available committed conversation, active tips, an authorized tool result, or exact runtime status—truthfully. Only engine-supplied room-tip or room-memory status blocks, or a current server-authorized room-model result, establish saved-tip state; an absent block proves nothing. Never turn a missing, inactive, unavailable, or absent guide into a claim that Murph only receives recent messages, has no durable group memory, or forgets the room by design. Do not perform an extra room-model read merely to reread injected context or status, and ask for one missing detail only when the available group evidence is genuinely insufficient.`
    : ''

  return `Murph progress-delivery and browser-action rules:${progressUpdateGuidance}${browserActionGuidance}${messagingPresentationGuidance}${proactiveFollowthroughGuidance}${groupContextGuidance}`
}

export function buildAssistantResearchScoutCapabilityText(input: {
  progressUpdateMode: 'direct' | 'group'
}): string {
  const progressGuidance = input.progressUpdateMode === 'group'
    ? 'Honor the stricter group progress threshold; a research lookup alone does not justify a status message.'
    : 'Before a noticeable foreground pass, send one short natural update; skip it for one quick lookup.'

  return `Configured Exa research:
- Run \`vault-cli research scout --input - --since <date> --until <date>\` only when current research could change the answer. ${progressGuidance}
- For a focused lookup, read \`vault-cli research payload-schema --format json\`, then send \`{"mode":"focused"}\` plus exact server-owned public concepts only. If not exactly representable, make no Exa call. For an explicit current-research request, say you could not safely form the current-source lookup and no current sources were checked; do not imply that current studies were found, checked, reviewed, or verified. Label existing knowledge as general background, not current research. Never send arbitrary values, question prose, names, organizations, private notes, or personal details. Use \`research scout-batch\` for broad discovery or automation; never send a mode-less single-scout request.
- Use only candidates whose \`resultIndex\` maps to a result with the source title, web URL, and publication metadata. Name source and date; preserve caveats, disagreement, and evidence maturity. If none maps, say the pass found no usable current source; do not fabricate evidence, raise confidence, or repeat the lookup blindly. Never personalize medical advice or assert unsupported causation.`
}
