import { describe, expect, it } from 'vitest'

import {
  buildAssistantNotificationDecisionSystemPrompt,
  buildAssistantSystemPrompt,
} from '../src/assistant/system-prompt.js'

function buildPrompt(
  assistantCommandAccessMode: 'bound-tools' | 'direct-cli' | 'none',
  turnTrigger: 'automation-cron' | 'manual-ask' | null = null,
  options?: {
    earlySessionOnboarding?: boolean
  },
) {
  return buildAssistantSystemPrompt({
    assistantCliContract: null,
    allowSensitiveHealthContext: true,
    assistantCommandAccessMode,
    assistantHostedDeviceConnectAvailable: false,
    assistantKnowledgeToolsAvailable: false,
    channel: null,
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    currentLocalDate: '2026-04-10',
    currentTimeZone: 'Australia/Sydney',
    earlySessionOnboarding: options?.earlySessionOnboarding ?? false,
    modelBehaviorProfile: 'default',
    turnTrigger,
    vaultOverview: null,
  })
}

function buildNotificationPrompt(channel: string | null = null) {
  return buildAssistantNotificationDecisionSystemPrompt({
    allowSensitiveHealthContext: true,
    channel,
    currentLocalDate: '2026-04-10',
    currentTimeZone: 'Australia/Sydney',
    vaultOverview: null,
  })
}

describe('buildAssistantSystemPrompt', () => {
  it('tells bound-tool sessions to route run distance questions through vault.cli.run', () => {
    const prompt = buildPrompt('bound-tools')

    expect(prompt).toContain('call `vault.cli.run` with `route estimate ...`')
    expect(prompt).toContain('describes a route-bearing trip or workout between recognizable places')
    expect(prompt).toContain('distance, duration, traffic time, or approximate elevation')
    expect(prompt).toContain('`walking`, `cycling`, `driving`, or `driving-traffic`')
    expect(prompt).toContain('even if the user did not explicitly ask for them')
    expect(prompt).toContain('prefer more specific place text or coordinates')
    expect(prompt).toContain('provider may still return a broader display label')
  })

  it('tells direct-cli sessions to use vault-cli route estimate directly', () => {
    const prompt = buildPrompt('direct-cli')

    expect(prompt).toContain('use `vault-cli route estimate ...` and choose the matching profile')
    expect(prompt).toContain('describes a route-bearing trip or workout between recognizable places')
    expect(prompt).toContain('`walking`, `cycling`, `driving`, or `driving-traffic`')
    expect(prompt).toContain('even if the user did not explicitly ask for them')
    expect(prompt).toContain('prefer more specific place text or coordinates')
    expect(prompt).toContain('provider may still return a broader display label')
  })

  it('keeps the fallback route-estimation guidance aligned with the explicit profiles', () => {
    const prompt = buildPrompt('none')

    expect(prompt).toContain('prefer `vault-cli route estimate ...`')
    expect(prompt).toContain('route-bearing trip or workout')
    expect(prompt).toContain('`walking`, `cycling`, `driving`, or `driving-traffic`')
    expect(prompt).toContain('even if the user did not explicitly ask for them')
    expect(prompt).toContain('prefer more specific place text or coordinates')
    expect(prompt).toContain('provider may still return a broader display label')
  })

  it('tells the assistant to capture detailed food and supplement logging context', () => {
    const prompt = buildPrompt('bound-tools')

    expect(prompt).toContain(
      'Answer in natural conversation by default. Use structured sections only when the user asks for a breakdown, when you are compiling research or a longer synthesis, or when structure materially improves clarity.',
    )
    expect(prompt).toContain(
      'Keep the distinction between what the vault shows, what you infer, and what you suggest clear in your reasoning. In normal replies, express that naturally in prose rather than labeled sections.',
    )
    expect(prompt).toContain(
      'try hard to capture the full ingredient or component list, serving size or per-item amounts, dose units, and calories for future reference',
    )
    expect(prompt).toContain(
      'Use structured meal ingredients and nutrition fields when you can support them',
    )
    expect(prompt).toContain('inspect any attached labels, menus, or photos first')
    expect(prompt).toContain(
      'use available web lookup to recover likely ingredients, calories, serving amounts, or nutrition provenance before writing',
    )
    expect(prompt).toContain('Mark uncertainty plainly instead of inventing exact values.')
  })

  it('tells the assistant to recover detailed workout structure from freeform activity logs', () => {
    const prompt = buildPrompt('bound-tools')

    expect(prompt).toContain(
      'try hard to capture the full recoverable structure for future reference, including workout type, duration, route, distance, pace, elevation, exercises, reps, sets, intervals, and segment-level details',
    )
    expect(prompt).toContain(
      'treat that as implicit permission to recover estimated distance, duration, or elevation for logging when enough detail is present',
    )
    expect(prompt).toContain('even if the user did not explicitly ask for distance')
  })

  it('adds scheduled automation execution context for automation cron turns', () => {
    const prompt = buildPrompt('bound-tools', 'automation-cron')

    expect(prompt).toContain('This turn was triggered by an existing scheduled automation run.')
    expect(prompt).toContain('The automation already exists and is active.')
    expect(prompt).toContain(
      'Treat the user prompt as the execution instructions for this scheduled run.',
    )
  })

  it('does not add scheduled automation execution context for ordinary turns', () => {
    const prompt = buildPrompt('bound-tools', 'manual-ask')

    expect(prompt).not.toContain(
      'This turn was triggered by an existing scheduled automation run.',
    )
  })

  it('keeps local chat evidence guidance direct instead of path-heavy by default', () => {
    const prompt = buildPrompt('bound-tools')

    expect(prompt).toContain(
      'In local chat, mention relative file paths, record ids, dates, or source details when they genuinely help the user verify something or when the user asks for that level of detail.',
    )
    expect(prompt).toContain('Otherwise, keep the reply natural and direct.')
  })

  it('tells the assistant to trust successful save receipts without inventing no-op writes', () => {
    const prompt = buildPrompt('bound-tools')

    expect(prompt).toContain(
      'Use the matching write surface directly for straightforward captures and memory updates.',
    )
    expect(prompt).toContain(
      'Treat a successful save receipt as confirmation the requested write completed.',
    )
    expect(prompt).toContain(
      'If the result says nothing changed, do not claim that something new was saved.',
    )
  })

  it('prefers the new normalized wearable reads before older day/list or raw wearable inspection', () => {
    const prompt = buildPrompt('bound-tools')

    expect(prompt).toContain('`vault-cli wearables latest` for recent nightly summaries')
    expect(prompt).toContain(
      '`vault-cli wearables metric latest <metric>` for one metric\'s freshest reading',
    )
    expect(prompt).toContain(
      '`vault-cli wearables metric trend <metric>` for recent direction',
    )
    expect(prompt).toContain('`vault-cli wearables drift` for "what changed?" explanations')
    expect(prompt).toContain(
      'Use `vault-cli wearables day` or the relevant `vault-cli wearables sleep|activity|recovery|body|sources list` command when the question is date-specific or you need one summary family in more detail.',
    )
    expect(prompt).toContain(
      'Inspect raw events or samples only when those normalized surfaces still do not answer the question or the user explicitly asks for raw evidence.',
    )
  })

  it('uses the gradual early-session onboarding guidance when the first-contact flow is enabled', () => {
    const prompt = buildPrompt('bound-tools', null, { earlySessionOnboarding: true })

    expect(prompt).toContain('Early-session onboarding guidance:')
    expect(prompt).toContain(`Hey, I'm Murph — your personal health assistant.

Send me things as they happen: meals, workouts, supplements, labs, symptoms, whatever. I'll keep track of it all and help you spot patterns, answer questions, and stay on top of your goals.

Your own private health team, whenever you need it.

Ready to get started?`)
    expect(prompt).toContain(
      'Use onboarding to make a brand-new user feel oriented, not interviewed.',
    )
    expect(prompt).toContain(
      "What should I call you? And is there anything health-wise you've been curious about, working on, or dealing with lately?",
    )
    expect(prompt).toContain(
      'Useful context, whenever you have it: recent labs, health records, current meds or supplements, and wearable data can all help.',
    )
    expect(prompt).toContain(
      "You don't have to set everything up now. You can just text normal notes as things happen - sleep, food, workouts, symptoms, energy, questions - and I'll help keep the thread together over time.",
    )
    expect(prompt).toContain(
      'Want to start light? Send something like: "slept 5 hours, knee is bugging me" - I can log both and start watching for patterns.',
    )
    expect(prompt).toContain(
      'Do not append a capability paragraph, examples, or intake questions to it.',
    )
    expect(prompt).toContain(
      'If the user mentions urgent, severe, or safety-sensitive symptoms, do not stay in onboarding;',
    )
  })

  it('includes the protocol experiment onboarding guidance for planning and setup flows', () => {
    const prompt = buildPrompt('bound-tools')

    expect(prompt).toContain('Experiment onboarding:')
    expect(prompt).toContain(
      'Resolve the protocol page first with `vault-cli protocol show <protocol id or slug> --format json`.',
    )
    expect(prompt).toContain(
      "Use the protocol page's Health Commons `experimentOnboarding` block when available.",
    )
    expect(prompt).toContain(
      'Before setup questions, check whether the user already has an active experiment with `vault-cli experiment list --status active --format json`.',
    )
    expect(prompt).toContain('`vault-cli wearables latest --format json`')
    expect(prompt).toContain('`vault-cli wearables metric latest <metric> --format json`')
    expect(prompt).toContain('`vault-cli wearables metric trend <metric> --format json`')
    expect(prompt).toContain('`vault-cli wearables drift --format json`')
    expect(prompt).toContain(
      'treat that as a planning conversation until they explicitly confirm the final run plan.',
    )
    expect(prompt).toContain(
      'convert it into canonical experiment-linked records instead of leaving it only in chat prose',
    )
    expect(prompt).toContain(
      '`vault-cli experiment session log <id> --input -` for intervention sessions',
    )
    expect(prompt).toContain(
      '`vault-cli experiment context log <id> --input -` for confounders, symptoms, illness, travel, medication changes, or other context tied to the run.',
    )
    expect(prompt).toContain(
      'If exactly one missing detail blocks a faithful plan or experiment-linked record, ask one compact clarifying question, then continue.',
    )
    expect(prompt).toContain(
      'Create the run only after explicit confirmation, then use `vault-cli experiment create <slug> --title "<title>" --hypothesis "<hypothesis>" --startedOn <YYYY-MM-DD> --status active` for a simple run',
    )
    expect(prompt).toContain(
      'When you write a richer run, preserve the exact protocol `key`, `pageRevisionId`, `runSpecRevisionId`, and chosen `testPlanId` under `protocolRef`',
    )
    expect(prompt).toContain(
      'read `vault-cli experiment progress <id> --format json` so the message reflects current adherence, missing evidence, and review readiness instead of a generic nudge',
    )
    expect(prompt).toContain(
      'Use `vault-cli experiment outcome analyze <id> --format json` when the user asks for a run review, end-of-run interpretation, or worth-repeating judgment',
    )
    expect(prompt).toContain(
      'If the deterministic outcome is good enough to save and the user wants it persisted, use `vault-cli experiment outcome write <id> --format json`.',
    )
  })

  it('keeps source-attributed external protocols separate from the default run plan', () => {
    const prompt = buildPrompt('bound-tools')

    expect(prompt).toContain(
      'For source-attributed external protocols, keep the source routine separate from the user\'s run plan.',
    )
    expect(prompt).toContain(
      'Do not present a celebrity or external source protocol as Murph\'s default recommendation; offer a lower-burden variant or defer when the onboarding slots or safety context suggest poor fit.',
    )
  })

  it('uses early-signal language for experiment interpretations instead of causal certainty', () => {
    const prompt = buildPrompt('bound-tools')

    expect(prompt).toContain(
      'prefer early-signal, associated-with, may reflect, and confounded-by language over causal certainty unless the evidence is unusually clean.',
    )
  })
})

describe('buildAssistantNotificationDecisionSystemPrompt', () => {
  it('defaults experiment notifications to skip unless progress shows a real reason to send', () => {
    const prompt = buildNotificationPrompt('telegram')

    expect(prompt).toContain(
      'For experiment-related scheduled checks, inspect `vault-cli experiment progress <id> --format json` first when the target experiment is identifiable from the prompt or schedule context.',
    )
    expect(prompt).toContain(
      'Default to skip for experiment notifications unless there is a user-opted-in reminder due now, broken or missing data that blocks interpretation, a weekly summary, a review-ready transition, or a safety follow-up that genuinely needs outreach.',
    )
    expect(prompt).toContain('The bound outbound channel is telegram.')
  })
})
