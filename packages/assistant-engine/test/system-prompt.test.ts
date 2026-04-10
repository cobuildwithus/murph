import { describe, expect, it } from 'vitest'

import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.js'

function buildPrompt(
  assistantCommandAccessMode: 'bound-tools' | 'direct-cli' | 'none',
  turnTrigger: 'automation-cron' | 'manual-ask' | null = null,
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
    firstTurnCheckIn: false,
    turnTrigger,
    vaultOverview: null,
  })
}

describe('buildAssistantSystemPrompt', () => {
  it('tells bound-tool sessions to route run distance questions through vault.cli.run', () => {
    const prompt = buildPrompt('bound-tools')

    expect(prompt).toContain('call `vault.cli.run` with `route estimate ...`')
    expect(prompt).toContain('distance, duration, traffic time, or approximate elevation')
    expect(prompt).toContain('`walking`, `cycling`, `driving`, or `driving-traffic`')
  })

  it('tells direct-cli sessions to use vault-cli route estimate directly', () => {
    const prompt = buildPrompt('direct-cli')

    expect(prompt).toContain('use `vault-cli route estimate ...` and choose the matching profile')
    expect(prompt).toContain('`walking`, `cycling`, `driving`, or `driving-traffic`')
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
})
