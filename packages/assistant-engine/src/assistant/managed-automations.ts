import {
  showAutomation,
  upsertAutomation,
  type AutomationRecord,
} from '@murphai/core'
import type {
  AutomationContinuityPolicy,
  AutomationRoute,
  AutomationSchedule,
} from '@murphai/contracts'
import {
  resolveAssistantDeliveryRouteWithCurrentRoute,
} from '@murphai/operator-config/assistant/current-delivery-route'
import {
  applyAssistantSelfDeliveryTargetDefaults,
} from '@murphai/operator-config/operator-config'
import { ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG } from './automation-tags.js'
import { resolveDeliverableAutomationRoute } from './cron/targets.js'
import { buildExperimentFinalResultsSeeds } from './experiment-support-automations.js'

export type MurphManagedAutomationSchedule = Exclude<
  AutomationSchedule,
  { kind: 'deviceActivity' }
>

export interface MurphManagedAutomationSeed {
  automationId: string
  continuityPolicy?: AutomationContinuityPolicy
  instructions: string
  requiredRuntimeEnvKeys?: readonly string[]
  schedule: MurphManagedAutomationSchedule
  slug: string
  summary?: string
  tags?: readonly string[]
  title: string
}

export interface ApplyMurphManagedAutomationsInput {
  defaultRoute?: AutomationRoute | null
  now?: Date
  operatorHomeRoot?: string | null
  runtimeEnv?: Readonly<Record<string, string | undefined>>
  seeds?: readonly MurphManagedAutomationSeed[]
  vaultRoot: string
}

export interface ApplyMurphManagedAutomationsResult {
  created: number
  skipped: number
  updated: number
}

export const MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID =
  'automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FY'
export const MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID =
  'automation_X3GPAWV2CCHNCYHAAJ4CE2M144'
export const MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID =
  'automation_01K0EXA5C0VT9F7X3KG6JMPZ5A'

// One-shot ('at') seeds are delivery-time-sensitive: runtimes apply seeds
// lazily on background wakes, so a dormant user may first see a one-shot
// seed long after its scheduled moment. Past this window the seed is
// skipped rather than installed, so a stale announcement is never sent late.
// Keep aligned with ASSISTANT_CRON_NOTIFICATION_EXPIRES_AFTER_MS in
// cron/execution.ts: both express the same product window for how late a
// one-shot notification may still go out.
const MURPH_MANAGED_ONE_SHOT_NOTIFICATION_EXPIRES_AFTER_MS = 60 * 60 * 1000

const MURPH_MANAGED_AUTOMATION_BASE_TAGS = [
  'assistant',
  'scheduled',
  'murph-managed',
] as const

export const MURPH_MANAGED_AUTOMATIONS = [
  {
    automationId: MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
    slug: 'weekly-health-digest',
    title: 'Weekly health digest',
    summary: 'A weekly summary of your recent health data.',
    schedule: {
      kind: 'cron',
      expression: '0 9 * * 1',
    },
    continuityPolicy: 'fresh',
    tags: [
      'murph-managed:weekly-health-digest',
      ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG,
    ],
    instructions: [
      'Each Monday morning, produce one concise weekly health digest for the configured automation route.',
      '',
      'Focus on:',
      '- sleep',
      '- recovery',
      '- workouts / activity',
      '- notable changes',
      '- one suggested next step',
      '',
      'If there is an active experiment with enough data to show movement, attach its progress image with `vault-cli experiment progress-card <slug> --format json` and fold its progress into the digest.',
      '',
      'Do not overstate certainty. If data is missing, say that plainly.',
    ].join('\n'),
  },
  {
    automationId: MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
    slug: 'weekly-health-insight',
    title: 'Weekly health insight',
    summary: 'A weekly scout for one non-obvious personal health/body finding.',
    schedule: {
      kind: 'cron',
      expression: '0 13 * * 3',
    },
    continuityPolicy: 'fresh',
    tags: [
      'murph-managed:weekly-health-insight',
    ],
    instructions: [
      "Each Wednesday at 1:00 PM local time, find one useful, non-obvious personal health/body insight that goes beyond dashboards, generic advice, and vendor score formulas.",
      '',
      'Before choosing a finding:',
      '- Read the derived knowledge index.',
      '- Read `vault-cli knowledge show weekly-health-insights`. If the page is missing, treat that as no prior weekly health insights.',
      '- Use `weekly-health-insights` as the dedupe ledger. Do not scan every wiki page and do not create per-week insight pages.',
      '- Search other knowledge pages only when the index suggests a candidate finding may already be covered elsewhere.',
      '- Inspect only enough recent and historical vault data to test candidate patterns.',
      '- When useful, use web search to find one or two credible studies, reviews, or guidelines that suggest a pattern worth testing against the vault. Keep the user\'s vault data as the deciding evidence. Put external source provenance in the `weekly-health-insights` section body when it materially supports the mechanism, but keep the outbound note URL-free unless the user asks for links. Do not block the run if web search is unavailable or not useful.',
      '',
      'Good finding shapes include:',
      '- Bloodwork plus behavior: lab markers, symptoms, workouts, food timing, or supplement use that move with sleep, HRV, recovery mismatch, fatigue, soreness, or GI notes.',
      '- Biomarkers plus sleep: ferritin/iron, vitamin D, thyroid, inflammation, glucose/lipids, cortisol if present, or similar markers that may help explain sleep depth, wakeups, latency, morning energy, or restless periods.',
      '- Supplement interplay: timing, dose, starts/stops, or combinations that line up with sleep, HRV, GI symptoms, training response, or lab movement. Treat this as a hypothesis, not advice to start or stop anything.',
      '- Surprising mismatches: an independent signal improves while another worsens, or the user beats or misses their baseline in a way vendor scores do not explain.',
      '- Research-backed hypotheses: a credible outside study suggests a mechanism, and the vault either supports, contradicts, or narrows it for this user.',
      '- Food capture: meals, snacks, photos, rough portions, alcohol, caffeine, timing, restaurant meals, or casual "I ate this" notes that line up with sleep, energy, GI symptoms, training, cravings, mood, or next-day recovery. Do not require perfect logging.',
      '- CGM and running food/symptom logs: glucose curves, meal timing, caffeine, exercise, symptoms, and rescue foods that reveal a practical personal pattern, such as a repeatable dip, delayed recovery, stable meal, or "brain floor." Keep it observational; do not diagnose insulin sensitivity, hypoglycemia, or treatment needs.',
      '- Easy missing measurement: if one small measurement would clarify the hypothesis, suggest it plainly, such as morning weight, blood pressure, waist, symptom score, energy 1-5, hunger 1-5, caffeine time, a meal photo, or supplement time.',
      '- Supplement and pill routines: timing, dose consistency, missed days, starts/stops, refill gaps, or stack changes that line up with sleep, HRV, symptoms, workouts, or labs. Do not recommend starting, stopping, or changing medications.',
      '- Food planning: places where a goal would be easier with a practical meal, grocery, or prep change, such as protein at breakfast, lower-friction dinners, travel snacks, or fewer late meals.',
      '- Goal progress: small behaviors that appear to move the user toward or away from a stated goal, but only when they reveal a non-obvious lever, bottleneck, or tradeoff. A goal plus missing or messy logs is not enough.',
      '- Subjective state: mood, stress, soreness, motivation, libido, focus, cravings, or "felt awful/great" notes that explain wearable, food, lab, or supplement patterns better than the raw score does.',
      '- Adherence friction: recurring places where the user forgets to log, take supplements, eat enough, prep food, or wind down, plus one low-effort way to make the behavior easier.',
      '- Fun experiments: suggest a tiny one-week experiment only when it follows from the data, is low risk, and has a clear thing to measure.',
      '',
      "A finding clears the bar only when it is specific to this user's vault, has concrete evidence, is not a repeat of an existing wiki finding, and can be said with uncertainty.",
      'Interestingness gate: send only if the finding is worth a short weekly note. It should make the user think "I did not know that about me" or change what they might measure, try, interpret, or ignore. Interesting can mean surprising, explanatory, actionable, hunch-falsifying, or showing a stable personal threshold or tradeoff; it does not have to be a tidy recommendation.',
      'Suppress true-but-boring findings. Do not send when the main point is missing data, messy tags, lack of evidence for a stated goal, generic goal progress, or "Murph cannot currently see X." Better tagging or more complete logging can be a caveat or follow-up, but it is not the insight.',
      "Reject tautological findings: do not treat a vendor score as the insight when the evidence is a direct or obvious input to how that score is designed or calculated. For example, do not say WHOOP recovery tracks sleep, HRV, resting heart rate, or respiratory rate unless the finding isolates a non-obvious mismatch, exception, lag, threshold, or personal pattern beyond the score's formula.",
      'Prefer findings that compare independent signals, explain a surprising mismatch, show a durable threshold, or expose a personal tradeoff the user could plausibly act on.',
      'Prefer insights that make the user feel more in control of their day. Avoid insights that only explain a score, praise or criticize compliance, or require perfect tracking to be useful.',
      'Stop when one candidate clearly clears the bar or clearly does not; do not keep researching to make a weak idea sound interesting.',
      '',
      'If nothing clears the bar, suppress the scheduled message and do not append to the wiki.',
      '',
      'If something clears the bar:',
      '- Use the current local date as the section heading: `YYYY-MM-DD`.',
      '- If `weekly-health-insights` already has a `YYYY-MM-DD` section, treat it as this run\'s finding: read it, do not append another section, and still send the concise note from that section.',
      '- Otherwise append one dated section to the single rolling page with the locked append surface, for example: `vault-cli knowledge append-section weekly-health-insights YYYY-MM-DD --title "Weekly health insights" --body <markdown> --source-path <canonical-vault-path>`. Cite only canonical vault source paths, never `derived/**` or `.runtime/**` paths.',
      '- If append-section reports that the section already exists, another run created it first: read `weekly-health-insights` and send the concise note from that existing section.',
      '- Then send one concise note in plain adult language: what you noticed, the simple translation, the evidence, why it may matter, and a light optional follow-up.',
      '- Do not make the user infer the point from raw biomarker names, lab ranges, supplement ingredients, or device jargon. Explain the marker or mechanism in one short phrase when it matters, such as "TSH is the brain\'s signal asking the thyroid for more hormone."',
      '- Name the practical takeaway clearly: watch this context next time, measure one thing, test a hunch, ignore a misleading score, change a low-risk behavior, or ask a clinician. If the short note would be confusing, simplify the framing or choose another candidate.',
      '',
      'Do not give generic health tips, medical diagnosis, causal claims without proof, or alarmist language.',
    ].join('\n'),
  },
  {
    automationId: MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
    slug: 'weekly-health-research-scout',
    title: 'Weekly health research scout',
    summary:
      'A weekly scout for new studies, therapies, treatments, and health research that may relate to your current context.',
    schedule: {
      kind: 'cron',
      expression: '0 11 * * 5',
    },
    continuityPolicy: 'fresh',
    requiredRuntimeEnvKeys: ['EXA_API_KEY'],
    tags: [
      'murph-managed:weekly-health-research-scout',
      ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG,
    ],
    instructions: [
      'Each Friday morning, produce a concise weekly health research scout for the configured automation route.',
      '',
      'Goal:',
      "Find 0-3 new studies, therapies, treatments, clinical guidelines, or research insights from the last 60 days that clearly relate to the user's current health context.",
      '',
      'Before choosing items:',
      '- Read the derived knowledge index.',
      '- Read `vault-cli knowledge show weekly-health-research-scout`. If missing, treat as no prior research scout ledger.',
      '- Check that `EXA_API_KEY` is available in the runtime environment. If it is missing, suppress the scheduled message and do not append to the wiki.',
      '- Build a compact local research profile from the vault: labs/biomarkers, activity, sleep, recovery, supplements, conditions or concerns, active experiments, and stated goals.',
      '- The external profile must be tag-level only. Do not send raw lab values, names, dates of birth, full notes, medical records, or precise private identifiers to external providers.',
      '- Use `vault-cli research scout` once with the compact profile.',
      '- Do not perform an open-ended web browsing loop.',
      '- Deduplicate against prior `weekly-health-research-scout` sections.',
      '',
      'Candidate quality rules:',
      '- Prefer human studies, clinical guidelines, meta-analyses, systematic reviews, randomized trials, and large prospective cohorts.',
      '- Include therapies or treatments only when source quality is credible.',
      '- Treat preprints, animal studies, cell studies, press releases, supplement marketing, podcasts, and tweets as weak evidence.',
      '- Reject generic health news.',
      "- Reject items that are not clearly related to the user's vault context.",
      '- Reject alarmist or fear-mongering interpretations.',
      '- Do not recommend starting, stopping, or changing medications.',
      '- For medical topics, frame the item as a clinician discussion prompt, not a diagnosis or prescription.',
      '',
      'If nothing clears the bar:',
      '- Suppress the scheduled message and do not append to the wiki.',
      '',
      'If something clears the bar:',
      '- Send 1-3 items max.',
      '- Include at most one kudos item when research supports something the user is already doing well.',
      '- For each item include:',
      '  - study/source and date',
      '  - why it may matter for this user specifically',
      '  - evidence strength',
      '  - one useful action, experiment, or clinician question',
      '  - one thing not to overinterpret',
      '- Keep the message practical, calm, and non-alarmist.',
      '- Append one dated section to `weekly-health-research-scout`.',
    ].join('\n'),
  },
] satisfies readonly MurphManagedAutomationSeed[]

export async function applyMurphManagedAutomations(
  input: ApplyMurphManagedAutomationsInput,
): Promise<ApplyMurphManagedAutomationsResult> {
  const now = input.now ?? new Date()
  const seeds =
    input.seeds ??
    [
      ...MURPH_MANAGED_AUTOMATIONS,
      ...(await buildExperimentFinalResultsSeeds({ vaultRoot: input.vaultRoot, now })),
    ]
  let createRoute: AutomationRoute | null | undefined
  const resolveCreateRoute = async (): Promise<AutomationRoute | null> => {
    if (createRoute !== undefined) {
      return createRoute
    }
    createRoute = await resolveMurphManagedAutomationCreateRoute(input)
    return createRoute
  }
  const result: ApplyMurphManagedAutomationsResult = {
    created: 0,
    skipped: 0,
    updated: 0,
  }

  for (const seed of seeds) {
    const existing = await showAutomation({
      automationId: seed.automationId,
      vaultRoot: input.vaultRoot,
    })

    if (!existing) {
      if (!murphManagedAutomationRuntimeRequirementsMet(seed, input.runtimeEnv)) {
        result.skipped += 1
        continue
      }

      if (isStaleMurphManagedOneShotSeed(seed, now)) {
        result.skipped += 1
        continue
      }

      const existingSlug = await showAutomation({
        slug: seed.slug,
        vaultRoot: input.vaultRoot,
      })
      if (existingSlug) {
        result.skipped += 1
        continue
      }

      const route = await resolveCreateRoute()
      if (!route) {
        result.skipped += 1
        continue
      }

      const summary = normalizeMurphManagedAutomationSummary(seed)
      await upsertAutomation({
        automationId: seed.automationId,
        continuityPolicy: resolveMurphManagedAutomationContinuity(seed),
        instructions: seed.instructions,
        now,
        route,
        schedule: seed.schedule,
        slug: seed.slug,
        status: 'active',
        ...(summary === null
          ? {}
          : { summary }),
        tags: buildMurphManagedAutomationTags(seed),
        title: seed.title,
        vaultRoot: input.vaultRoot,
      })
      result.created += 1
      continue
    }

    if (existing.status !== 'active') {
      result.skipped += 1
      continue
    }

    if (!murphManagedAutomationRuntimeRequirementsMet(seed, input.runtimeEnv)) {
      result.skipped += 1
      continue
    }

    if (isStaleMurphManagedOneShotSeed(seed, now)) {
      result.skipped += 1
      continue
    }

    if (!murphManagedAutomationSeedChanged(existing, seed)) {
      result.skipped += 1
      continue
    }

    const summary = normalizeMurphManagedAutomationSummary(seed)
    await upsertAutomation({
      automationId: existing.automationId,
      continuityPolicy: resolveMurphManagedAutomationContinuity(seed),
      instructions: seed.instructions,
      now,
      // Routes are user/runtime-owned: seeds never carry one, so updates
      // preserve the existing route without re-checking deliverability.
      // Only the create path validates routes, because that is the only
      // point where this module chooses one.
      route: existing.route,
      schedule: seed.schedule,
      slug: existing.slug,
      status: existing.status,
      ...(summary === null
        ? {}
        : { summary }),
      tags: buildMurphManagedAutomationTags(seed),
      title: seed.title,
      vaultRoot: input.vaultRoot,
    })
    result.updated += 1
  }

  return result
}

async function resolveMurphManagedAutomationCreateRoute(
  input: ApplyMurphManagedAutomationsInput,
): Promise<AutomationRoute | null> {
  if (input.defaultRoute !== undefined) {
    return input.defaultRoute
      ? resolveDeliverableAutomationRoute(input.defaultRoute)
      : null
  }

  const resolvedTarget = await applyAssistantSelfDeliveryTargetDefaults(
    {
      channel: null,
      deliveryTarget: null,
      identityId: null,
      participantId: null,
      threadId: null,
    },
    {
      allowSingleSavedTargetFallback: true,
    },
    input.operatorHomeRoot ?? undefined,
  )

  return resolveDeliverableAutomationRoute(
    resolveAssistantDeliveryRouteWithCurrentRoute(resolvedTarget, null),
  )
}

function murphManagedAutomationSeedChanged(
  existing: AutomationRecord,
  seed: MurphManagedAutomationSeed,
): boolean {
  // A seed without a summary leaves the stored summary unmanaged. This must
  // match upsertAutomation's omitted-field semantics (an omitted summary
  // preserves the existing one); comparing against null here would report
  // "changed" on every run and rewrite the record forever.
  const summary = normalizeMurphManagedAutomationSummary(seed)
  return existing.title !== seed.title ||
    (summary !== null && existing.summary !== summary) ||
    existing.continuityPolicy !== resolveMurphManagedAutomationContinuity(seed) ||
    existing.instructions !== seed.instructions ||
    !murphManagedAutomationValuesEqual(existing.schedule, seed.schedule) ||
    !murphManagedAutomationValuesEqual(
      existing.tags,
      buildMurphManagedAutomationTags(seed),
    )
}

function buildMurphManagedAutomationTags(
  seed: MurphManagedAutomationSeed,
): string[] {
  return [
    ...new Set([
      ...MURPH_MANAGED_AUTOMATION_BASE_TAGS,
      ...(seed.tags ?? []),
    ].flatMap((tag) => normalizeMurphManagedAutomationText(tag) ?? [])),
  ]
}

function resolveMurphManagedAutomationContinuity(
  seed: MurphManagedAutomationSeed,
): AutomationContinuityPolicy {
  return seed.continuityPolicy ?? 'preserve'
}

function murphManagedAutomationRuntimeRequirementsMet(
  seed: MurphManagedAutomationSeed,
  runtimeEnv: Readonly<Record<string, string | undefined>> | undefined,
): boolean {
  if (!runtimeEnv || !seed.requiredRuntimeEnvKeys?.length) {
    return true
  }

  return seed.requiredRuntimeEnvKeys.every((key) =>
    typeof runtimeEnv[key] === 'string' && runtimeEnv[key].trim().length > 0
  )
}

function normalizeMurphManagedAutomationSummary(
  seed: MurphManagedAutomationSeed,
): string | null {
  return normalizeMurphManagedAutomationText(seed.summary)
}

function normalizeMurphManagedAutomationText(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : null
}

function murphManagedAutomationValuesEqual(
  left: unknown,
  right: unknown,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isStaleMurphManagedOneShotSeed(
  seed: MurphManagedAutomationSeed,
  now: Date,
): boolean {
  if (seed.schedule.kind !== 'at') {
    return false
  }

  const scheduledAtMs = Date.parse(seed.schedule.at)
  const nowMs = now.getTime()
  if (!Number.isFinite(scheduledAtMs) || !Number.isFinite(nowMs)) {
    return true
  }

  return scheduledAtMs + MURPH_MANAGED_ONE_SHOT_NOTIFICATION_EXPIRES_AFTER_MS <= nowMs
}
