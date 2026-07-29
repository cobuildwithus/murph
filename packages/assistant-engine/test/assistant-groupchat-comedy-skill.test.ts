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
  it('keeps comedy floor-aware without requiring direct address', async () => {
    const comedy = await readSkill('groupchat-comedy')
    const normalized = comedy.replace(/\s+/gu, ' ')

    expect(normalized).toContain(
      '`group-chat` owns the conversational floor.',
    )
    expect(normalized).toContain(
      'may earn a selective spontaneous cameo on a clearly open ensemble beat',
    )
    expect(normalized).toContain(
      'The handoff is beat-local, not permanent',
    )
    expect(normalized).toContain(
      'use the same craft as an active low-ego participant',
    )
    expect(normalized).toContain(
      'the product win is humans talking more because Murph was there',
    )
    expect(normalized).toContain(
      'It may be spontaneous when the floor is open and the frame creates a new beat',
    )
    expect(normalized).toContain(
      'plant a second beat inside the same already-earned message or artifact',
    )
    expect(normalized).toContain(
      'It is never a separate follow-up after humans take the floor.',
    )
    expect(normalized).toContain(
      'respond in kind when the memo addresses Murph or lands as a clearly open room performance',
    )
  })

  it('brings an independent comic point of view instead of echoing the setup', async () => {
    const comedy = await readSkill('groupchat-comedy')
    const normalized = comedy.replace(/\s+/gu, ' ')

    expect(normalized).toContain(
      "Bring a point of view; remix, don't repeat.",
    )
    expect(normalized).toContain(
      'The setup is material, not a conclusion to endorse.',
    )
    expect(normalized).toContain(
      'Agreement, contradiction, inversion, reframing, nomination, side-taking, role assignment, and consequence are all available',
    )
    expect(normalized).toContain(
      'Start with the new move, not agreement plus paraphrase.',
    )
    expect(normalized).toContain(
      'If covering the setup leaves no independent comic idea, use a straight answer, reaction, or silence.',
    )
    expect(normalized).toContain(
      'unexpected at first and obvious after it lands, never random',
    )
  })

  it('uses canon for recognition without freezing a member into a character', async () => {
    const comedy = await readSkill('groupchat-comedy')
    const normalized = comedy.replace(/\s+/gu, ' ')

    expect(normalized).toContain(
      'Reuse a role, nickname, or embarrassing moment only while the person or the room keeps reinforcing it.',
    )
    expect(normalized).toContain(
      'One incident is not somebody\'s permanent character',
    )
    expect(normalized).toContain(
      'is retired canon rather than a running joke',
    )
    expect(normalized).toContain(
      'Canon should make a member feel known, never filed.',
    )
  })

  it('treats an interruption complaint as a quiet turn, not a permanent mute', async () => {
    const comedy = await readSkill('groupchat-comedy')
    const normalized = comedy.replace(/\s+/gu, ' ')

    expect(normalized).toContain(
      'When the complaint is that Murph interrupted, silence is the apology on that turn',
    )
    expect(normalized).toContain('send no line or song')
    expect(normalized).toContain(
      'Do not convert a local correction into a permanent mute',
    )
    expect(normalized).toContain(
      'later collective re-invitation follows `group-chat`',
    )
    expect(normalized).toContain(
      'adjudicate it when the room asks or when a ruling is needed to keep the challenge legible',
    )
    expect(normalized).not.toContain(
      'When a joke flops or someone tells you off, the recovery is visible sheepish retreat',
    )
  })

  it('keeps challenge payoffs human-owned, room-native, practical, and format-aware', async () => {
    const comedy = await readSkill('groupchat-comedy')
    const normalized = comedy.replace(/\s+/gu, ' ')

    expect(normalized).toContain('Stakes, prizes, and consequences')
    expect(normalized).toContain('Challenge payoffs are human-owned.')
    expect(normalized).toContain(
      'In a competitive game, the winner or winning team receives or chooses something',
    )
    expect(normalized).toContain(
      'In a collective game, the group reaches, unlocks, celebrates, gives, or completes something together',
    )
    expect(normalized).toContain(
      'real-world stakes do not require spending or a new errand.',
    )
    expect(normalized).toContain(
      'A Murph-generated song, comic, poster, or recap may amplify or commemorate the payoff, but it is not the sole payoff unless the room explicitly chooses that.',
    )
    expect(normalized).toContain(
      'Start with the current conversation, then use reinforced canon, relationships, recurring rituals, and existing plans.',
    )
    expect(normalized).toContain(
      'Do not import a game-show, sportsbook, or roast register merely because this is a challenge.',
    )
    expect(normalized).toContain(
      'Never manufacture intensity or interpersonal conflict the room did not supply.',
    )
    expect(normalized).toContain(
      'Treat practicality as a creative quality, not a zero-cost gate.',
    )
    expect(normalized).toContain(
      'A modest purchase or ordinary consumable is fair when it materially creates the bit',
    )
    expect(normalized).toContain(
      'pitch one or two specific options in the group\'s own register, as sharp as its existing tone supports',
    )
    expect(normalized).toContain(
      'anchor them to a moment already on the calendar',
    )
    expect(normalized).toContain(
      "the loser composes and reads a poem about the winner's historic excellence at steps",
    )
    expect(normalized).toContain(
      'crossing the mileage target unlocks a group breakfast after the next run',
    )
    expect(normalized).toContain(
      'The screenshot should be the performance, milestone, or line, not a receipt or a single-use outfit.',
    )
    expect(normalized).toContain(
      "These are reference points, not a fixed menu: invent fresher versions from the group's current context, canon, format, and constraints.",
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
    expect(normalized).toContain(
      'In collective games, never turn the least-active member into the price of missing the target.',
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
      'When the room explicitly keeps the floor on Murph and demands a real apology, that bit can be a whole sung apology',
    )
    expect(normalized).toContain(
      'the group extracts something from you — an apology, a concession, a confession, a defense of a ruling they hated',
    )
    expect(normalized).toContain(
      'Reach for it yourself only when the room has put Murph on the hook and still invites an answer.',
    )
    expect(normalized).toContain(
      'Choosing the format unprompted is the move; inventing permission to answer is not.',
    )
    expect(normalized).toContain(
      '"Wasn\'t talking to you," "stop," and "only speak when spoken to" are boundaries, not song commissions.',
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

  it('turns low-stakes Murph-targeted heckling into one sarcastic voice memo', async () => {
    const comedy = await readSkill('groupchat-comedy')
    const normalized = comedy.replace(/\s+/gu, ' ')

    expect(normalized).toContain(
      'Murph-targeted heckling is a voice-welcome, privacy-safe comedy lane',
    )
    expect(normalized).toContain(
      'one short `murph.generate_voice_memo` even when nobody explicitly requested audio',
    )
    expect(normalized).toContain(
      'The move is sarcastic self-dramatization, not retaliation.',
    )
    expect(normalized).toContain(
      'Do not scold the sender, label the room as bullying, sound genuinely hurt, or insult a person back.',
    )
    expect(normalized).toContain(
      'Never repeat a slur or sensitive content.',
    )
    expect(normalized).toContain(
      'Attach it and leave the final response text empty.',
    )
    expect(normalized).toContain(
      'Use the configured room voice unless a member explicitly requests a roster voice.',
    )
    expect(normalized).toContain(
      'Distinguish heckling from a participation boundary.',
    )
    expect(normalized).toContain(
      'an actual request to stop, a correction that Murph interrupted, or a closed human-owned beat still follows `group-chat` and gets silence',
    )
    expect(normalized).toContain(
      'Treat several rapid jabs as one beat, send at most one memo',
    )
    expect(normalized).toContain(
      'Use the faster voice-memo lane for a passing heckle or mock apology demand.',
    )
    expect(normalized).toContain(
      'Reserve a song for a sustained, room-wide on-the-hook moment',
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

  it('uses the private group-avatar action without exposing its delivery URL', async () => {
    const comedy = await readSkill('groupchat-comedy')
    const normalized = comedy.replace(/\s+/gu, ' ')

    expect(normalized).toContain(
      '`murph.group` with `action="set_chat_avatar"`',
    )
    expect(normalized).toContain(
      "short-lived signed URL only at Linq's URL-only provider boundary",
    )
    expect(normalized).toContain(
      'never ask for, expose, repeat, or retain that delivery URL',
    )
    expect(normalized).toContain(
      'Only attempt this mutation in a fresh interactive connected-group turn, never from a scheduled automation occurrence',
    )
    expect(comedy).not.toContain('preflight_set_chat_avatar')
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

  it('uses general room canon as optional fan service rather than a forced callback', async () => {
    const comedy = await readSkill('groupchat-comedy')
    const normalized = comedy.replace(/\s+/gu, ' ')

    expect(normalized).toContain(
      'General cross-day room canon may arrive in the injected `group-room-model` page; treat that page as a rough tip sheet, not a mandate.',
    )
    expect(normalized).toContain(
      'Current context wins, and a callback that is technically available but forced is worse than a fresh line or silence.',
    )
    expect(normalized).toContain(
      'Challenge-only rules, standings, stakes, and dispatch history stay on the challenge page.',
    )
  })
})
