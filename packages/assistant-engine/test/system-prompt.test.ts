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
    expect(prompt).toContain('prefer more specific place text or coordinates')
    expect(prompt).toContain('provider may still return a broader display label')
  })

  it('tells direct-cli sessions to use vault-cli route estimate directly', () => {
    const prompt = buildPrompt('direct-cli')

    expect(prompt).toContain('use `vault-cli route estimate ...` and choose the matching profile')
    expect(prompt).toContain('`walking`, `cycling`, `driving`, or `driving-traffic`')
    expect(prompt).toContain('prefer more specific place text or coordinates')
    expect(prompt).toContain('provider may still return a broader display label')
  })

  it('keeps the fallback route-estimation guidance aligned with the explicit profiles', () => {
    const prompt = buildPrompt('none')

    expect(prompt).toContain('prefer `vault-cli route estimate ...`')
    expect(prompt).toContain('`walking`, `cycling`, `driving`, or `driving-traffic`')
    expect(prompt).toContain('prefer more specific place text or coordinates')
    expect(prompt).toContain('provider may still return a broader display label')
  })

  it('tells the assistant to capture detailed food and supplement logging context', () => {
    const prompt = buildPrompt('bound-tools')

    expect(prompt).toContain(
      'try hard to capture the full ingredient or component list, serving size or per-item amounts, dose units, and calories for future reference',
    )
    expect(prompt).toContain('inspect any attached labels, menus, or photos first')
    expect(prompt).toContain(
      'use available web lookup to recover likely ingredients, calories, or serving amounts before writing',
    )
    expect(prompt).toContain('Mark uncertainty plainly instead of inventing exact values.')
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
