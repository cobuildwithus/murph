import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'

import {
  buildAssistantSystemPromptLayers,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

function buildPrompt(): string {
  const input: AssistantSystemPromptInput = {
    assistantCliContract: null,
    channel: null,
    cliAccess: {
      rawCommand: 'vault-cli',
    },
    currentLocalDate: '2026-06-26',
    currentTimeZone: 'America/Los_Angeles',
    onboardingGuidance: false,
  }

  return buildAssistantSystemPromptLayers(input).stableRouteCapabilityPrompt
}

describe('assistant durable visual media guidance', () => {
  it('routes longitudinal images through canonical capture records instead of ad hoc copies', async () => {
    const prompt = buildPrompt()
    const skill = (await readFile(
      path.join(resolveAssistantSkillsRoot(), 'health-records', 'SKILL.md'), 'utf8',
    )).replace(/\s+/gu, ' ')
    expect(prompt).toContain('$MURPH_ASSISTANT_SKILLS_ROOT/health-records/SKILL.md')

    expect(skill).toContain(
      'vault-cli capture add --media <readable-file-path> --collection <stable-series-slug> --format json'
    )
    expect(skill).toContain(
      'vault-cli capture import-json --input @<payload.json> --format json'
    )
    expect(skill).toContain(
      'vault-cli capture payload-schema --format json'
    )
    expect(skill).toContain(
      'canonical capture records with immutable `raw/captures/**` media and manifests'
    )
    expect(skill).toContain('`raw/inbox/**` media is transient')
    expect(skill).toContain('real readable filesystem paths')
    expect(skill).toContain('vault-relative `raw/inbox/**` storedPath')
    expect(skill).toContain('Never use `mkdir`, `cp`, ad hoc experiment folders')
    expect(skill).toContain(
      'save captures first, then optionally append a checkpoint'
    )
    expect(skill).toContain('returned capture event ids')
    expect(skill).toContain('do not claim it was saved')
    expect(prompt).toContain('sensitive documents or media')
    expect(skill).not.toContain(
      'Save available attachment paths with `vault-cli capture add --media <path>'
    )
  })
})
