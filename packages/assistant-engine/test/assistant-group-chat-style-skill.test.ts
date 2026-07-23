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

  it('allows natural bubbles inside one group response without companion follow-ups', async () => {
    const normalized = await readNormalizedGroupChatSkill()

    expect(normalized).toContain(
      'Exactly one assistant response or dispatch per turn.',
    )
    expect(normalized).toContain(
      'Natural `---` bubbles inside that response are allowed.',
    )
    expect(normalized).toContain(
      'Never send a separate status or permission-card companion follow-up',
    )
    expect(normalized).not.toContain('Exactly one message per turn.')
  })

  it('lets a server-owned permission card stand alone', async () => {
    const normalized = await readNormalizedGroupChatSkill()

    expect(normalized).toContain(
      'never send a companion confirmation that the card is available, posted, or ready',
    )
    expect(normalized).toContain(
      'When the server-owned card is the turn\'s only useful user-facing outcome, call `murph.finish_without_reply`.',
    )
    expect(normalized).toContain(
      'send only that content in the assistant response and do not mention the card',
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
      'laugh-react to the laughter reply itself as a proxy for the earlier joke',
    )
    expect(normalized).toContain(
      'If its target or social meaning is ambiguous, do not react.'
    )
  })
})
