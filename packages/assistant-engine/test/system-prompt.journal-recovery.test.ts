import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { JOURNAL_ICON_IDS } from '@murphai/contracts/journal-presentation'
import { describe, expect, it } from 'vitest'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'
import { buildAssistantSystemPromptLayers } from '../src/assistant/system-prompt.js'
import { buildAssistantCliGuidanceText } from '../src/assistant-cli-access.js'

function privateLayers() {
  return buildAssistantSystemPromptLayers({
    assistantCliContract: null,
    channel: 'telegram', conversationScope: 'direct', hostedRuntime: true,
    cliAccess: { rawCommand: 'vault-cli' },
    currentLocalDate: '2026-05-18', currentTimeZone: 'UTC',
onboardingGuidance: false,
  })
}

describe('private Journal capture and recovery instructions', () => {
  it('retains automatic fact capture and its no-retention and causality boundaries', async () => {
    const policy = privateLayers().stableRouteCapabilityPrompt
    const skill = (await readFile(
      path.join(resolveAssistantSkillsRoot(), 'journal', 'SKILL.md'), 'utf8',
    )).replace(/\s+/gu, ' ')
    expect(policy).toContain('$MURPH_ASSISTANT_SKILLS_ROOT/journal/SKILL.md')
    expect(policy).toContain('No save request is needed')
    expect(policy).toContain('Respect a no-retention request')
    expect(policy).toContain('hypothetical questions are not events')
    expect(policy).toContain('Save the reported observation, not an inferred cause or diagnosis')
    expect(policy).toContain('even one the member suggests')
    expect(skill).toContain('same existing event')
  })

  it('supplies the canonical icon catalog and note command without a help round', async () => {
    const skill = await readFile(path.join(resolveAssistantSkillsRoot(), 'journal', 'SKILL.md'), 'utf8')
    const icons = skill.split('Valid ids:')[1]?.split('## Timing')[0] ?? ''
    expect([...icons.matchAll(/`([^`]+)`/gu)].map((match) => match[1])).toEqual(JOURNAL_ICON_IDS)
    expect(skill).toContain('`--icon` is optional and defaults to `note`')
    expect(skill).toContain('vault-cli event note add --title')
    expect(privateLayers().prompt).not.toContain('vault-cli event note add --help')
    expect(skill).not.toContain('vault-cli event note add --help')
  })

  it('requires record verification and an honest distinction between saves and web visibility', async () => {
    const policy = privateLayers().stableRouteCapabilityPrompt
    const skill = (await readFile(
      path.join(resolveAssistantSkillsRoot(), 'journal', 'SKILL.md'), 'utf8',
    )).replace(/\s+/gu, ' ')
    expect(policy).toContain('$MURPH_ASSISTANT_SKILLS_ROOT/journal/SKILL.md')
    expect(skill).toContain('When asked whether a fact was saved or why it is missing from Journal, read the relevant canonical records')
    expect(skill).toContain('If an eligible fact was missed, say so')
    expect(skill).toContain('Never explain the gap as needing an explicit logging request')
    expect(skill).toContain('A canonical save does not prove the web page has refreshed')
    expect(skill).toContain('Do not diagnose a stale page, filter, or sync failure without evidence')
    expect(skill).toContain('Never use legacy `vault-cli journal` day commands or add day links')
    expect(skill).toContain('invent filter controls')
  })

  it('grounds shell execution in the current workspace and distinguishes launch failures from ambiguous writes', () => {
    const guidance = buildAssistantCliGuidanceText({ rawCommand: 'vault-cli' })
    expect(privateLayers().prompt).toContain(guidance)
    expect(guidance).toContain('Use the current turn working directory')
    expect(guidance).toContain('do not invent a workspace path or reuse one from an older transcript')
    expect(guidance).toContain('before the command started')
    expect(guidance).toContain('If execution may have started, verify canonical state before another write')
    expect(guidance).toContain('never retry an unchanged write')
  })
})
