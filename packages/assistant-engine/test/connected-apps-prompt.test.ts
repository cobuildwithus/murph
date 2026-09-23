import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'
import {
  buildAssistantSystemPrompt,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

describe('connected-apps skill and system-prompt coverage', () => {
  it('anchors Journal follow-ups to event end while preserving passive-evidence suppression', async () => {
    const skill = (await readFile(path.join(resolveAssistantSkillsRoot(), 'journal-connected-context', 'SKILL.md'), 'utf8')).replace(/\s+/gu, ' ')
    expect(skill).toContain('one private check-in one hour after the event ends, using its end timestamp rather than its start')
    expect(skill).toContain('an 18:00–19:00 event gets a 20:00 check-in in the event timezone')
    expect(skill).toContain('If it already shows what happened, do not ask.')
    expect(skill).not.toContain('one hour after the event starts')
    expect(skill).toContain('Routine plan saves, updates, cancellations, and scheduling a future check-in stay silent')
    expect(skill).toContain('A new saved plan or trip alone is never a reason to send.')
    expect(skill).toContain('a currently due check-in that passive evidence has not resolved')
  })

  it('repairs incidental reminder locations through the existing versioned owner without copying travel facts', async () => {
    const skill = (await readFile(path.join(resolveAssistantSkillsRoot(), 'journal-connected-context', 'SKILL.md'), 'utf8')).replace(/\s+/gu, ' ')
    expect(skill).toContain('This also applies to unchanged plans')
    expect(skill).toContain('existing automation inspect and version-checked patch path')
    expect(skill).toContain('Preserve an explicitly fixed destination or venue')
    expect(skill).toContain('Do not copy the new itinerary into every reminder')
    expect(skill).toContain('Preserve subject, schedule, timezone, route, status, support ownership, and existing context references')
    expect(skill).toContain('Already context-aware instructions need no write')
    expect(skill).toContain('Do not touch group reminders, clinical instructions, or unrelated automations')
    expect(skill).toContain('Repairs stay silent and create no extra follow-up or notification')
    expect(skill).toContain('A planned trip does not prove arrival')
  })

  it('keeps weather lookup subordinate to current location and uncertainty', async () => {
    const skill = (await readConnectedAppsSkill()).replace(/\s+/gu, ' ')
    for (const text of [
      'Resolve private reminder location before any weather call, including for legacy instructions naming a city',
      'Flight arrival can already have passed',
      'Respect connected-context account/category opt-outs',
      'vault-cli event list --kind note --from <occurrence-minus-14-days> --to <occurrence-date> --limit 50 --format json',
      'A past report without a covering window',
      'event show <id> --format json',
      'use the destination after its planned arrival and before its known return',
      'An uncertain old city must not appear even in conditional wording',
      'make destination wording conditional',
      'omit city/weather rather than fall back to an old city or ask during the scheduled run',
      'Never overwrite home/current-location memory or change schedules from a planned trip',
      'Group reminders use only room-authorized location evidence',
      'with no account selector',
      'OPENWEATHER_API_GET_CURRENT_WEATHER', 'OPENWEATHER_API_GET5_DAY_FORECAST',
      'search first only when their argument schema is unclear',
      'A decline saves the reminder unchanged',
      'With no reliable location or a failed read, send the ordinary cue',
    ]) expect(skill).toContain(text)
  })

  it('owns the approved service and toolkit use cases in the skill', async () => {
    const skill = await readConnectedAppsSkill()

    for (const expected of [
      'Google Maps',
      'NPPES',
      'NPI',
      'Amazon',
      'Walmart',
      'Instacart',
      'Google Drive',
      'OneDrive',
      'Dropbox',
      'Google Tasks',
      'Todoist',
      'Notion',
      'Microsoft Outlook',
      'Zoho Mail',
    ]) {
      expect(skill).toContain(expected)
    }
  })

  it('does not turn raw OpenWeather reads into official alerts', async () => {
    const skill = await readConnectedAppsSkill()
    const normalizedSkill = skill.replace(/\s+/g, ' ')

    expect(normalizedSkill).toContain('never an unnecessary exact address')
    expect(normalizedSkill).toContain('current outdoor air quality')
    expect(normalizedSkill).toContain(
      'Raw weather, AQI, and forecast reads do not establish an official alert.',
    )
    expect(normalizedSkill).toContain(
      'unless this skill or the current system prompt names a server-authorized fixed route and its exact schema',
    )
    expect(normalizedSkill).not.toContain('MURPH_OPENWEATHER_GET_NATIONAL_ALERTS')
  })

  it('keeps Mapbox as the geocoding and routing layer', async () => {
    const skill = await readConnectedAppsSkill()

    expect(skill).toContain(
      "Keep Mapbox\n  as Murph's geocoding, distance, and routing layer",
    )
  })

  it('prefers connected email over a webmail browser handoff', async () => {
    const skill = (await readConnectedAppsSkill()).replace(/\s+/g, ' ')

    expect(skill).toContain(
      'use a connected Gmail or Microsoft Outlook account before considering computer use',
    )
    expect(skill).toContain(
      'Do not open computer use merely to sign into Gmail or Outlook, operate webmail, or hand the send back to the user',
    )
    expect(skill).toContain(
      'return the Composio connection URL plainly, and do not claim the account is connected until a later list shows it as active',
    )
  })

  it('limits email sends to current private user requests', async () => {
    const skill = (await readConnectedAppsSkill()).replace(/\s+/g, ' ')

    expect(skill).toContain(
      'When a current private user request calls for an email',
    )
    expect(skill).toContain(
      'Do not send personal email from a group, scheduled automation, maintenance turn, system notification, or output-only continuation.',
    )
    expect(skill).toContain(
      'The current private user request must authorize the sender account, exact recipients, and substantive message content.',
    )
    expect(skill).toContain(
      'continue only if the sender, exact recipients, and substantive content remain clear in the current conversation',
    )
    expect(skill).not.toContain(
      'private scheduled automation calls for an email',
    )
  })

  it('lazy-loads the detailed direct contract while preserving group floors', async () => {
    const skill = await readConnectedAppsSkill()
    const directPrompt = buildAssistantSystemPrompt(createPromptInput({
      conversationScope: 'direct',
    }))
    const groupPrompt = buildAssistantSystemPrompt(createPromptInput({
      conversationScope: 'group',
    }))
    const scheduledPrompt = buildAssistantSystemPrompt(createPromptInput({
      scheduledOccurrenceAt: '2026-06-25T13:00:00.000Z',
      turnTrigger: 'automation-cron',
    }))

    for (const requiredContract of [
      'GMAIL_SEND_EMAIL',
      'OUTLOOK_SEND_EMAIL',
      'GOOGLECALENDAR_CREATE_EVENT',
      'OUTLOOK_CALENDAR_CREATE_EVENT',
      'agentApproved: true',
      'recipient_email',
      'to_email',
      'event_duration_hour',
      'event_duration_minutes',
      'end_datetime',
    ]) {
      expect(skill).toContain(requiredContract)
      expect(directPrompt).not.toContain(requiredContract)
      expect(groupPrompt).not.toContain(requiredContract)
    }
    expect(skill).toContain('do not retry')
    expect(skill).toContain("Search the selected account's Sent mail")
    expect(skill).toContain('narrow window at or after this attempt')
    expect(skill).toContain('substantive body')
    expect(skill).toContain('Older, duplicate, or partial matches')

    for (const privatePrompt of [directPrompt, scheduledPrompt]) {
      expect(privatePrompt).toContain(
        '$MURPH_ASSISTANT_SKILLS_ROOT/connected-apps/SKILL.md',
      )
    }
    expect(directPrompt).toContain('private untrusted evidence')
    expect(directPrompt).toContain('OPENWEATHER_API_GET_GEOCODING_DIRECT')
    expect(directPrompt).toContain('MURPH_OPENWEATHER_GET_NATIONAL_ALERTS')
    expect(directPrompt).toContain('without search')
    expect(directPrompt).toContain('never guess coordinates')
    expect(directPrompt).toContain('with numeric `lat`/`lon`')
    expect(directPrompt).toContain('once including retries')
    expect(directPrompt).toContain('Continue on failure')
    expect(scheduledPrompt).toContain('MURPH_OPENWEATHER_GET_NATIONAL_ALERTS')
    expect(groupPrompt).toContain('Use only accountless built-in service tools')
    expect(groupPrompt).toContain(
      'Never list, connect, rename, disconnect, search, read, write, or select',
    )
    expect(`${groupPrompt}\n${skill}`).not.toContain(
      'MURPH_OPENWEATHER_GET_NATIONAL_ALERTS',
    )
  })
})

async function readConnectedAppsSkill(): Promise<string> {
  return readFile(
    path.join(resolveAssistantSkillsRoot(), 'connected-apps', 'SKILL.md'),
    'utf8',
  )
}

function createPromptInput(
  overrides: Partial<AssistantSystemPromptInput> = {},
): AssistantSystemPromptInput {
  return {
    assistantCliContract: null,
    assistantContextSnapshotPrompt: null,
    assistantHostedDeviceConnectAvailable: false,
    assistantHostedDeviceConnectProviders: [],
    assistantKnowledgeToolsAvailable: false,
    channel: 'local',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    currentLocalDate: '2026-06-25',
    currentTimeZone: 'America/New_York',
    onboardingGuidance: true,
    modelBehaviorProfile: 'gpt5-agentic',
    turnTrigger: null,
    ...overrides,
  }
}
