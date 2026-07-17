import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'

async function readNormalizedGroupChatSkill(): Promise<string> {
  const groupChat = await readFile(
    path.join(resolveAssistantSkillsRoot(), 'group-chat', 'SKILL.md'),
    'utf8',
  )
  return groupChat.replace(/\s+/gu, ' ')
}

describe('assistant group-chat style guidance', () => {
  it('keeps emoji use occasional instead of habitual', async () => {
    const normalized = await readNormalizedGroupChatSkill()

    expect(normalized).toContain('Default to no emoji.')
    expect(normalized).toContain(
      'Use at most one only when it adds something and matches how the group already talks',
    )
    expect(normalized).toContain(
      'never decorate every reply or use emojis in consecutive messages',
    )
  })

  it('targets laugh reactions at the laughable instead of a laughter token', async () => {
    const normalized = await readNormalizedGroupChatSkill()

    expect(normalized).toContain(
      "A reaction states Murph's stance toward the exact bubble it lands on.",
    )
    expect(normalized).toContain(
      'Before using `laugh`, mentally remove standalone laughter markers such as `haha`, `lol`, `lmao`, `😂`, and `🤣`.',
    )
    expect(normalized).toContain(
      'A bare or mostly laughter reply fails this test.',
    )
    expect(normalized).toContain(
      'never laugh-react to a laughter reply as a proxy for the earlier joke',
    )
    expect(normalized).toContain(
      'If its target or social meaning is ambiguous, do not react.',
    )
  })
})
