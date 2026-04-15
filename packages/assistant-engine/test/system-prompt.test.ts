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
    modelBehaviorProfile: 'default',
    turnTrigger,
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
})
