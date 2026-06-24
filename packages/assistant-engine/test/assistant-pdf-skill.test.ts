import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'
import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.js'

describe('assistant PDF skill', () => {
  it('adds the concise PDF skill route to the system prompt', () => {
    const prompt = buildAssistantSystemPrompt({
      assistantCliContract: null,
      assistantHostedDeviceConnectAvailable: false,
      assistantHostedDeviceConnectProviders: [],
      assistantKnowledgeToolsAvailable: false,
      channel: 'telegram',
      cliAccess: {
        rawCommand: 'vault-cli',
        setupCommand: 'murph',
      },
      currentLocalDate: '2026-06-24',
      currentTimeZone: 'America/New_York',
      onboardingGuidance: false,
      modelBehaviorProfile: 'gpt5-agentic',
      turnTrigger: null,
      assistantContextSnapshotPrompt: null,
    })

    expect(prompt).toContain(
      'pdf: Use when the user asks for a PDF or when a substantial health-relevant report is best delivered as one.',
    )
    expect(prompt).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/pdf/SKILL.md',
    )
    expect(prompt).toContain(
      'Follow the skill and use the installed Typst CLI.',
    )
  })

  it('ships a bounded Typst authoring and validation workflow', async () => {
    const skill = await readFile(
      path.join(resolveAssistantSkillsRoot(), 'pdf', 'SKILL.md'),
      'utf8',
    )

    expect(skill).toContain('typst compile --root')
    expect(skill).toContain('--ignore-system-fonts')
    expect(skill).toContain('qpdf --check')
    expect(skill).toContain('pdftotext -enc UTF-8 -nopgbrk')
    expect(skill).toContain('pdftoppm')
    expect(skill).toContain('.artifacts/pdf')
    expect(skill).toContain('Do not import remote Typst packages')
    expect(skill).toContain('do not claim it was sent')
    expect(skill).toContain(
      'Stop when the requested content is complete',
    )
  })
})
