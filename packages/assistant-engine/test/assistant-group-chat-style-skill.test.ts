import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'

describe('assistant group-chat style guidance', () => {
  it('keeps emoji use occasional instead of habitual', async () => {
    const groupChat = await readFile(
      path.join(resolveAssistantSkillsRoot(), 'group-chat', 'SKILL.md'),
      'utf8',
    )
    const normalized = groupChat.replace(/\s+/gu, ' ')

    expect(normalized).toContain('Default to no emoji.')
    expect(normalized).toContain(
      'Use at most one only when it adds something and matches how the group already talks',
    )
    expect(normalized).toContain(
      'never decorate every reply or use emojis in consecutive messages',
    )
  })

  it('uses one visible message ref for optional replies and reactions', async () => {
    const groupChat = await readFile(
      path.join(resolveAssistantSkillsRoot(), 'group-chat', 'SKILL.md'),
      'utf8',
    )
    const normalized = groupChat.replace(/\s+/gu, ' ')

    expect(normalized).toContain(
      'React with `murph.react_to_message`, using the exact visible accepted-message `message_ref`',
    )
    expect(normalized).toContain(
      'Keep ordinary replies flat. In a busy room, use `murph.select_reply_target`',
    )
    expect(normalized).toContain(
      'The selection applies to the whole response, including every `---` bubble.',
    )
    expect(normalized).toContain(
      'Reactions and reply selection remain independent; neither action implies the other.',
    )
    expect(normalized).toContain(
      'Never invent a ref or target a message merely because a ref is available.',
    )
  })
})
