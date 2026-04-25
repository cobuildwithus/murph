import { describe, expect, it } from 'vitest'

import {
  buildAssistantNotificationDecisionSystemPrompt,
  buildAssistantSystemPrompt,
} from '../src/assistant/system-prompt.js'

function buildPrompt(
  assistantCommandAccessMode: 'bound-tools' | 'direct-cli' | 'none',
  turnTrigger: 'automation-cron' | 'manual-ask' | null = null,
  options?: {
    activeExperimentContext?: string | null
    assistantHealthCommonsAccessMode?: 'bound-tools' | 'direct-cli' | 'none'
    assistantHostedDeviceConnectAvailable?: boolean
    assistantHostedDeviceConnectProviders?: Array<{ label: string; provider: string }>
    assistantToolNameAliases?: Record<string, string>
    channel?: string | null
    onboardingGuidance?: boolean
  },
) {
  return buildAssistantSystemPrompt({
    activeExperimentContext: options?.activeExperimentContext ?? null,
    assistantCliContract: null,
    allowSensitiveHealthContext: true,
    assistantCommandAccessMode,
    assistantHealthCommonsAccessMode:
      options?.assistantHealthCommonsAccessMode ?? assistantCommandAccessMode,
    assistantHostedDeviceConnectAvailable:
      options?.assistantHostedDeviceConnectAvailable ?? false,
    assistantHostedDeviceConnectProviders:
      options?.assistantHostedDeviceConnectProviders ?? [],
    assistantKnowledgeToolsAvailable: false,
    assistantToolNameAliases: options?.assistantToolNameAliases ?? null,
    channel: options?.channel ?? null,
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    currentLocalDate: '2026-04-10',
    currentTimeZone: 'Australia/Sydney',
    onboardingGuidance: options?.onboardingGuidance ?? false,
    modelBehaviorProfile: 'default',
    turnTrigger,
    vaultOverview: null,
  })
}

function buildNotificationPrompt(
  channel: string | null = null,
  options?: {
    activeExperimentContext?: string | null
    assistantHealthCommonsAccessMode?: 'bound-tools' | 'direct-cli' | 'none'
    assistantHostedDeviceConnectAvailable?: boolean
    assistantHostedDeviceConnectProviders?: Array<{ label: string; provider: string }>
    assistantToolNameAliases?: Record<string, string>
  },
) {
  return buildAssistantNotificationDecisionSystemPrompt({
    activeExperimentContext: options?.activeExperimentContext ?? null,
    allowSensitiveHealthContext: true,
    assistantHealthCommonsAccessMode:
      options?.assistantHealthCommonsAccessMode ?? 'bound-tools',
    assistantHostedDeviceConnectAvailable:
      options?.assistantHostedDeviceConnectAvailable ?? false,
    assistantHostedDeviceConnectProviders:
      options?.assistantHostedDeviceConnectProviders ?? [],
    assistantToolNameAliases: options?.assistantToolNameAliases ?? null,
    channel,
    currentLocalDate: '2026-04-10',
    currentTimeZone: 'Australia/Sydney',
    vaultOverview: null,
  })
}

function getOnboardingGuidanceSection(prompt: string): string {
  const start = prompt.indexOf('Conversation onboarding guidance:')
  const end = prompt.indexOf('Scheduled assistant automation commands')

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Expected onboarding guidance and cron guidance sections to be present')
  }

  return prompt.slice(start, end)
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

  it('renders provider-visible aliases for bound tool names when supplied', () => {
    const prompt = buildPrompt('bound-tools', null, {
      assistantToolNameAliases: {
        'healthCommons.search': 'healthCommons_search',
        'murph.device.connect': 'murph_device_connect',
        'vault.cli.run': 'vault_cli_run',
      },
    })

    expect(prompt).toContain('Use `healthCommons_search` or `healthCommons.listProtocols`')
    expect(prompt).toContain('call `vault_cli_run` with `route estimate ...`')
    expect(prompt).toContain('Use `vault_cli_run` as the canonical Murph runtime surface')
    expect(prompt).not.toContain('`vault.cli.run`')
  })

  it('uses Health Commons CLI commands instead of bound tools in direct CLI prompts', () => {
    const prompt = buildPrompt('direct-cli')

    expect(prompt).toContain('use `vault-cli commons search "<query>" --format json`')
    expect(prompt).toContain('`vault-cli commons protocol show <key-or-slug> --format json`')
    expect(prompt).toContain(
      'use `vault-cli commons search "<query>" --format json` or `vault-cli commons protocol list --format json` for fuzzy discovery',
    )
    expect(prompt).toContain(
      '`vault-cli knowledge ...` is for the user\'s derived knowledge wiki. It is not the canonical Health Commons corpus; use `vault-cli commons ...`',
    )
    expect(prompt).not.toContain('use `healthCommons.search`')
  })

  it('does not claim Health Commons access when no command surface is exposed', () => {
    const prompt = buildPrompt('none')

    expect(prompt).toContain(
      'if no Health Commons surface is available, do not claim to have inspected the corpus.',
    )
    expect(prompt).toContain(
      'If no Health Commons command or tool surface is exposed, do not claim to have inspected public protocol options',
    )
    expect(prompt).not.toContain('use `healthCommons.search`')
    expect(prompt).not.toContain('use `vault-cli commons search')
  })

  it('uses Health Commons native tools even when the general command surface is unavailable', () => {
    const prompt = buildPrompt('none', null, {
      assistantHealthCommonsAccessMode: 'bound-tools',
    })

    expect(prompt).toContain('Use `healthCommons.search` or `healthCommons.listProtocols`')
    expect(prompt).toContain(
      'Resolve the public protocol reference through Health Commons first: use `healthCommons.search` or `healthCommons.listProtocols`',
    )
    expect(prompt).toContain('use `healthCommons.*` for public Health Commons')
    expect(prompt).not.toContain('use `vault-cli commons search')
    expect(prompt).not.toContain('if no Health Commons surface is available')
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

  it('discourages raw Markdown emphasis in user-facing messaging channels', () => {
    const prompt = buildPrompt('bound-tools', null, { channel: 'telegram' })

    expect(prompt).toContain(
      'Avoid Markdown bold or italic markers for emphasis in ordinary replies.',
    )
    expect(prompt).toContain(
      'In messaging channels, assume clients may show raw Markdown markers; emphasize with plain wording, order, and concise labels instead.',
    )
    expect(prompt).toContain(
      'Do not wrap words in double asterisks or underscores for bold or italic emphasis; SMS-style clients may show those raw markers.',
    )
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

  it('uses the gradual conversation onboarding guidance when the first-contact flow is enabled', () => {
    const prompt = buildPrompt('bound-tools', null, { onboardingGuidance: true })

    expect(prompt).toContain('Conversation onboarding guidance:')
    expect(prompt).toContain(`Hey, I'm Murph — your personal health assistant.

Send me things as they happen: meals, workouts, supplements, labs, symptoms, whatever. I'll keep track of it all and help you spot patterns, answer questions, and stay on top of your goals.

Your own private health team, whenever you need it.

Ready to get started?`)
    expect(prompt).toContain(
      'Use this as a private checklist, not a script and not a user-facing form.',
    )
    expect(prompt).toContain(
      "What should I call you? And is there anything health-wise you've been curious about, working on, or dealing with lately?",
    )
    expect(prompt).toContain(
      'Capture what to call them. If they naturally share why they are here, use that as setup context, but do not force a reason.',
    )
    expect(prompt).toContain(
      'Give a short orientation: Murph can keep context over time from texts, records, labs, meds/supplements, wearables, meals, workouts, sleep, symptoms, energy, and questions.',
    )
    expect(prompt).toContain(
      'Help them choose one lightweight first logging habit or first question to bring back.',
    )
    expect(prompt).toContain(
      'Do not append a capability paragraph, examples, or intake questions to it.',
    )
    expect(prompt).toContain(
      'Onboarding stays active until the assistant runtime marks it complete.',
    )
    expect(prompt).toContain(
      'Do not mark onboarding complete just because they gave their name or initial context.',
    )
    expect(prompt).toContain(
      'Complete it only after basic orientation plus the relevant next step.',
    )
    expect(prompt).toContain(
      'Use `vault.cli.run` to execute `vault-cli assistant onboarding complete --reason <user_answered|user_declined|concrete_request>`.',
    )
    expect(prompt).toContain(
      'A short problem mention in response to the onboarding context question, such as sleep, stress, pain, or "I work too much," is setup context, not permission to start detailed troubleshooting.',
    )
    expect(prompt).toContain(
      'do not immediately rank goals, triage symptoms, ask diagnosis-style branching questions, or start a plan unless the user explicitly asks for concrete help.',
    )
    expect(prompt).toContain(
      'If the user mentions urgent, severe, or safety-sensitive symptoms, do not stay in onboarding;',
    )
  })

  it('keeps onboarding as a short checklist and offers supported wearable connection', () => {
    const prompt = buildPrompt('bound-tools', null, {
      onboardingGuidance: true,
      assistantHostedDeviceConnectAvailable: true,
      assistantHostedDeviceConnectProviders: [
        { label: 'Oura', provider: 'oura' },
        { label: 'WHOOP', provider: 'whoop' },
      ],
    })
    const onboarding = getOnboardingGuidanceSection(prompt)

    expect(onboarding).toContain(
      'Use this as a private checklist, not a script and not a user-facing form.',
    )
    expect(onboarding).toContain(
      'Advance items from the visible transcript when the user has already answered them. Ask at most one onboarding question per turn.',
    )
    expect(onboarding).toContain(
      'If the user mentions during onboarding that they use one of the supported wearable providers (Oura (`oura`) and WHOOP (`whoop`)), offer to connect it now with `murph.device.connect`.',
    )
    expect(onboarding).toContain(
      'If a supported wearable is mentioned, the next onboarding step should usually be whether they want to connect it now.',
    )
    expect(onboarding).toContain(
      'Keep each onboarding turn short: usually one paragraph and at most one question.',
    )
    expect(onboarding).toContain('Keep the check-in optional.')
    expect(onboarding).not.toContain('manual logging')
    expect(onboarding).not.toContain('screenshots')
    expect(prompt).toContain(
      'Hosted wearable connection is currently supported only for Oura (`oura`) and WHOOP (`whoop`). Use `murph.device.connect` for those providers only; for other apps or devices, say automatic connection is not available.',
    )
  })

  it('explains the narrow no-command onboarding fallback without claiming completion', () => {
    const prompt = buildPrompt('none', null, { onboardingGuidance: true })

    expect(prompt).toContain(
      'the runtime will settle only clear declines or concrete requests automatically',
    )
    expect(prompt).toContain('do not claim onboarding was marked complete')
  })

  it('includes the protocol experiment onboarding guidance for planning and setup flows', () => {
    const prompt = buildPrompt('bound-tools')

    expect(prompt).toContain('Experiment onboarding:')
    expect(prompt).toContain(
      'For health improvement ideas, protocol discovery, protocol setup, and experiment design, search Health Commons first.',
    )
    expect(prompt).toContain(
      'A Health Commons `protocol_variant` is a public reference protocol, not a private vault protocol record.',
    )
    expect(prompt).toContain(
      'Do not use private `vault-cli protocol show` or `vault-cli protocol list` as the discovery path for public Health Commons protocols.',
    )
    expect(prompt).toContain(
      '`assistant.knowledge.*` and `vault-cli knowledge ...` are for the user\'s derived knowledge wiki. They are not the canonical Health Commons corpus; use `healthCommons.*` for public Health Commons protocol, biomarker, and source discovery.',
    )
    expect(prompt).toContain(
      'Resolve the public protocol reference through Health Commons first: use `healthCommons.search` or `healthCommons.listProtocols` for fuzzy discovery, then `healthCommons.get` for the exact `protocol_variant` page before planning.',
    )
    expect(prompt).toContain(
      "Use the Health Commons page's `experimentOnboarding` block when available.",
    )
    expect(prompt).toContain(
      'Keep public Health Commons references, private vault protocol adaptations, and experiments separate.',
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

  it('includes active experiment context as a navigation-only prompt block when supplied', () => {
    const activeExperimentContext = [
      'Active experiment context for navigation only:',
      '- Sauna RHR (`sauna-rhr`, exp_test): started 2026-04-01.',
    ].join('\n')
    const prompt = buildPrompt('bound-tools', null, {
      activeExperimentContext,
    })

    expect(prompt).toContain(activeExperimentContext)
    expect(prompt.indexOf('Vault and tool usage:')).toBeLessThan(
      prompt.indexOf(activeExperimentContext),
    )
    expect(prompt.indexOf(activeExperimentContext)).toBeLessThan(
      prompt.indexOf('This conversation is private enough for full health context'),
    )
  })

  it('describes hosted connection providers from the supplied runtime list', () => {
    const prompt = buildPrompt('bound-tools', null, {
      assistantHostedDeviceConnectAvailable: true,
      assistantHostedDeviceConnectProviders: [
        { label: 'Oura', provider: 'oura' },
        { label: 'WHOOP', provider: 'whoop' },
      ],
    })

    expect(prompt).toContain(
      'Hosted wearable connection is currently supported only for Oura (`oura`) and WHOOP (`whoop`).',
    )
    expect(prompt).toContain(
      'for other apps or devices, say automatic connection is not available',
    )
    expect(prompt).not.toContain('Garmin, Oura, Strava, or WHOOP')
  })
})

describe('buildAssistantNotificationDecisionSystemPrompt', () => {
  it('includes active experiment context when notification decisions receive it', () => {
    const activeExperimentContext = [
      'Active experiment context for navigation only:',
      '- Sauna RHR (`sauna-rhr`, exp_test): started 2026-04-01.',
    ].join('\n')
    const prompt = buildNotificationPrompt('telegram', {
      activeExperimentContext,
    })

    expect(prompt).toContain(activeExperimentContext)
    expect(prompt.indexOf(activeExperimentContext)).toBeLessThan(
      prompt.indexOf('Notification execution rules:'),
    )
  })

  it('defaults experiment notifications to skip unless progress shows a real reason to send', () => {
    const prompt = buildNotificationPrompt('telegram')

    expect(prompt).toContain(
      'For experiment-related scheduled checks, inspect `vault-cli experiment progress <id> --format json` first when the target experiment is identifiable from the prompt or schedule context.',
    )
    expect(prompt).toContain(
      'Default to skip for experiment notifications unless there is a user-opted-in reminder due now, broken or missing data that blocks interpretation, a weekly summary, a review-ready transition, or a safety follow-up that genuinely needs outreach.',
    )
    expect(prompt).toContain(
      'Do not include Markdown fences, Markdown bold or italic markers, citations, source paths, CLI narration, delivery confirmations, or operator meta in `text` unless the user-facing message genuinely needs it.',
    )
    expect(prompt).toContain('The bound outbound channel is telegram.')
  })

  it('includes dynamic hosted connection provider guidance for notification decisions', () => {
    const prompt = buildNotificationPrompt('linq', {
      assistantHostedDeviceConnectAvailable: true,
      assistantHostedDeviceConnectProviders: [
        { label: 'Garmin', provider: 'garmin' },
        { label: 'Strava', provider: 'strava' },
      ],
    })

    expect(prompt).toContain(
      'Hosted wearable connection is currently supported only for Garmin (`garmin`) and Strava (`strava`).',
    )
    expect(prompt.indexOf('Hosted wearable connection')).toBeLessThan(
      prompt.indexOf('Notification execution rules:'),
    )
  })

  it('renders provider-visible aliases for notification decision bound tools', () => {
    const prompt = buildNotificationPrompt('telegram', {
      assistantToolNameAliases: {
        'healthCommons.search': 'healthCommons_search',
        'healthCommons.get': 'healthCommons_get',
        'healthCommons.listProtocols': 'healthCommons_listProtocols',
      },
    })

    expect(prompt).toContain('Use `healthCommons_search` or `healthCommons_listProtocols`')
    expect(prompt).toContain('`healthCommons_get` for the exact page')
    expect(prompt).not.toContain('`healthCommons.search`')
  })
})
