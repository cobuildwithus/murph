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
      'If a confirmed participant still owes an intro or photo a day later',
    )
    expect(challenge).toContain(
      'Never ask a pending person for challenge materials; their silence is not something to follow up on.',
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

  it('keeps setup interactive and commits only terminal sent scheduled dispatches', async () => {
    const challengeRaw = await readSkill('group-challenge')
    const challenge = challengeRaw.replace(/\s+/gu, ' ')

    expect(challenge).toContain(
      'During interactive setup only, create one daily dispatch automation',
    )
    expect(challenge).toContain(
      'A scheduled occurrence never creates, edits, reschedules, or archives an automation; it enters directly at the numbered run steps below.',
    )
    expect(challenge).toContain(
      'every confirmed participant has been asked once for a one-line intro or fun fact plus an optional photo',
    )
    expect(challenge).toContain(
      'asking and recording the response or absence is mandatory, the photo itself is always optional',
    )
    expect(challenge).toContain(
      'label it as a group-challenge dispatch, name the exact challenge-page slug',
    )
    expect(challenge).toContain(
      'require each run to read `group-chat`, `group-challenge`, and `groupchat-comedy`',
    )
    expect(challenge).toContain(
      'The automation prompt is a pointer into this skill and durable page, not a copied lifecycle.',
    )
    expect(challenge).toContain(
      'Medium means text, comic/image, voice memo, or song.',
    )
    expect(challenge).toContain(
      'Audit, sportsbook, ruling, press conference, poem, and similar devices are creative frames, not different media',
    )
    expect(challenge).toContain(
      'safe rotation cues in the parent-supplied context when present',
    )
    expect(challenge).toContain(
      'across a five-to-seven-day challenge use every available medium before repeating one',
    )
    expect(challenge).toContain(
      'an unavailable medium is simply skipped in that selection, not tracked as a plan',
    )
    expect(challenge).not.toContain('Activation gate')
    expect(challenge).not.toContain('planned medium')
    expect(challenge).not.toContain('planned sequence')
    expect(challenge).toContain(
      'Terminal delivery history uses one parent-committed `Delivered dispatch <occurrenceAt>` H2 per scheduled occurrence that reached `sent`',
    )
    expect(challenge).toContain(
      "the model's complete private run record plus locator-free accepted-delivery evidence",
    )
    expect(challenge).toContain(
      'Scheduled challenge context excludes Roster & intros, all Delivered dispatch sections, and every raw ref, ID, path, or URL.',
    )
    expect(challenge).toContain(
      'When no safe rotation cue is supplied, choose the medium that best fits the current grounded material without claiming a rotation guarantee',
    )
    expect(challenge).toContain(
      'A scheduled turn has no native shell or CLI execution environment',
    )
    expect(challenge).toContain(
      'performs no page, memory, or lifecycle writes',
    )
    expect(challenge).toContain(
      'returns the complete run record in `privateSummary`',
    )
    expect(challenge).toContain(
      'The parent binds trusted task authority and the exact occurrence to the queued outbox intent.',
    )
    expect(challenge).toContain(
      'Before returning a scheduled `send_message`, provide a complete required `privateSummary` for this run',
    )
    expect(challenge).toContain(
      'the exact text body and every complete image prompt, spoken script, song prompt, or lyrics used',
    )
    expect(challenge).toContain(
      'Keep this nonempty record within 50,000 characters; the parent validates the bound before queueing.',
    )
    expect(challenge).toContain(
      'Never include refs, IDs, paths, or URLs.',
    )
    expect(challenge).not.toContain('its complete current `body`')
    expect(challenge).toContain(
      'the effect owner verifies the current task binding, archives the challenge page first, removes the exact pointer, and then archives the exact automation revision',
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
