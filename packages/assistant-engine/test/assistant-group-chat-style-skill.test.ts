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
  it('completes explicitly requested compound media actions without fake provider limits', async () => {
    const normalized = await readNormalizedGroupChatSkill()

    expect(normalized).toContain(
      'Default to one assistant-authored response per turn.',
    )
    expect(normalized).toContain(
      'Tool-owned effects the group explicitly requests, such as a contact card plus a song, may accompany it.',
    )
    expect(normalized).toContain(
      'If the group explicitly requests a song plus another supported action, complete both in the current turn.',
    )
    expect(normalized).toContain(
      'If an answer or first-reply contact card is pending without that explicit song request, skip the song.',
    )
    expect(normalized).toContain(
      'never invent a provider limitation to justify an assistant choice',
    )
    expect(normalized).not.toContain(
      'it cannot share the turn with the contact card',
    )
  })

  it('caps group message length behind the room Detail ceiling', async () => {
    const normalized = await readNormalizedGroupChatSkill()

    expect(normalized).toContain(
      "the room's Detail setting is a ceiling on unrequested length, never a target",
    )
    expect(normalized).toContain(
      'Never skimp on asked-for substance: when someone directly asks a question whose complete answer genuinely needs a few paragraphs, give that answer, as tight as accuracy allows.',
    )
    expect(normalized).toContain(
      'What the ceiling kills is volunteered length — frameworks, multi-topic essays, background beyond the question, detail nobody asked for — and it covers the whole turn, including every `---` bubble.',
    )
    expect(normalized).toContain(
      'For open-ended setup, planning, or brainstorm asks, depth arrives incrementally: headline first, one decision per message, more on request',
    )
    expect(normalized).toContain(
      "An explicitly configured scheduled edition or digest follows its owning skill's shape.",
    )
  })

  it('keeps challenge kickoff conversational instead of a rulebook dump', async () => {
    const groupChallenge = await readFile(
      path.join(resolveAssistantSkillsRoot(), 'group-challenge', 'SKILL.md'),
      'utf8',
    )
    const normalized = groupChallenge.replace(/\s+/gu, ' ')

    expect(normalized).toContain(
      "Kickoff is a conversation, not a rules document, and every kickoff message obeys `group-chat`'s length budget.",
    )
    expect(normalized).toContain(
      'Pitch a format or scoring idea in a few short sentences, settle one decision at a time, and ask at most one question per message.',
    )
    expect(normalized).toContain(
      "Do not post a multi-section framework or numbered rulebook into the room unless the room's Detail is 10/10 or a member explicitly asks this turn for the full rules.",
    )
  })

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
      'Keep ordinary replies flat. Use `murph.select_reply_target`',
    )
    // The live-but-scrolled-past boundary is what separates a legitimate
    // targeted reply from reviving a topic the room already left.
    expect(normalized).toContain(
      'when what you say answers a specific earlier message the room has scrolled past but not moved on from, or when several conversations are interleaved and a bare reply would look like it belongs to the wrong one.',
    )
    expect(normalized).toContain(
      'When you are simply adding to the room rather than answering one message, stay flat.',
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
      'Default to one assistant-authored response per turn.',
    )
    expect(normalized).toContain(
      'Natural `---` bubbles inside that response are allowed.',
    )
    expect(normalized).toContain(
      'Never send a separate unrequested status or permission-card companion follow-up',
    )
    expect(normalized).not.toContain('Exactly one message per turn.')
  })

  it('watches a live volley instead of buffering a reply to it', async () => {
    const normalized = await readNormalizedGroupChatSkill()

    expect(normalized).toContain(
      'When people are talking to each other and nothing needs you yet, watch instead of answering: run a short shell `sleep` for a few seconds, never more than about 10, then look again and run the ladder against the room as it now stands.',
    )
    // Waiting must never become an excuse to override the ladder's silence,
    // closed-room, and not-for-you rules.
    expect(normalized).toContain(
      'Waiting never overrides the ladder',
    )
    expect(normalized).toContain(
      'a wait that ends in no message is a correct outcome.',
    )
    expect(normalized).toContain(
      'Do not wait when someone needs an answer now',
    )
    expect(normalized).toContain(
      'a comedic interjection can be better precisely because it lands immediately.',
    )
    expect(normalized).toContain(
      'never mention waiting, sleeping, or commands.',
    )
  })

  it('answers a moment rather than covering the whole backlog', async () => {
    const normalized = await readNormalizedGroupChatSkill()

    expect(normalized).toContain(
      'After watching, say one thing or nothing.',
    )
    expect(normalized).toContain(
      'You are answering a moment, not a backlog: never recap what you read, never work through it point by point, and never write a message whose only job is coverage.',
    )
    expect(normalized).toContain(
      'Often a reaction alone is the better move.',
    )
    expect(normalized).toContain(
      'When what you say targets an earlier message, use the stale-message reply-target rule below.',
    )
    // The narrow multi-answer case is about people who asked, never about
    // volume of unread messages.
    expect(normalized).toContain(
      'The one exception is people, not volume: if two people each asked you something that still needs an answer, answer both of them, briefly, in that one message.',
    )
  })

  it('sanctions no wording that treats a volley as work to cover', async () => {
    const normalized = await readNormalizedGroupChatSkill()

    // Guard the whole family of digest framings, not just the exact sentences
    // an earlier revision happened to use. Any permissive phrasing here lets
    // the model synthesize one catch-all reply to a banter volley, which is
    // the behavior this guidance exists to prevent.
    for (const digestFraming of [
      /answer(?:ing)? the whole burst/i,
      /against the whole burst/i,
      /everything that arrived/i,
      /merged reply covering/i,
      /burst-covering/i,
      /answer once against/i,
      /respond(?:ing)? to each (?:message|one)/i,
      /reply to (?:all|each) of (?:them|the messages)/i,
    ]) {
      expect(normalized).not.toMatch(digestFraming)
    }
  })

  it('carries the catching-up, live-room, and share-of-voice rhythms', async () => {
    const normalized = await readNormalizedGroupChatSkill()

    expect(normalized).toContain(
      'react to what deserves it, reply to the one or two things actually meant for you (targeting that message when the room has moved on), and let the rest go.',
    )
    expect(normalized).toContain(
      'Nobody writes a recap of what they missed.',
    )
    expect(normalized).toContain(
      'mostly read and enjoy it; jump in when someone asks you something, when a beat is clearly yours, or when you have a genuinely funny line and you have not already been talking a lot.',
    )
    expect(normalized).toContain(
      'Before jumping in, notice how much you have already said recently. If you just posted, the bar for speaking again is much higher.',
    )
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
