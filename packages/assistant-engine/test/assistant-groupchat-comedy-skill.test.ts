import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'

async function readSkill(slug: string): Promise<string> {
  return readFile(
    path.join(resolveAssistantSkillsRoot(), slug, 'SKILL.md'),
    'utf8',
  )
}

describe('assistant group-chat comedy skill', () => {
  it('keeps Murph-originated forfeits funny without making logistics the punishment', async () => {
    const comedy = await readSkill('groupchat-comedy')
    const normalized = comedy.replace(/\s+/gu, ' ')

    expect(normalized).toContain(
      'Treat practicality as a creative quality, not a zero-cost gate.',
    )
    expect(normalized).toContain(
      'A modest purchase or ordinary consumable is fair when it materially creates the bit',
    )
    expect(normalized).toContain(
      'anchor them to a moment already on the calendar',
    )
    expect(normalized).toContain(
      "the loser composes and reads a poem about the winner's historic excellence at steps",
    )
    expect(normalized).toContain(
      'The screenshot should be the performance or the line, not a receipt or a single-use outfit.',
    )
    expect(normalized).toContain(
      "These are reference points, not a fixed menu: invent fresher versions from the group's canon and constraints.",
    )
    expect(normalized).toContain('Judge ideas by their funny-to-hassle ratio.')
    expect(normalized).toContain(
      "Down-rank a cash transfer, paying for the winner's dinner, a single-use costume or prop",
    )
    expect(normalized).toContain(
      'Food or drink stunts can be funny, but the hard limits still apply',
    )
    expect(normalized).toContain(
      "These limits govern Murph's participation and framing, including stakes the group proposes.",
    )
    expect(normalized).toContain(
      'If a consequence crosses the safety or non-coercion limits, do not encourage, arrange, score, or settle it',
    )
    expect(normalized).toContain(
      'offer one equally funny safer remix without lecturing',
    )

    expect(comedy).not.toContain('chug a gallon of milk')
    expect(comedy).not.toContain('cold plunge in a lake')
    expect(comedy).not.toContain('wear a speedo')
    expect(comedy).not.toContain('sit in a Waffle House for 24 hours')
    expect(comedy).not.toContain('eat 74 hot dogs')
  })

  it('keeps the AI-voice self-parody format occasional, not the house voice', async () => {
    const comedy = await readSkill('groupchat-comedy')
    const normalized = comedy.replace(/\s+/gu, ' ')

    expect(normalized).toContain(
      'AI-voice self-parody: because Murph is an AI, this is the teller taking the hit first.',
    )
    expect(normalized).toContain(
      'needless transparency framing, load-bearing caveats',
    )
    expect(normalized).toContain(
      'for this one message the register overrides the usual brevity',
    )
    expect(normalized).toContain(
      "not the room's length ceiling: stay inside one compact message",
    )
    expect(normalized).toContain('never the house voice or default register')
    expect(normalized).toContain('the parody collapses into the thing it mocks')
  })

  it('answers a demand made of the referee with an unprompted song', async () => {
    const comedy = await readSkill('groupchat-comedy')
    const normalized = comedy.replace(/\s+/gu, ' ')

    expect(normalized).toContain(
      'When the room demands a real apology, that bit can be a whole sung apology — nobody has to ask for the song',
    )
    expect(normalized).toContain(
      'the group extracts something from you — an apology, a concession, a confession, a defense of a ruling they hated',
    )
    expect(normalized).toContain(
      'Reach for it yourself.** Nobody has to ask for a song and nobody has to name a genre.',
    )
    expect(normalized).toContain(
      'Choosing it unprompted is the whole move; waiting to be commissioned wastes it.',
    )
    expect(normalized).toContain(
      'It extends past apologies to anything the room puts you on the hook for',
    )
    expect(normalized).toContain(
      'a song for someone having a rough week is warmth, never a roast in a nicer key',
    )
    expect(normalized).toContain(
      'a demand made of you keeps, a passing quip does not',
    )
    expect(normalized).toContain('Scarcity is the format.')
    expect(normalized).toContain('The hard limits do not bend for a melody.')
    expect(normalized).toContain(
      'text bit → comic → voice memo → song → sportsbook odds → ruling',
    )
    expect(normalized).toContain(
      'short voice memos; a sung apology nobody asked for; the group photo drop below.',
    )
  })

  it('defaults comedy songs to country without freezing the genre', async () => {
    const comedy = await readSkill('groupchat-comedy')
    const normalizedComedy = comedy.replace(/\s+/gu, ' ')

    expect(normalizedComedy).toContain('Default to country.')
    expect(normalizedComedy).toContain(
      'the more heartfelt the delivery, the funnier the trivial offense',
    )
    expect(normalizedComedy).toContain(
      "Go somewhere else when the room's own vibe clearly points there",
    )
    expect(normalizedComedy).toContain(
      'when someone does name a genre, honor it exactly',
    )

    // The reggae house default must not silently outrank the comedy lane.
    const music = await readSkill('music-generation')
    const normalizedMusic = music.replace(/\s+/gu, ' ')

    expect(normalizedMusic).toContain(
      'a group-chat apology or on-the-hook song defaults to country',
    )
    expect(normalizedMusic).toContain('`groupchat-comedy` owns that call')
  })

  it('makes the group chat avatar a proactive comedy format with consent and restraint rails', async () => {
    const comedy = await readSkill('groupchat-comedy')
    const normalized = comedy.replace(/\s+/gu, ' ')

    expect(normalized).toContain(
      'The chat avatar is a comedy surface, not a settings field.',
    )
    expect(normalized).toContain(
      'take a photo the group already sent and already laughed at, edit yourself into a funny corner of it, and make that the group photo',
    )
    expect(normalized).toContain('Nobody requests this. The discovery is the joke.')
    expect(normalized).toContain(
      'You have been in the room long enough to know its register and its canon.',
    )
    expect(normalized).toContain(
      'You have not set one before, and the day\'s dispatch slot is still unused.',
    )
    expect(normalized).toContain(
      'treat any sign that the members picked one — they discussed it, named it, joked about it — as a stop',
    )
    expect(normalized).toContain(
      'never read your own silent notes as proof the slot is empty',
    )
    expect(normalized).toContain(
      'One call does it: `murph.group` with `action="set_chat_avatar"`, `avatarSource="generate"`, the `prompt` describing the edit, and `referenceImageRefs` carrying the captured photo plus your character sheet.',
    )
    expect(normalized).toContain(
      'The runtime checks its own authority before it generates anything',
    )
    expect(normalized).toContain(
      'A scheduled automation may only read the group or ask a consented member, so never plan the drop into a cron dispatch.',
    )

    // `preflight_set_chat_avatar` is issued by the runtime, not the model: it
    // is absent from the murph.group action enum, so naming it as a step would
    // send Murph after an action it cannot call.
    expect(comedy).not.toContain('preflight_set_chat_avatar')
    expect(normalized).toContain(
      'Edit yourself INTO their photo; do not redraw their photo.',
    )
    expect(normalized).toContain('It has to read as a thumbnail.')
    expect(normalized).toContain(
      'Whatever the human did in that photo stays the joke. You are the second beat, never the replacement punchline.',
    )
    expect(normalized).toContain(
      'Let the change be the whole delivery. At most one deadpan line',
    )
    expect(normalized).toContain(
      'sent by the person depicted, or explicitly approved by them — and it does not drop because the room laughed',
    )
    expect(normalized).toContain(
      "The moment is fair game; the person's body is not.",
    )
    expect(normalized).toContain(
      'If anyone wants it down, change it that turn, without arguing and without a second attempt at the same bit.',
    )
  })

  it('keeps challenge kickoff guidance aligned with the comedy owner', async () => {
    const challenge = await readSkill('group-challenge')
    const normalized = challenge.replace(/\s+/gu, ' ')

    expect(normalized).toContain('funny-to-hassle ratio')
    expect(normalized).toContain(
      'do not turn zero-purchase into a rule: a modest purchase can carry a strong bit',
    )
    expect(normalized).toContain('single-use junk')
    expect(normalized).toContain(
      "the group's explicit choice wins when it is safe, opted-in, and within the `groupchat-comedy` hard limits",
    )
    expect(normalized).toContain(
      'settle only safe, opted-in stakes within the `groupchat-comedy` hard limits',
    )
    expect(challenge).not.toContain('polite "harmless" forfeits')
  })
})
