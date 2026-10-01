import { describe, expect, it } from 'vitest'
import { buildAssistantSystemPromptLayers } from '../src/assistant/system-prompt.js'
import { buildAssistantCliGuidanceText } from '../src/assistant-cli-access.js'

function privateLayers() {
  return buildAssistantSystemPromptLayers({
    assistantCliContract: null, assistantKnowledgeToolsAvailable: false,
    channel: 'telegram', conversationScope: 'direct', hostedRuntime: true,
    cliAccess: { rawCommand: 'vault-cli', setupCommand: 'murph' },
    currentLocalDate: '2026-05-18', currentTimeZone: 'UTC',
    modelBehaviorProfile: 'gpt5-agentic', onboardingGuidance: false,
  })
}

describe('private Journal capture and recovery instructions', () => {
  it('retains automatic fact capture and its no-retention and causality boundaries', () => {
    const policy = privateLayers().stableRouteCapabilityPrompt
    expect(policy).toContain('An extra request to save is not required')
    expect(policy).toContain('Respect an explicit no-retention request')
    expect(policy).toContain('hypothetical questions are not events')
    expect(policy).toContain('Save facts, not inferred causes or diagnoses')
    expect(policy).toContain('A suggested explanation is not a separate Journal fact')
    expect(policy).toContain('same existing event')
  })

  it('requires record verification and an honest distinction between saves and web visibility', () => {
    const policy = privateLayers().stableRouteCapabilityPrompt
    expect(policy).toContain('When asked whether a fact was saved or why it is missing from Journal, read the relevant canonical records')
    expect(policy).toContain('acknowledge the missed capture')
    expect(policy).toContain('never explain it as requiring an explicit logging request')
    expect(policy).toContain('A canonical save does not prove that the web page has refreshed')
    expect(policy).toContain('Do not diagnose a stale page, filter, or sync failure without evidence')
    expect(policy).toContain('never use legacy `vault-cli journal` day commands or add day links')
    expect(policy).toContain('invent filter controls')
  })

  it('grounds shell execution in the current workspace and distinguishes launch failures from ambiguous writes', () => {
    const guidance = buildAssistantCliGuidanceText({ rawCommand: 'vault-cli', setupCommand: 'murph' })
    expect(privateLayers().prompt).toContain(guidance)
    expect(guidance).toContain('Use the current turn working directory')
    expect(guidance).toContain('do not invent a workspace path or reuse one from an older transcript')
    expect(guidance).toContain('before the command started')
    expect(guidance).toContain('If execution may have started, verify canonical state before another write')
    expect(guidance).toContain('never retry an unchanged write')
  })
})
