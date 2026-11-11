import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { hostedPhoneCallStartResponseSchema } from '@murphai/hosted-execution'
import { describe, expect, it } from 'vitest'

import {
  MURPH_COMPUTER_OPEN_TOOL,
  MURPH_FAMILY_PLAN_TOOL,
} from '../src/assistant-codex/dynamic-tools.js'
import {
  MURPH_CONNECTED_APPS_DYNAMIC_TOOLS,
} from '../src/assistant-codex/dynamic-tools/connected-apps.js'
import {
  ASSISTANT_SKILLS,
  buildAssistantSkillFileRef,
  resolveAssistantSkillsRoot,
  type AssistantSkillSlug,
} from '../src/assistant-skill-assets.js'

const CAPABILITY_SKILL_SLUGS = [
  'connected-apps',
  'computer-use',
  'phone-calls',
  'murph-family',
] as const satisfies readonly AssistantSkillSlug[]

describe('assistant capability policy skills', () => {
  it('registers every capability owner with a stable symbolic file reference', () => {
    const registered = new Set(ASSISTANT_SKILLS.map((skill) => skill.slug))

    for (const slug of CAPABILITY_SKILL_SLUGS) {
      expect(registered.has(slug)).toBe(true)
      expect(buildAssistantSkillFileRef(slug)).toBe(
        `$MURPH_ASSISTANT_SKILLS_ROOT/${slug}/SKILL.md`,
      )
    }
  })

  it('names every phone-call start status the host can return', async () => {
    const skill = await readSkill('phone-calls')
    for (const status of ['starting', 'calling', 'failed'] as const) {
      expect(skill).toContain(`\`${status}\``)
      expect(hostedPhoneCallStartResponseSchema.safeParse({
        phoneCallId: 'phone-call-test',
        status,
      }).success).toBe(true)
    }
  })

  it('keeps skill paths and links out of terse tool call contracts', () => {
    for (const tool of MURPH_CONNECTED_APPS_DYNAMIC_TOOLS) {
      expect(tool.description).not.toContain('SKILL.md')
    }
    expect(MURPH_FAMILY_PLAN_TOOL.description).not.toContain('SKILL.md')
    expect(MURPH_FAMILY_PLAN_TOOL.description).not.toContain('https://')
    expect(MURPH_COMPUTER_OPEN_TOOL.description).not.toContain('SKILL.md')
  })
})

async function readSkill(slug: AssistantSkillSlug): Promise<string> {
  return readFile(
    path.join(resolveAssistantSkillsRoot(), slug, 'SKILL.md'),
    'utf8',
  )
}
