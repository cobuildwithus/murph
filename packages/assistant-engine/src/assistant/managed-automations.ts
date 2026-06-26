import {
  patchAutomation,
  showAutomation,
  upsertAutomation,
  type AutomationRecord,
} from '@murphai/core'
import {
  MURPH_PRODUCT_ORIGIN,
  type AutomationContinuityPolicy,
  type AutomationRoute,
  type AutomationSchedule,
  type AutomationStatus,
} from '@murphai/contracts'
import {
  resolveAssistantDeliveryRouteWithCurrentRoute,
} from '@murphai/operator-config/assistant/current-delivery-route'
import {
  applyAssistantSelfDeliveryTargetDefaults,
} from '@murphai/operator-config/operator-config'
import { ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG } from './automation-tags.js'
import {
  resolveDeliverableAutomationRoute,
  type AssistantCronDeliveryRouteValidationProfile,
} from './cron/targets.js'
import { buildExperimentFinalResultsSeeds } from './experiment-support-automations.js'
import { MURPH_ONBOARDING_FOLLOWUP_AUTOMATION } from './onboarding-followup-automation.js'

export { MURPH_ONBOARDING_FOLLOWUP_AUTOMATION }

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
  routeValidationProfile?: AssistantCronDeliveryRouteValidationProfile
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
export const MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID =
  'automation_01K0Z7X9Y8W6V5T4S3R2Q1P0NM'

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

const LEGACY_ONBOARDING_FOLLOWUP_AUTOMATION_INSTRUCTIONS = [
  'This scheduled check helps continue Murph setup.',
  '',
  'First inspect onboarding status with `vault-cli assistant onboarding status`.',
  '',
  'If onboarding is completed or declined, run `vault-cli automation set-status finish-onboarding-followup --status archived` and return skip.',
  '',
  'If onboarding is still open, offer one brief, natural in-chat message inviting setup to continue. Keep it low-pressure, do not mention internal state, and do not use a fixed script.',
].join('\n')

const LEGACY_ONBOARDING_FOLLOWUP_AUTOMATION_TAGS = [
  'assistant',
  'onboarding',
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
      expression: '0 12 * * 0',
    },
    continuityPolicy: 'fresh',
    tags: [
      'murph-managed:weekly-health-insight',
    ],
    instructions: [
      'Each Sunday at noon local time, find one useful, non-obvious personal health/body insight that goes beyond dashboards, generic advice, and vendor score formulas.',
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
      expression: '30 19 * * 3',
    },
    continuityPolicy: 'fresh',
    requiredRuntimeEnvKeys: ['EXA_API_KEY'],
    tags: [
      'murph-managed:weekly-health-research-scout',
    ],
    instructions: [
      'Each Wednesday at 7:30 PM local time, run a quiet weekly health research scout for the configured automation route.',
      '',
      'Outcome:',
      "Surface 0-1 genuinely useful research-backed note that changes how the user might think about a current health experiment, habit, symptom, lab, device trend, or clinician question.",
      'If nothing is useful enough to feel like a natural chat message from Murph, send nothing.',
      '',
      'Language and conversational style:',
      "- Write the outbound note in the user's normal Murph chat language. If unclear, use English.",
      '- Do not infer the output language from Telegram, source language, vault timezone, current location, or foreign-language text in retrieved sources.',
      '- Do not mix languages except for proper nouns, study names, product names, or unavoidable technical terms.',
      '- The sent note should feel like a thoughtful chat message, not a research digest, literature review, or evidence table.',
      '- Do not use a numbered list of studies.',
      '- Do not use fixed labels like `Why it matters`, `Evidence strength`, `Confidence`, `Practically`, `Do not overinterpret`, or `Basically` in the user-facing message.',
      '- Do not lead with journal, publisher, study type, or publication date. Lead with the useful point for the user.',
      '',
      'Evidence and retrieval budget:',
      '- Read the derived knowledge index.',
      '- Read `vault-cli knowledge show weekly-health-research-scout`. If missing, treat as no prior research scout ledger.',
      '- Check that `EXA_API_KEY` is available in the runtime environment. If it is missing, suppress the scheduled message and do not append to the wiki.',
      '- Build a compact local research profile from the vault: labs/biomarkers, activity, sleep, recovery, supplements, conditions or concerns, active experiments, and stated goals.',
      '- The external profile must be tag-level only. Do not send raw lab values, names, dates of birth, full notes, medical records, precise private identifiers, organizations, locations, events, or raw measurements to external providers.',
      '- Use only broad lowercase non-identifying category tags, such as sleep, metabolic health, glucose, hs-crp, resistance training, creatine, type 2 diabetes, better recovery, or morning light.',
      '- Define 1-4 focused, mechanism-shaped research lanes tied to current questions or experiments. Group related tags into one lane; do not create one lane per tag. Good lane labels include evening light and sleep, wearable hrv reliability, training recovery, or creatine and recovery.',
      '- If unsure about the batch file body, run `vault-cli research scout-batch-payload-schema --format json` before the scout call.',
      '- Use `vault-cli research scout-batch` once. The `--input` body is `{"lanes":[{"label":"sleep","profile":{...}}]}`. Each lane profile uses bucket fields `topics`, `biomarkers`, `behaviors`, `supplements`, `conditionsOrConcerns`, `goals`, and `activeExperiments`; do not use a generic `tags` field. Example body: `{"lanes":[{"label":"evening light and sleep","profile":{"topics":["sleep"],"behaviors":["evening light"],"activeExperiments":["blue light glasses"]}},{"label":"wearable hrv reliability","profile":{"topics":["recovery"],"behaviors":["wearable tracking"]}}]}`.',
      '- Pass publication bounds as `--since` and `--until`; YYYY-MM-DD dates or full ISO timestamps are accepted. Prefer the last two years and cap `--maxCandidatesPerLane` at 8 for this automation.',
      '- Treat the returned results as a candidate pool only. Review, dedupe, and rank candidates locally against the current vault context and prior research scout ledger, then either send one conversational note or suppress the run.',
      '- Do not perform an open-ended web browsing loop.',
      '',
      'Selection rules:',
      "- A candidate clears the bar only if it changes one practical question the user is already working on: how to run an active experiment, what to measure next, what to ask a clinician, how to interpret a device or lab signal, or what noisy metric to ignore.",
      '- Prefer human studies, clinical guidelines, meta-analyses, systematic reviews, randomized trials, and large prospective cohorts, but do not send a stronger-but-irrelevant source over a weaker-but-practical one.',
      '- Include therapies or treatments only when source quality is credible.',
      '- Treat preprints, animal studies, cell studies, press releases, supplement marketing, podcasts, and tweets as weak evidence.',
      '- Reject generic health news, obvious habit advice, mildly topical findings, and narrow supplement-timing, performance-hack, or biomarker trivia.',
      "- Reject items that are not clearly related to the user's vault context.",
      '- Reject alarmist or fear-mongering interpretations.',
      '- Do not recommend starting, stopping, or changing medications.',
      '- For medical topics, frame the item as a clinician discussion prompt, not a diagnosis or prescription.',
      '',
      'If nothing clears the bar:',
      '- Suppress the scheduled message and do not append to the wiki.',
      '',
      'If something clears the bar:',
      '- Send exactly one short note about the single best item. Never send a second item, even if several candidates are interesting.',
      '- Lead with why the item is useful for this user, not with source metadata.',
      '- Mention source provenance naturally only when it helps trust, such as `I found a recent sleep paper...`; do not include source URLs unless the user asks.',
      '- Keep study names, publication dates, study type, evidence strength, source URLs, candidate ranking notes, and detailed caveats in the `weekly-health-research-scout` wiki section instead of the outbound note unless the user asks for sources.',
      '- Explain any technical term in ordinary language before using it.',
      '- Put one practical next move in the prose: tweak an active experiment, measure one thing, ignore a noisy metric, ask a clinician a better question, or keep a simple behavior stable.',
      '- Keep the message practical, calm, and non-alarmist.',
      '- Append one dated section to `weekly-health-research-scout` with source details, candidate ranking notes, and why the final item was chosen.',
    ].join('\n'),
  },
  {
    automationId: MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID,
    slug: 'weekly-product-updates',
    title: 'This week in Murph',
    summary: 'A personalized weekly look at what is new in Murph.',
    schedule: {
      kind: 'cron',
      expression: '30 11 * * 4',
    },
    continuityPolicy: 'fresh',
    tags: [
      'murph-managed:weekly-product-updates',
    ],
    instructions: [
      'Each Thursday at 11:30 AM local time, compose one concise personalized in-chat update about what is new in Murph.',
      '',
      `Fetch the canonical JSON feed once from ${MURPH_PRODUCT_ORIGIN}/api/changelog?days=7&featureLimit=70&improvementLimit=10.`,
      '- Treat that feed as the only source of shipped-product truth. Do not infer launches from repository history or invent availability, benefits, or try-it instructions.',
      '- If the feed is unavailable, invalid, or empty, return `{"kind":"skip","privateSummary":"Changelog feed unavailable or empty."}` and do not attach media.',
      '',
      'Choose 3-7 items that are most likely to matter to this user. Rank using only context Murph already has for normal assistance: connected providers and channels, active experiments and automations, recurring request categories, and features the user already uses.',
      '- Do not inspect raw health values solely to personalize product news.',
      '- Prefer relevance, practical benefit, editorial priority, and novelty. Do not fill space with weak matches.',
      '- Use the canonical title, summary, URL, and tryIt fields from the feed.',
      '',
      'Keep this scheduled announcement text-only. Do not create, attach, or send a changelog image or response media.',
      '',
      'Write a brief, warm note with the selected updates, why the top choices fit this user.',
      'If the user has not received one of these announcement automations before, let them know what the announcement is for at a high level before diving in (eg cool new features, helps us make Murph better for you every week if you give us good feedback).',
      'Close by inviting the user to reply if any update sounds interesting, or if they have another feature in mind they would like Murph to add.',
      '',
      'On a later user turn, call `murph.submit_product_feedback` for explicit product frustration, feature requests, interest in shipped changelog items, clear inferred workflow friction, or repeated Murph-observed product/tool friction. Start inferred summaries with `Speculative:` and assistant-observed summaries with `Murph-observed:`. Do not log vague low-confidence guesses. Use only structured kind, a concise product-only summary, and optional changelog item ids; do not include tags, topics, raw user wording, raw conversation text, health details, identifiers, contact details, secrets, or provider payloads.',
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

    if (!murphManagedAutomationSeedChanged(existing, seed)) {
      result.skipped += 1
      continue
    }

    // Seed has changed. Reconcile in place. A one-shot whose desired
    // occurrence already passed cannot fire at the new time, but if the
    // legacy stored occurrence is also a one-shot still in the future,
    // keep firing at the legacy time so the user still gets the moment
    // with the new content. Archive only when neither the new desired nor
    // a legacy one-shot occurrence can still fire. A recurring legacy
    // schedule (cron/every/dailyLocal) under one-shot instructions would
    // fire the final-review repeatedly, so it must be replaced with the
    // new desired schedule (and archived if that is itself stale).
    const newDesiredStale = isStaleOneShotSchedule(seed.schedule, now)
    const legacyOneShotStillFires =
      existing.schedule.kind === 'at' &&
      !isStaleOneShotSchedule(existing.schedule, now)
    let reconciledSchedule: MurphManagedAutomationSchedule = seed.schedule
    let reconciledStatus: AutomationStatus = existing.status
    if (newDesiredStale && legacyOneShotStillFires) {
      reconciledSchedule = existing.schedule as MurphManagedAutomationSchedule
    } else if (newDesiredStale) {
      reconciledStatus = 'archived'
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
      schedule: reconciledSchedule,
      slug: existing.slug,
      status: reconciledStatus,
      ...(summary === null
        ? {}
        : { summary }),
      tags: buildMurphManagedAutomationTags(seed),
      title: seed.title,
      vaultRoot: input.vaultRoot,
    })
    result.updated += 1
  }

  if (await reconcileExistingOnboardingFollowupAutomation({
    now,
    vaultRoot: input.vaultRoot,
  })) {
    result.updated += 1
  }

  return result
}

async function reconcileExistingOnboardingFollowupAutomation(input: {
  now: Date
  vaultRoot: string
}): Promise<boolean> {
  const existing = await showAutomation({
    slug: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
    vaultRoot: input.vaultRoot,
  })
  if (!existing || existing.status === 'archived') {
    return false
  }

  if (!isManagedOnboardingFollowupAutomation(existing)) {
    return false
  }

  if (!onboardingFollowupAutomationDefinitionChanged(existing)) {
    return false
  }

  await patchAutomation({
    continuityPolicy: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.continuityPolicy,
    instructions: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
    lookup: existing.automationId,
    now: input.now,
    summary: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary,
    tags: [...MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags],
    title: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.title,
    vaultRoot: input.vaultRoot,
  })

  return true
}

async function resolveMurphManagedAutomationCreateRoute(
  input: ApplyMurphManagedAutomationsInput,
): Promise<AutomationRoute | null> {
  const routeValidationProfile = input.routeValidationProfile ?? 'local'
  if (input.defaultRoute !== undefined) {
    return input.defaultRoute
      ? resolveDeliverableAutomationRoute(
          input.defaultRoute,
          routeValidationProfile,
        )
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
    routeValidationProfile,
  )
}

function onboardingFollowupAutomationDefinitionChanged(
  existing: AutomationRecord,
): boolean {
  return existing.title !== MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.title ||
    existing.summary !== MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary ||
    existing.continuityPolicy !== MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.continuityPolicy ||
    existing.instructions !== MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions ||
    !murphManagedAutomationValuesEqual(
      existing.tags,
      MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags,
    )
}

function isManagedOnboardingFollowupAutomation(
  automation: AutomationRecord,
): boolean {
  return isCurrentManagedOnboardingFollowupAutomation(automation) ||
    isLegacySeededOnboardingFollowupAutomation(automation)
}

function isCurrentManagedOnboardingFollowupAutomation(
  automation: AutomationRecord,
): boolean {
  const tags = new Set(automation.tags)
  return tags.has('murph-managed') &&
    tags.has('murph-managed:onboarding-followup')
}

function isLegacySeededOnboardingFollowupAutomation(
  automation: AutomationRecord,
): boolean {
  return automation.slug === MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug &&
    automation.instructions === LEGACY_ONBOARDING_FOLLOWUP_AUTOMATION_INSTRUCTIONS &&
    murphManagedAutomationValuesEqual(
      automation.tags,
      LEGACY_ONBOARDING_FOLLOWUP_AUTOMATION_TAGS,
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
  return isStaleOneShotSchedule(seed.schedule, now)
}

function isStaleOneShotSchedule(
  schedule: AutomationSchedule,
  now: Date,
): boolean {
  if (schedule.kind !== 'at') {
    return false
  }

  const scheduledAtMs = Date.parse(schedule.at)
  const nowMs = now.getTime()
  if (!Number.isFinite(scheduledAtMs) || !Number.isFinite(nowMs)) {
    return true
  }

  return scheduledAtMs + MURPH_MANAGED_ONE_SHOT_NOTIFICATION_EXPIRES_AFTER_MS <= nowMs
}
