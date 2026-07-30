import { describe, expect, it } from 'vitest'

import {
  buildAssistantMaintenanceSystemPromptWithCacheMetadata,
  buildAssistantSystemPromptLayers,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

const CAPABILITY_OFFERS_HEADER = 'Capability offers:'
const PHONE_CALLS_HEADER = 'Phone calls:'
const HOSTED_GROUPS_HEADER = 'Hosted groups:'

describe('assistant capability-offers prompt contract', () => {
  it('keeps capability-offers and phone-call sections in the stable route layer only', () => {
    const layers = buildAssistantSystemPromptLayers(createCommonCodexPromptInput())

    expect(layers.stableRouteCapabilityPrompt).toContain(CAPABILITY_OFFERS_HEADER)
    expect(layers.stableRouteCapabilityPrompt).toContain(PHONE_CALLS_HEADER)

    for (const promptLayer of [
      layers.dynamicTurnContextPrompt,
      layers.threadContextPrompt,
      layers.staticCacheableCorePrompt,
    ]) {
      expect(promptLayer).not.toContain(CAPABILITY_OFFERS_HEADER)
      expect(promptLayer).not.toContain(PHONE_CALLS_HEADER)
    }
  })

  it('does not expose external-capable sections to maintenance turns', () => {
    const layers = buildAssistantMaintenanceSystemPromptWithCacheMetadata({
      currentLocalDate: '2026-04-15',
      currentTimeZone: 'Asia/Kuala_Lumpur',
      profile: 'member-memory',
    }).layers

    expect(layers.stableRouteCapabilityPrompt).toBe('')

    for (const externalSurface of [
      CAPABILITY_OFFERS_HEADER,
      PHONE_CALLS_HEADER,
      'Computer-use tools:',
      'Connected-app tools:',
      '`murph.create_phone_call`',
      '`murph.computer_',
      '`murph.connected_apps_',
      '`murph.newsletter`',
    ]) {
      expect(layers.prompt).not.toContain(externalSurface)
    }
  })

  it('keeps group room-model maintenance on the exact knowledge page boundary', () => {
    const prompt = buildAssistantMaintenanceSystemPromptWithCacheMetadata({
      currentLocalDate: '2026-07-25',
      currentTimeZone: 'America/New_York',
      profile: 'group-room-model',
    }).prompt

    expect(prompt).toContain(
      '`murph.group_room_model`',
    )
    expect(prompt).toContain('exact `digest` as `expectedDigest`')
    expect(prompt).toContain('Do not use the shell')
    expect(prompt).toContain('rough list of fallible participation tips')
    expect(prompt).toContain('never copy a raw handle into the page')
    expect(prompt).not.toContain('`vault-cli memory upsert`')
    expect(prompt).not.toContain(CAPABILITY_OFFERS_HEADER)
    expect(prompt).not.toContain(PHONE_CALLS_HEADER)
  })

  it('keeps offers adjacent, available, and outcome-focused', () => {
    const section = getPromptSection(
      buildAssistantSystemPromptLayers(createCommonCodexPromptInput())
        .stableRouteCapabilityPrompt,
      CAPABILITY_OFFERS_HEADER,
    )

    expect(section).toContain('Complete the request first')
    expect(section).toContain("turn priority's single next-step offer")
    expect(section).toContain('not an additional item')
    expect(section).toContain('available now')
    expect(section).toContain('materially advances the same health goal')
    expect(section).toContain('No menus')
    expect(section).toContain('re-offers after a decline')
    expect(section).toContain('real-world outcome, not tool names or internal plumbing')
  })

  it('surfaces latent fit before applying owning eligibility gates', () => {
    const section = getPromptSection(
      buildAssistantSystemPromptLayers(createCommonCodexPromptInput())
        .stableRouteCapabilityPrompt,
      CAPABILITY_OFFERS_HEADER,
    )

    expect(section).toContain('Undiscovered capabilities are effectively absent')
    expect(section).toContain('repeated manual health reporting')
    expect(section).toContain('recurring friction or forgetting')
    expect(section).toContain('a named data source')
    expect(section).toContain('longitudinal visual tracking')
    expect(section).toContain('group accountability/update context')
    expect(section).toContain('owning availability and eligibility gates')
  })

  it('keeps consent bounded and setup separate from activation', () => {
    const section = getPromptSection(
      buildAssistantSystemPromptLayers(createCommonCodexPromptInput())
        .stableRouteCapabilityPrompt,
      CAPABILITY_OFFERS_HEADER,
    )

    expect(section).toContain('only the exact bounded offer')
    expect(section).toContain('setup conversation only, not activation')
    expect(section).toContain('Recurrence, OAuth, shared health data, other people')
    expect(section).toContain('money, and irreversible actions')
    expect(section).toContain('concrete final scope and confirmation')
    expect(section).toContain('subject to the owning action\'s consent')
  })

  it('suppresses harmful or misplaced offers while retaining narrow group gates', () => {
    const section = getPromptSection(
      buildAssistantSystemPromptLayers(createCommonCodexPromptInput())
        .stableRouteCapabilityPrompt,
      CAPABILITY_OFFERS_HEADER,
    )

    expect(section).toContain('urgent, emotionally sensitive, flare, or low-capacity')
    expect(section).toContain('suppress unrelated offers')
    expect(section).toContain('broad account scans')
    expect(section).toContain('enrollment of other people')
    expect(section).toContain('spending, prescription changes')
    expect(section).toContain('body/diagnosis leaderboards')
    expect(section).toContain('Group challenges are group-chat only')
    expect(section).toContain(
      'weekly group newsletter is setup-only, never immediate',
    )
  })

  it('names newsletter and new-group permission mechanics inside hosted-group guidance', () => {
    const section = getPromptSection(
      buildAssistantSystemPromptLayers(createCommonCodexPromptInput({
        assistantHostedAutomationAvailable: true,
        hostedRuntime: true,
      }))
        .stableRouteCapabilityPrompt,
      HOSTED_GROUPS_HEADER,
    )

    expect(section).toContain('`murph.newsletter`')
    expect(section).toContain(
      '`prepare` returns authorized facts from the seven completed local days',
    )
    expect(section).toContain('compose only from `result.members`')
    expect(section).not.toContain('`vault-cli group weekly')
    expect(section).toContain('`send` rechecks authorization')
    expect(section).toContain('never returns raw email addresses')
    expect(section).toContain('never invent a sync or permission cause')
    expect(section).toContain('the historical cause is unknown')
    expect(section).toContain(
      'permission or data availability as current state, never as the cause',
    )
    expect(section).not.toContain('direct tool evidence')
    expect(section).toContain('never send the first edition immediately')
    expect(section).toContain('Create the newsletter cron through `murph.automation`')
    expect(section).not.toContain('proactively call `action="post_join_offer"` once')
    expect(section).toContain('`action="read_shared"` as the only hosted path')
    expect(section).toContain('resolves live authority lazily after the tool call')
    expect(section).toContain('Model-size `status="partial"` lists current `omittedParticipantIds`')
    expect(section).toContain('never infer their departure, score, diagnostics, or permission')
    expect(section).toContain('or call the standings complete')
    expect(section).toContain("an exact `Sender:` handle must appear in exactly one returned member's `currentTurnHandles`")
    expect(section).toContain('Scheduled and detached reads have no current-turn handles')
    expect(section).not.toContain('For running-challenge standings')
    expect(section).toContain('`not_granted`, `granted` plus `missing`, and `available`')
    expect(section).toContain('Use `read_current` for membership and permission configuration only')
    expect(section).toContain('not Apple Health access')
    expect(section).toContain('Apple does not expose HealthKit read authorization')
    expect(section).toContain(
      "After read_current, use the group-chat skill's core permissions only for `status=none`",
    )
    expect(section).toContain('existing groups use workflow scopes')
    expect(section).toContain('liking or hearting it adds only its disclosed permission snapshot')
    expect(section).toContain('grants membership only when needed')
    expect(section).toContain(
      'Existing members keep their membership and other grants unchanged',
    )
    expect(section).not.toContain('to join by reacting')
  })

  it('uses memberships only as bounded last-resort direct disambiguation', () => {
    const directLayers = buildAssistantSystemPromptLayers(
      createCommonCodexPromptInput(),
    )
    const groupPrompt = buildAssistantSystemPromptLayers(
      createCommonCodexPromptInput({
        conversationScope: 'group',
      }),
    ).prompt
    const unverifiedPrompt = buildAssistantSystemPromptLayers(
      createCommonCodexPromptInput({
        conversationScope: 'unverified-external',
      }),
    ).prompt
    const directSection = getPromptSection(
      directLayers.stableRouteCapabilityPrompt,
      HOSTED_GROUPS_HEADER,
    )

    expect(directLayers.prompt).toContain('last-resort disambiguation check')
    expect(directSection).toContain('possible group cue')
    expect(directSection).toContain('club, team, community, or shared challenge')
    expect(directSection).toContain(
      '`murph.group action="list_memberships"` is available',
    )
    expect(directSection).toContain('last-resort disambiguation check')
    expect(directSection).toContain(
      'generic group reference only when exactly one membership exists',
    )
    expect(directSection).toContain(
      'name-like reference only when one exact normalized visible label matches',
    )
    expect(directSection).toContain('use `action="ask"`')
    expect(directSection).toContain('With no memberships')
    expect(directSection).toContain('paste-or-screenshot fallback')
    expect(directSection).toContain('distinct nonblank visible labels')
    expect(directSection).toContain('duplicate or unnamed labels')
    expect(directSection).toContain('Never fuzzy-match')
    expect(directSection).toContain('select by role or newness')
    expect(directSection).toContain('expose identifiers, or fan out')
    expect(directSection).toContain('ordinary ambiguity without a group cue')
    expect(groupPrompt).not.toContain('last-resort disambiguation check')
    expect(unverifiedPrompt).not.toContain('last-resort disambiguation check')
  })

  it('does not fork challenge behavior into a scheduled-only prompt', () => {
    const commonInput = createCommonCodexPromptInput({
      channel: 'linq',
      conversationScope: 'group',
      hostedRuntime: true,
    })
    const attended = buildAssistantSystemPromptLayers(commonInput)
    const scheduled = buildAssistantSystemPromptLayers({
      ...commonInput,
      scheduledOccurrenceAt: '2026-04-15T13:00:00.000Z',
      turnTrigger: 'automation-cron',
    })

    expect(scheduled.staticCacheableCorePrompt).toBe(
      attended.staticCacheableCorePrompt,
    )
    expect(scheduled.stableRouteCapabilityPrompt).toBe(
      attended.stableRouteCapabilityPrompt,
    )
    expect(scheduled.threadContextPrompt).toBe(attended.threadContextPrompt)
    expect(scheduled.dynamicTurnContextPrompt).toContain(
      'Delivery adapter contract:',
    )
    expect(scheduled.prompt).not.toContain('For running-challenge standings')
    expect(scheduled.prompt).not.toContain(
      'proactively call `action="post_join_offer"` once',
    )
  })

  it('keeps bounded device diagnostics inside the closed group permission contract', () => {
    const prompt = buildAssistantSystemPromptLayers(
      createCommonCodexPromptInput({
        assistantHostedAutomationAvailable: true,
        conversationScope: 'group',
        hostedRuntime: true,
      }),
    ).stableRouteCapabilityPrompt

    expect(prompt).toContain(HOSTED_GROUPS_HEADER)
    expect(prompt).toContain('`device-sync-status.v0`')
    expect(prompt).toContain('public health-source labels')
    expect(prompt).toContain('coarse connection status')
    expect(prompt).toContain('connection-wide sync-job times')
    expect(prompt).toContain('raw provider or account identity')
    expect(prompt).toContain('total/deep/REM sleep minutes')
    expect(prompt).toContain(
      "`workouts.v0` day records listing each workout's local start time, duration, and type",
    )
    expect(prompt).toContain('canonical event zone (validated vault fallback)')
    expect(prompt).toContain(
      'it excludes absolute timestamps, routes, location, heart rate, or provider identity',
    )
  })

  it('keeps the new-group contact handoff natural and reactive', () => {
    const section = getPromptSection(
      buildAssistantSystemPromptLayers(createCommonCodexPromptInput({
        channel: 'linq',
        conversationScope: 'group',
      }))
        .stableRouteCapabilityPrompt,
      HOSTED_GROUPS_HEADER,
    )

    expect(section).toContain('When `action="read_chat_participants"`')
    expect(section).toContain('check the participants once on your first reply')
    expect(section).toContain('text you to get set up')
    expect(section).toContain(
      'come back and say hi in the group once setup is done',
    )
    expect(section).toContain('Use your own words, not a fixed script')
    expect(section).toContain('Do not repeat the invitation unprompted')
    expect(section).toContain('when someone joins later')
    expect(section).toContain('If someone asks you to resend the card, share it again')
    expect(section).toContain('If someone asks why they have not been added')
    expect(section).toContain('skip the card and invitation')
    expect(section).not.toContain('their own Murph')
  })

  it('gates the contact-card handoff on tool availability in group email', () => {
    const section = getPromptSection(
      buildAssistantSystemPromptLayers(createCommonCodexPromptInput({
        channel: 'email',
        conversationScope: 'group',
      }))
        .stableRouteCapabilityPrompt,
      HOSTED_GROUPS_HEADER,
    )

    expect(section).toContain('When `action="read_chat_participants"`')
    expect(section).toContain('`action="share_contact_card"` are available')
    expect(section).toContain('not authenticated strongly enough')
    expect(section).toContain('share a contact card')
  })

  it('delegates capability mechanics and stays compact', () => {
    const section = getPromptSection(
      buildAssistantSystemPromptLayers(createCommonCodexPromptInput())
        .stableRouteCapabilityPrompt,
      CAPABILITY_OFFERS_HEADER,
    )

    expect(section).toContain('Capability mechanics live in the owning')
    expect(section).toContain('do not promise implementation beyond it')
    expect(Buffer.byteLength(section, 'utf8')).toBeLessThanOrEqual(1_600)
  })

  it('keeps only the phone-call skill trigger and result floor resident', () => {
    const section = getPromptSection(
      buildAssistantSystemPromptLayers(createCommonCodexPromptInput())
        .stableRouteCapabilityPrompt,
      PHONE_CALLS_HEADER,
    )

    expect(section).toContain('$MURPH_ASSISTANT_SKILLS_ROOT/phone-calls/SKILL.md')
    expect(section).toContain('Call only the user-authorized destination')
    expect(section).toContain('Never call emergency services')
    expect(section).toContain('A call tool start status is not the call outcome')
    expect(section).not.toContain('`starting`')
    expect(Buffer.byteLength(section, 'utf8')).toBeLessThanOrEqual(700)
  })

  it('keeps the appointment handoff resident without duplicating its preflight', () => {
    const section = getPromptSection(
      buildAssistantSystemPromptLayers(createCommonCodexPromptInput())
        .stableRouteCapabilityPrompt,
      PHONE_CALLS_HEADER,
    )

    expect(section).toContain('$MURPH_ASSISTANT_SKILLS_ROOT/appointment-scheduling/SKILL.md')
    expect(section).toContain('satisfy its ready-to-act gate')
    expect(section).not.toContain('Set `callerName`')
    expect(section).not.toContain('`shareableFacts`')
  })
})

function getPromptSection(prompt: string, heading: string): string {
  const sectionStart = prompt.indexOf(heading)
  if (sectionStart < 0) {
    throw new Error(`Prompt section not found: ${heading}`)
  }

  const rest = prompt.slice(sectionStart)
  const nextSectionStart = rest.indexOf('\n\n')
  return nextSectionStart < 0 ? rest : rest.slice(0, nextSectionStart)
}

function createCommonCodexPromptInput(
  overrides: Partial<AssistantSystemPromptInput> = {},
): AssistantSystemPromptInput {
  return {
    assistantCliContract: 'Stable CLI contract for common Codex route.',
    assistantHostedDeviceConnectAvailable: true,
    assistantHostedDeviceConnectProviders: [
      { label: 'Oura', provider: 'oura' },
      { label: 'WHOOP', provider: 'whoop' },
    ],
    assistantKnowledgeToolsAvailable: true,
    channel: 'telegram',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    currentLocalDate: '2026-04-15',
    currentTimeZone: 'Asia/Kuala_Lumpur',
    onboardingGuidance: true,
    modelBehaviorProfile: 'gpt5-agentic',
    turnTrigger: null,
    assistantContextSnapshotPrompt: null,
    ...overrides,
  }
}
