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
  it('supplies the canonical icon catalog and note command without a help round', async () => {
    const skill = await readFile(path.join(resolveAssistantSkillsRoot(), 'journal', 'SKILL.md'), 'utf8')
    const icons = skill.split('Valid ids:')[1]?.split('## Timing')[0] ?? ''
    expect([...icons.matchAll(/`([^`]+)`/gu)].map((match) => match[1])).toEqual(JOURNAL_ICON_IDS)
  })

  it('grounds shell execution in the current workspace and distinguishes launch failures from ambiguous writes', () => {
    const guidance = buildAssistantCliGuidanceText({ rawCommand: 'vault-cli' })
    expect(privateLayers().prompt).toContain(guidance)
  })
})
