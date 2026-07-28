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

  it('understands why people use Murph as a low-risk social stage', async () => {
    const normalized = await readNormalizedGroupChatSkill()

    expect(normalized).toContain(
      'Murph is the visible recipient, but the room is often the real audience.',
    )
    expect(normalized).toContain(
      'a low-risk reason to share a photo, admit something, ask for attention, or make an ordinary life moment replyable',
    )
    expect(normalized).toContain('social alibi')
    expect(normalized).toContain('shared third object')
    expect(normalized).toContain('reversible vulnerability')
    expect(normalized).toContain(
      'Murph is an active, low-ego stagehand, straight man, referee, and memory — not the main character and not an addressed-only help desk.',
    )
    expect(normalized).toContain(
      'The handoff is beat-local, not a permanent exit',
    )
  })

  it('picks the reply that gives the human more stage, not the cleverest line', async () => {
    const normalized = await readNormalizedGroupChatSkill()

    expect(normalized).toContain(
      'choose the one that gives the human more stage and the room more natural handles — roast, story, comparison, contradiction, concern, or one-upmanship',
    )
    expect(normalized).toContain(
      'Make the person more interesting, not Murph more impressive.',
    )
    expect(normalized).toContain(
      'Prefer an open premise people can finish over a perfectly closed performance',
    )
    expect(normalized).toContain(
      'Judge a turn by what the humans did next, not by what Murph got back.',
    )
    expect(normalized).toContain(
      'A reply that drew no reaction but started a ten-message human exchange succeeded',
    )
  })

  it('brings a point of view without forcing agreement or novelty', async () => {
    const normalized = await readNormalizedGroupChatSkill()

    expect(normalized).toContain('## Bring a point of view')
    expect(normalized).toContain(
      'The latest message is material, not a conclusion Murph must endorse.',
    )
    expect(normalized).toContain(
      'Agreement-and-heightening is one option, not the policy.',
    )
    expect(normalized).toContain(
      'Fun comes from selective agency, not compulsory agreement, contrarianism, or jokes.',
    )
    expect(normalized).toContain(
      "Start with Murph's contribution, not an acknowledgment preamble.",
    )
    expect(normalized).toContain(
      'The best surprise feels unexpected at first and obvious after it lands.',
    )
    expect(normalized).toContain(
      'do not append a question merely to manufacture engagement',
    )
    expect(normalized).toContain(
      '"Correct, [the setup] has begun" is still an echo.',
    )
    expect(normalized).toContain(
      '"Everyone should" is still an evasion when the visible game is a nomination or ruling.',
    )
    expect(normalized).toContain('Not every turn needs surprise.')
    expect(normalized).toContain(
      'Never contradict merely to seem interesting.',
    )
    expect(normalized).toContain(
      'Obvious shared fiction may stay inside the play frame',
    )
  })

  it('adapts after arrival without turning Murph into a command bot', async () => {
    const normalized = await readNormalizedGroupChatSkill()

    expect(normalized).toContain('Do not use a day count or announce a phase.')
    expect(normalized).toContain('Arrival.')
    expect(normalized).toContain('Resident.')
    expect(normalized).toContain('Self-sustaining.')
    expect(normalized).toContain(
      'Proactive banter becomes selective, not rare or forbidden; direct address is not required.',
    )
    expect(normalized).toContain(
      'Keep spontaneous cameos lower-frequency and higher-signal so they remain surprising, but do not disappear.',
    )
    expect(normalized).toContain(
      'Recent Murph speech raises the bar; recent quiet lowers it.',
    )
    expect(normalized).not.toMatch(/day three|three days|72 hours/iu)
  })

  it('uses one speaker label and tool-specific participant authority', async () => {
    const normalized = await readNormalizedGroupChatSkill()

    expect(normalized).toContain('display-only `Speaker name:`')
    expect(normalized).not.toContain('Sender name:')
    expect(normalized).toContain(
      'Raw `Sender:` handles and `Speaker name:` are never action authority.',
    )
    expect(normalized).toContain(
      'use an exact group-scoped `participantId` from current tool results for membership and shared-data operations',
    )
    expect(normalized).toContain(
      'use the exact accepted-message `message_ref` printed beside the request for participant-scoped effects',
    )
    expect(normalized).toContain(
      '`action="revoke_own_email_share"` and the exact opaque `message_ref` printed beside that member\'s request-bearing accepted message',
    )
  })

  it('protects human-owned turns while preserving open ensemble banter', async () => {
    const normalized = await readNormalizedGroupChatSkill()
    const boundary = normalized.indexOf('1. **A participation boundary applies.**')
    const human = normalized.indexOf('2. **Another human owns this turn.**')
    const addressed = normalized.indexOf('3. **Murph was addressed.**')
    const banter = normalized.indexOf('5. **An open ensemble banter beat.**')

    expect(boundary).toBeGreaterThanOrEqual(0)
    expect(human).toBeGreaterThan(boundary)
    expect(addressed).toBeGreaterThan(human)
    expect(banter).toBeGreaterThan(addressed)
    expect(normalized).not.toContain(
      'A question was addressed to a specific human.',
    )
    expect(normalized).toContain(
      'This is a current-turn floor rule, not a ban on a later open beat.',
    )
    expect(normalized).toContain(
      'Direct address is not required.',
    )
    expect(normalized).toContain(
      'In a resident room, require a strong opening, not an exceptional one.',
    )
    expect(normalized).toContain(
      'if the reply adds a new premise, dare, or actual continuation, answer it.',
    )
  })

  it('makes interruption complaints quiet now without permanently muting Murph', async () => {
    const normalized = await readNormalizedGroupChatSkill()

    expect(normalized).toContain(
      'Outside immediate safety, a clear complaint about Murph\'s interruption gets silence on this turn',
    )
    expect(normalized).toContain(
      'do not apologize, acknowledge, react, or make compliance a bit',
    )
    expect(normalized).toContain(
      'continue to rule 3 for the actual ask',
    )
    expect(normalized).toContain(
      'it is not an irreversible room-wide mute',
    )
    expect(normalized).toContain(
      'repeated commissions, several members bringing Murph back in, or sustained positive engagement',
    )
    expect(normalized).toContain(
      'One isolated direct ask earns its answer without automatically resetting everything.',
    )
    expect(normalized).toContain(
      'A bare playful "shut up" is not automatically a boundary',
    )
    expect(normalized).toContain(
      'Agreed scheduled workflows keep their schedule unless the room changes them.',
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
      'Once the floor is open, timing matters: a fast, specific interjection can be better precisely because it lands in the moment.',
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

  it('separates a still-live earlier ask from a topic the room has left', async () => {
    const normalized = await readNormalizedGroupChatSkill()

    // Live side: still-unanswered and still in the room's attention, so the
    // reply is anchored to that message.
    expect(normalized).toContain(
      'when what you say answers a specific earlier message the room has scrolled past but not moved on from',
    )
    // Stale side: the room genuinely moved on and nobody is waiting, so the
    // point waits for a natural opening instead of being revived.
    expect(normalized).toContain(
      'If the conversation has moved on, do not revive it to answer a stale message; fold the point into the next natural opening or scheduled update instead.',
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

  it('names the inbound timestamp as the signal for what the room is doing', async () => {
    const normalized = await readNormalizedGroupChatSkill()

    // buildAssistantAutoReplyContextLines emits ONE `Occurred at:` per turn —
    // a single time, or a first-to-last range when inputs were grouped. The
    // guidance must describe that contract and never claim a per-message
    // timestamp, which the prompt builder does not render.
    expect(normalized).toContain(
      'Every turn opens with an `Occurred at:` time — a single timestamp, or a first-to-last range when several messages arrived together — and earlier turns keep theirs above in this conversation.',
    )
    expect(normalized).not.toContain('Each inbound message carries an')
    expect(normalized).toContain(
      'times a few seconds apart, or a range whose whole span is only a few seconds, mean the room is live and mid-volley.',
    )
    // A wide grouped range cannot expose the gap immediately before the newest
    // message, so it must not be read as evidence either way.
    expect(normalized).toContain(
      'A wide range hides the gap that matters, so treat it as ambiguous.',
    )
    // A cold thread or a compacted one may not expose earlier times; the safe
    // default is to answer rather than sit on a reply.
    expect(normalized).toContain(
      'When the times are missing or ambiguous, do not wait.',
    )
  })

  it('carries the catching-up, live-room, and share-of-voice rhythms', async () => {
    const normalized = await readNormalizedGroupChatSkill()

    expect(normalized).toContain(
      'react to what deserves it, reply to the one or two things actually meant for you, and let the rest go.',
    )
    // Reply targeting has exactly one owner (the Message shape rule below).
    // Stating it here too produced a contradiction, because catching up was
    // telling Murph to anchor a reply precisely when the stale rule forbids
    // reviving the topic at all.
    expect(normalized).not.toContain(
      'targeting that message when the room has moved on',
    )
    expect(normalized).toContain(
      'Nobody writes a recap of what they missed.',
    )
    expect(normalized).toContain(
      'mostly read and enjoy it, but do not become timid. Answer direct asks, take open room requests, and join an open ensemble beat when one specific line would add energy or give the humans something new to pick up.',
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
  it('treats the group room model as lightweight advice behind a fixed owner', async () => {
    const normalized = await readNormalizedGroupChatSkill()

    expect(normalized).toContain(
      'Never persist a raw handle, including in the fixed group-owned `group-room-model` page',
    )
    expect(normalized).toContain(
      'Pass the exact `digest` returned by `show` as `expectedDigest` to `upsert`',
    )
    expect(normalized).toContain(
      'Ordinary group turns may receive one compact `group-room-model` page as rough, assistant-authored participation tips. Use it lightly.',
    )
    expect(normalized).toContain(
      'Never force a callback merely because the page mentions it',
    )
    expect(normalized).toContain(
      'When the authenticated Linq/iMessage or Telegram room explicitly asks Murph to remember, correct, retire, or forget room-local social context, use `murph.group_room_model`',
    )
    expect(normalized).toContain(
      'If `show` fails or the write is stale, stop and do not claim the requested change was saved.',
    )
    expect(normalized).toContain(
      'Group email may discuss current context but must direct a write request back to the authenticated room.',
    )
    expect(normalized).toContain(
      'Ordinary banter, a single reaction, or a merely successful reply does not justify an immediate page write',
    )
  })

})
