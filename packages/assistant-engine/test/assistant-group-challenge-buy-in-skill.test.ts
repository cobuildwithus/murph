import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'

async function readSkill(slug: string): Promise<string> {
  return readFile(
    path.join(resolveAssistantSkillsRoot(), slug, 'SKILL.md'),
    'utf8',
  )
}

describe('assistant group challenge buy-in guidance', () => {
  it('forms the game from the room before prescribing work', async () => {
    const challengeRaw = await readSkill('group-challenge')
    const challenge = challengeRaw.replace(/\s+/gu, ' ')
    const registered = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === 'group-challenge',
    )

    expect(registered?.triggerHint).toContain(
      'social-first formation grounded in the current room',
    )
    expect(registered?.triggerHint).toContain(
      'A vague challenge request is not exercise programming.',
    )
    expect(challenge).toContain(
      'Formation: earn the game before configuring it',
    )
    expect(challenge).toContain(
      'A request to start a challenge is not a request for exercise programming.',
    )
    expect(challenge).toContain(
      'Use the current conversation first and relevant reinforced room canon or the advisory `group-room-model` only when it helps.',
    )
    expect(challenge).toContain('Current context always wins.')
    expect(challenge).toContain(
      'Do not reuse a stock icebreaker, import a game-show or sportsbook voice, or make established friends introduce themselves.',
    )
    expect(challenge).toContain(
      'If context is thin, be plain rather than manufacturing lore.',
    )
    expect(challenge).toContain(
      'If the organizer already gave a concrete game or says to just start, skip the formation beat',
    )
    expect(challenge).toContain(
      'Before requesting another setup contribution, do something useful or fun with what the room already gave you',
    )
    expect(challenge).toContain(
      'it is never challenge buy-in or health-data consent.',
    )
    expect(challenge).toContain(
      'Do not apply `experiment-onboarding`, `behavior-followthrough`, or a training skill merely because a challenge repeats or measures behavior.',
    )
    expect(challengeRaw.indexOf("Open in the room's register")).toBeLessThan(
      challengeRaw.indexOf('Negotiate the metric'),
    )
    expect(challenge).toContain(
      'Do not invent a workout program here; only design the underlying regimen when the room explicitly asks for one.',
    )
  })

  it('asks for a light named roll call before scoring the challenge', async () => {
    const challengeRaw = await readSkill('group-challenge')
    const challenge = challengeRaw.replace(/\s+/gu, ' ')
    const comedy = (await readSkill('groupchat-comedy')).replace(/\s+/gu, ' ')

    expect(challenge).toContain('Get the quick roll call')
    expect(challenge).toContain(
      'recorded as in after the quick roll call',
    )
    expect(challenge).toContain(
      'A data-sharing grant or visit to the join link does not establish challenge buy-in.',
    )
    expect(challenge).not.toContain('joining the challenge is the opt-in')
    expect(challengeRaw.indexOf('Make the stakes real')).toBeLessThan(
      challengeRaw.indexOf('Get the quick roll call'),
    )
    expect(challenge).toContain(
      'something a human will actually receive, choose, give, do, perform, or owe',
    )
    expect(challenge).toContain(
      'may be the sole stake only when the room explicitly chooses that.',
    )
    expect(challenge).toContain(
      'grounded in the room\'s current language, relationships, canon, and plans rather than a generic menu.',
    )
    expect(challenge).toContain(
      'ask each intended participant to reply "in" or like this message',
    )
    expect(challenge).toContain(
      'keep the member-facing instruction concrete: "like this message."',
    )
    expect(challenge).not.toContain('react positively')
    expect(challenge).toContain(
      'Do not prepend a setup-status, progress, or transition sentence',
    )
    expect(challenge).toContain(
      "We're ready once [pending name] checks in. In: [confirmed names]. Waiting on: [pending name].",
    )
    expect(challenge).toContain('silence never means yes')
    expect(challenge).toContain(
      'Score only the people recorded as in; shared data does not add a pending or silent person to the challenge.',
    )
    expect(challenge).toContain(
      'Never ask a pending, declined, or withdrawn person.',
    )
    expect(challenge).toContain(
      'participation state (`in`, `pending`, `declined`, or `withdrawn`)',
    )
    expect(challenge).toContain(
      'If someone declines or later withdraws, record that state in the same turn.',
    )
    expect(challenge).toContain(
      'Never list them as waiting, ask them for challenge materials, score them, or privately check in about challenge silence.',
    )
    expect(challenge).toContain(
      'Re-entry requires a new explicit affirmative response.',
    )
    expect(challenge).toContain(
      'Pending silence never creates a private check-in.',
    )
    expect(comedy).toContain(
      'Pending silence is not a private-check-in occasion.',
    )
    expect(comedy).toContain(
      'members who didn\'t opt in are never scored or made the subject of challenge comedy',
    )
    expect(comedy).toContain(
      'A neutral named update about who is in and still pending is status, not a comedy bit.',
    )
  })

  it('requires a room-native cast invitation without gating the challenge', async () => {
    const challenge = (await readSkill('group-challenge')).replace(/\s+/gu, ' ')

    expect(challenge).toContain(
      'Invite room-native cast material and photos.',
    )
    expect(challenge).toContain(
      'ask each currently confirmed participant by name in one group message',
    )
    expect(challenge).toContain(
      'For established friends, ask for a claim, prediction, nomination, role, or other new material instead of making them introduce themselves.',
    )
    expect(challenge).toContain(
      'Use the current conversation and reinforced room canon to phrase the invitation',
    )
    expect(challenge).toContain(
      'The invitation is required; its exact prompt is not. The contributions are optional.',
    )
    expect(challenge).toContain(
      'If someone already volunteered useful material during formation, do not re-ask that part.',
    )
    expect(challenge).toContain(
      'Do not skip the invitation because setup is short, late, or already underway.',
    )
    expect(challenge).toContain(
      'If someone confirms after kickoff, include the same room-native invitation in the acknowledgement of their opt-in.',
    )
    expect(challenge).toContain(
      'Say plainly that the challenge starts or continues without either.',
    )
    expect(challenge).toContain(
      'Use a photo sent or explicitly approved by the person depicted.',
    )
    expect(challenge).toContain(
      'any intro, claim, prediction, nomination, role, or other contribution they volunteered (verbatim)',
    )
    expect(challenge).toContain(
      'Pay off at least one actual room detail, contribution, or stake immediately.',
    )
    expect(challenge).toContain(
      'generic challenge-host copy is not a kickoff.',
    )
    expect(challenge).toContain(
      'Missing optional material never delays a comic or dispatch.',
    )
    expect(challenge).toContain(
      'Use pinned photos when available; never delay close-out to collect them.',
    )
    expect(challenge).not.toContain(
      'If a confirmed participant still owes an intro or photo a day later',
    )
    expect(challenge).not.toContain(
      'invite the room to introduce them or send a picture of them',
    )
  })

  it('separates conversational challenge buy-in from group data sharing', async () => {
    const groupChat = (await readSkill('group-chat')).replace(/\s+/gu, ' ')

    expect(groupChat).toContain(
      'group membership or data sharing alone is not a yes to every challenge',
    )
    expect(groupChat).toContain(
      'reply "in" or like the roll-call message',
    )
    expect(groupChat).not.toContain('positive reaction')
    expect(groupChat).toContain(
      'do not wake a silent member up to find that they were automatically entered either',
    )
    expect(groupChat).toContain(
      'What the group safely and individually opts to do within the `groupchat-comedy` hard limits',
    )
    expect(groupChat).not.toContain('joining a challenge is consent to play')
  })
})
