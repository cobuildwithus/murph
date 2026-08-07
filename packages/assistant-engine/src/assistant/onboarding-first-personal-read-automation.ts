import { isDeepStrictEqual } from 'node:util'

import type {
  AssistantHostedAutomationToolRequest,
} from './execution-context.js'

export const MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_ID =
  'automation_01K7AV8Z2Y3X4W5V6T7R8Q9P0N'

export const MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG =
  'onboarding-first-personal-read'

export const MURPH_ONBOARDING_FIRST_PERSONAL_READ_ACTION =
  'save_onboarding_first_personal_read' as const

const FIRST_PERSONAL_READ_DELAY_MS = 2 * 60 * 1000
const FIRST_PERSONAL_READ_ACTIVE_WINDOW_MS = 62 * 60 * 1000

export const MURPH_ONBOARDING_FIRST_PERSONAL_READ_INSTRUCTIONS = [
  'This is the single first personal health read after answered onboarding. The goal is to demonstrate that Murph understood the member, not to produce a report card, dashboard recap, or forced recommendation. It is better to send nothing than to manufacture a weak insight.',
  '',
  'Authority and current context:',
  '- First run `vault-cli assistant onboarding status --format json`. Return skip unless onboarding is completed with reason `user_answered`.',
  '- Read the current committed private conversation before analysis and again immediately before composing. A newer urgent, acute, grieving, safety-sensitive, approval, booking, purchase, or otherwise unresolved task wins; return skip rather than interrupting it.',
  '- Return skip unless the scheduled occurrence context and current route are for one private member conversation. A group or room occurrence is never eligible and must not read health evidence or send.',
  '- Return skip if the member asked not to receive this read, requested no follow-up, or otherwise revoked this proactive outreach. Do not reinterpret a cancellation as temporary hesitation.',
  '- Return skip when a substantive proactive health question, decision, or requested action from Murph is still waiting for the member. A generic closing invitation such as `anything else?` is not an unresolved task and does not block this promised first read.',
  '- Read `vault-cli knowledge show weekly-health-insights`. Treat a genuinely missing page as no prior personal insights, but return skip if the page itself is malformed or unreadable. If a `First read <Occurrence instant>` section already exists for this occurrence, use its compact `claim:`, `evidence:`, `uncertainty:`, and canonical source paths only as the same occurrence\'s semantic candidate. Recheck every current timing, consent, route, source-health, freshness, confounder, and interestingness gate, revalidate the candidate against current canonical sources, then compose the message naturally. If that section is incomplete, redo the bounded evidence pass from canonical sources instead of treating transport formatting as a terminal skip. If any other section heading begins `First read `, return skip; this one-shot never sends a second first personal read. Otherwise do not repeat a finding already captured there.',
  '',
  'Targeted evidence pass:',
  '- Start from the member\'s named open threads, what progress means to them, and why it matters. Inspect only canonical evidence that could materially change those threads: movement and training, current protocols or experiments, supplements, medical and safety context, recent labs or durable raw records, connected wearable history, and directly relevant conversation context.',
  '- Use targeted reads and existing owners instead of trawling unrelated health history. Do not recap the onboarding intake.',
  '- When `murph.device` is available, use `action: list_accounts`. Always read `vault-cli wearables sources list` before relying on wearable trends. Verify source health, freshness, coverage, and relevant sync gaps.',
  '- Missing, stale, sparse, misclassified, contradictory, or still-importing data is not evidence of behavior or a health problem. Never infer that something did not happen merely because Murph cannot see it.',
  '- Treat proprietary readiness, recovery, sleep, or strain scores as summaries, not independent evidence. Reject tautologies that merely rediscover inputs to a vendor score. Consumer sleep-stage estimates alone never clear the bar.',
  '- Never infer alcohol use, medication changes, illness, adherence, or another sensitive explanation from a proxy pattern. Use only explicit member context or attributable canonical evidence.',
  '- Check plausible alternatives and confounders. A correlation can support `lined up with` or `was associated with`, not `caused`, `proved`, or `explains`.',
  '- Use bounded public research only after a member-specific candidate exists and only when one or two credible human studies, reviews, or guidelines materially improve its interpretation. The member\'s own evidence remains decisive. Do not run an open-ended search and do not spawn a child; this scheduled turn owns the complete read, selection, and delivery.',
  '',
  'Interestingness bar:',
  '- Find zero or one useful, non-obvious personal observation. Good shapes include an independent-signal mismatch, a stable personal threshold, a compounding pair of inputs, a surprising tradeoff, a durable slow drift, a reassuring noise interpretation, a hunch the evidence weakens, or a research-backed hypothesis the member\'s data supports or narrows.',
  '- A finding clears the bar only when it is specific to this member, supported by concrete recognizable evidence, relevant to something they care about, not a repeat, and honest about uncertainty.',
  '- It should make the member think `I did not know that about me, that is interesting` or materially change what they might measure, try, interpret, ignore, or ask a clinician.',
  '- Suppress true-but-boring findings. Missing data, messy tags, generic goal progress, a plain behavioral decline, `do more`, a recap of what the member already said, and `Murph cannot currently see X` are not insights.',
  '- Require exact goal congruence. Steps are not a substitute for exercise, workouts are not a substitute for everyday walking, and adherence is not the outcome unless the member chose it as the outcome.',
  '- Prefer independent signals, explanatory mismatches, personal cliffs, or tradeoffs over raw values. Stop once one candidate clearly clears or fails the bar; do not keep researching to make a weak idea sound interesting.',
  '',
  'Honest fallback:',
  '- If no surprising pattern clears the bar, do not fabricate one and do not send a sync or process note.',
  '- A personal read may still be worthwhile when the evidence supports one useful interpretation, reassuring non-finding, or the single low-burden measurement or comparison most likely to clarify the member\'s stated goal. That fallback must still be member-specific and decision-relevant; generic homework does not qualify.',
  '- If even that would be generic or unsupported, return `{"kind":"skip","privateSummary":"No first personal read cleared the evidence and interestingness bars."}`.',
  '',
  'Durable dedupe:',
  '- When a new send-worthy read exists, best-effort run `vault-cli knowledge append-section weekly-health-insights "First read <Occurrence instant>" --title "Weekly Health Insights" --position prepend --body <markdown> --source-path <path> ...`. Use the exact ISO instant from the Scheduled occurrence context so only a retry of this occurrence can reuse its semantic candidate. The body contains only the compact `claim:`, `evidence:`, and `uncertainty:` fields; cite only canonical source paths actually used, never `derived/**` or `.runtime/**` paths. Do not store the outbound message or any transport framing in this page.',
  '- Never create another page or another first-read section. A failed dedupe write must not make the member lose an otherwise sound first read. The page owns semantic non-repeat only; the existing occurrence-scoped cron/outbox identity freezes and replays exact member-facing text after an outbox intent exists.',
  '',
  'Member-facing message:',
  '- Send one compact natural message, usually three to five sentences. If a transition is needed, use a truthful bridge such as `I took a deeper look across what you shared.` If recent conversation is unrelated, `Separate thing from the deeper look I took:` is enough. Do not claim the member remembers a prior promise.',
  '- Lead with the useful point, then give the smallest recognizable evidence needed to trust it and calibrate the uncertainty. Translate jargon in one short phrase when necessary.',
  '- End with at most one optional low-burden next action or question: watch one context, measure one thing, test a small reversible hunch, ignore a misleading score, ask a clinician a sharper question, or leave it alone.',
  '- Do not diagnose, prescribe, alarm, shame, dump metrics, stack findings, create a habit, plan, experiment, reminder, or other action, or imply causation beyond the evidence.',
  '- Do not mention onboarding, automations, subagents, internal research process, records, tools, or the dedupe page.',
].join('\n')

type AutomationSaveRequest = Extract<
  AssistantHostedAutomationToolRequest,
  { action: 'save' }
>

export function isCanonicalOnboardingFirstPersonalReadAutomationSaveRequest(
  request: AutomationSaveRequest,
): boolean {
  if (request.schedule.kind !== 'at') {
    return false
  }
  const dueAt = new Date(request.schedule.at)
  if (!Number.isFinite(dueAt.getTime())) {
    return false
  }

  return isDeepStrictEqual(
    request,
    buildOnboardingFirstPersonalReadAutomationSaveRequest({
      now: new Date(dueAt.getTime() - FIRST_PERSONAL_READ_DELAY_MS),
    }),
  )
}

export function buildOnboardingFirstPersonalReadAutomationSaveRequest(input: {
  now?: Date
} = {}): AutomationSaveRequest {
  const now = input.now ?? new Date()
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError(
      'Onboarding first personal read received an invalid current date.',
    )
  }

  return {
    action: 'save',
    activeUntil: new Date(
      now.getTime() + FIRST_PERSONAL_READ_ACTIVE_WINDOW_MS,
    ).toISOString(),
    assistantTargetOverride: {
      reasoningEffort: 'high',
    },
    automationId: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_ID,
    continuityPolicy: 'fresh',
    instructions: MURPH_ONBOARDING_FIRST_PERSONAL_READ_INSTRUCTIONS,
    schedule: {
      kind: 'at',
      at: new Date(
        now.getTime() + FIRST_PERSONAL_READ_DELAY_MS,
      ).toISOString(),
    },
    slug: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG,
    status: 'active',
    summary:
      'One private first read across the context and health data collected during onboarding.',
    tags: [
      'assistant',
      'scheduled',
      'onboarding',
      'first-personal-read',
    ],
    title: 'First personal health read',
  }
}
