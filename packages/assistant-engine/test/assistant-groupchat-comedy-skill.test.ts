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
      'short voice memos; a sung apology nobody asked for.',
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

  it('makes the group photo an unprompted offer whose visible text carries the whole scope', async () => {
    const comedy = await readSkill('groupchat-comedy')
    const normalized = comedy.replace(/\s+/gu, ' ')

    expect(normalized).toContain(
      'The chat avatar is a comedy surface, not a settings field.',
    )
    expect(normalized).toContain(
      'the move is to offer to edit yourself into it and make it the group photo',
    )
    expect(normalized).toContain(
      'Having the idea unprompted is your half of this; the yes is theirs.',
    )

    // The user-visible offer must carry every material effect, as one
    // contiguous sentence the room actually reads. A yes to a vaguer offer
    // cannot stand in for consent to AI processing, durable retention, public
    // hosting, or an irreversible shared-icon replacement.
    expect(normalized).toContain(
      'want me to put myself in that photo and make it the group icon? it goes through an image generator, the result gets saved and lives at a public link, and I can\'t put your current icon back.',
    )
    expect(normalized).toContain(
      'a yes to a vague offer is not a yes to any of it',
    )
    expect(normalized).toContain(
      'their photo goes through an image generator, the result is saved, it is hosted at a public link, and you cannot put the current icon back',
    )
    expect(normalized).toContain(
      'A yes to an older, vaguer offer does not count.',
    )
    expect(normalized).toContain('Silence is a no.')
    expect(normalized).toContain(
      'Everyone identifiable in the photo has to say yes to that, not just whoever sent it',
    )
    expect(normalized).toContain(
      'the room has to be fine with its icon changing',
    )
    expect(normalized).toContain('The surprise survives the ask.')

    // Ordinary-turn-only: a scheduled occurrence cannot mutate an avatar, so
    // the section must not read as a dispatch format.
    expect(normalized).toContain(
      'Offer it yourself, on an ordinary group turn.',
    )
    expect(normalized).toContain(
      'This is never a scheduled or automated move: a cron occurrence cannot change an avatar at all, and it is not one of the day\'s dispatch formats.',
    )
    expect(normalized).not.toContain('the group photo drop below')

    // Do not offer a capability the surface cannot perform, and never leave an
    // accepted offer unanswered.
    expect(normalized).toContain(
      'Do not offer where you cannot deliver.',
    )
    expect(normalized).toContain(
      'a Telegram group has no way to set a chat photo, so the bit never starts there',
    )
    expect(normalized).toContain(
      'Once they have said yes, they are owed an outcome.',
    )
    expect(normalized).toContain(
      'say so in one plain line ("I couldn\'t update this chat\'s icon") and stop',
    )
    expect(normalized).toContain(
      'never claim the icon changed when it did not',
    )

    expect(normalized).toContain(
      'One call: `murph.group` with `action="set_chat_avatar"`, `avatarSource="generate"`, the `prompt` describing the edit, and `referenceImageRefs` carrying the photo plus your character sheet.',
    )
    expect(normalized).toContain(
      'Edit yourself INTO their photo; do not redraw their photo.',
    )
    expect(normalized).toContain('It has to read as a thumbnail.')
    expect(normalized).toContain(
      "The moment is fair game; the person's body is not.",
    )
    expect(normalized).toContain(
      'Say plainly that you cannot put the previous photo back, because you cannot.',
    )

    // `preflight_set_chat_avatar` is issued by the runtime, not the model: it is
    // absent from the murph.group action enum, so naming it as a step would send
    // Murph after an action it cannot call.
    expect(comedy).not.toContain('preflight_set_chat_avatar')
    // The offer is what supplies consent and replacement authority, so the skill
    // must not reintroduce a silent unprompted overwrite or its state machinery.
    expect(comedy).not.toContain('replaceExistingChatIcon')
    expect(comedy).not.toContain('chat_icon_already_set')
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
