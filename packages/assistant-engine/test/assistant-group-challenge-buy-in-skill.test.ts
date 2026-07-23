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

describe('assistant group challenge buy-in guidance', () => {
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
      'ask each intended participant to say they are in or react positively',
    )
    expect(challenge).toContain(
      'A reaction counts when you can actually attribute it to that person and proposal',
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

  it('keeps challenge personalization optional without inventing setup rationale', async () => {
    const challenge = (await readSkill('group-challenge')).replace(/\s+/gu, ' ')

    expect(challenge).toContain(
      'Offer optional introductions and photos once.',
    )
    expect(challenge).toContain(
      'Say plainly that the challenge starts without either.',
    )
    expect(challenge).toContain(
      'Do not follow up on silence or name who is "missing" optional material.',
    )
    expect(challenge).toContain(
      'Accept a photo from the person depicted or with their explicit approval',
    )
    expect(challenge).toContain(
      'optional materials never delay the challenge.',
    )
    expect(challenge).toContain(
      'Do not quote this skill or invent a hidden rationale',
    )
    expect(challenge).toContain(
      'If the record does not establish why, own the omission briefly, make the optional invitation, and continue.',
    )
    expect(challenge).toContain(
      'Missing optional material never delays a comic or dispatch.',
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
      'a clear reply or an attributable positive reaction is enough',
    )
    expect(groupChat).toContain(
      'do not wake a silent member up to find that they were automatically entered either',
    )
    expect(groupChat).toContain(
      'What the group safely and individually opts to do within the `groupchat-comedy` hard limits',
    )
    expect(groupChat).not.toContain('joining a challenge is consent to play')
  })
})
