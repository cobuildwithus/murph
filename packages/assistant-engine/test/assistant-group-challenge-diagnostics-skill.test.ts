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

describe('assistant group challenge diagnostics guidance', () => {
  it('builds complete or partial standings from the opted-in challenge roster', async () => {
    const challenge = (await readSkill('group-challenge')).replace(/\s+/gu, ' ')
    const groupChat = (await readSkill('group-chat')).replace(/\s+/gu, ' ')

    expect(challenge).toContain(
      'challenge-page participants whose participation state is `in`',
    )
    expect(challenge).toContain('`action="read_current"`')
    expect(challenge).toContain('trusted current roster/grant context')
    expect(challenge).toContain(
      'Left join both shared-data results to that challenge roster by exact `memberId`',
    )
    expect(challenge).toContain('it is not an authoritative roster')
    expect(challenge).toContain(
      'A recorded zero is a real score; missing data is never a zero.',
    )
    expect(challenge).toContain(
      'If neither source provides a current authoritative roster/grant snapshot',
    )
    expect(challenge).toContain(
      'do not publish possibly unauthorized standings',
    )
    expect(challenge).toContain('whether the standings are complete or partial')
    expect(challenge).toContain(
      'Keep ranked participants and people waiting on data in separate parts',
    )
    expect(challenge).toContain(
      'Name every `in` participant who is missing current data',
    )
    expect(challenge).toContain(
      'Never present a partial table as the full standings.',
    )
    expect(groupChat).toContain(
      'This command is a view of landed shared projections, not the current group roster or grant authority.',
    )
    expect(groupChat).toContain('Never rank missing data as zero')
  })

  it('uses the evidence hierarchy and keeps Apple Health uncertainty honest', async () => {
    const challenge = (await readSkill('group-challenge')).replace(/\s+/gu, ' ')
    const evidence = [
      'Current challenge-metric data through the reporting cutoff under a current exact grant',
      'No current grant for the exact metric scope',
      'The exact metric scope is granted but `device-sync-status.v0` is not',
      'A recent `device-sync-status.v0` projection',
      'No recent diagnostic evidence',
    ]

    for (let index = 1; index < evidence.length; index += 1) {
      expect(challenge.indexOf(evidence[index - 1]!)).toBeLessThan(
        challenge.indexOf(evidence[index]!),
      )
    }

    expect(challenge).toContain('more than two local calendar days old')
    expect(challenge).toContain('`needs-reconnect` and `disconnected`')
    expect(challenge).toContain(
      '`needs-attention` is generic and must not be translated into a denied Apple Health permission.',
    )
    expect(challenge).toContain('`setting-up` means setup is not complete.')
    expect(challenge).toContain(
      '`connected` means only that the source is connected; it does not prove that the challenge metric arrived.',
    )
    expect(challenge).toContain(
      'this group does not currently have recent Steps for the participant',
    )
    expect(challenge).not.toContain(
      'Murph has not received recent Steps from Apple Health',
    )
    expect(challenge).toContain(
      'If the recent projection has an empty `sources` list',
    )
    expect(challenge).toContain(
      'That is not proof that no compatible source exists',
    )
    expect(challenge).toContain(
      'Apple does not expose HealthKit read authorization',
    )
    expect(challenge).toContain(
      'Do not guess about permissions, a disconnected device, source freshness, or whether the participant opened the app.',
    )
    expect(challenge).toContain(
      '`connectionSyncJobCompletedAt` field is completion time for a connection-wide sync job',
    )
    expect(challenge).toContain(
      'is neither source-specific nor proof that any health data was received.',
    )
    expect(challenge).toContain(
      'only as the time Murph last completed a connection-wide sync job',
    )
  })

  it('keeps group-share consent distinct from device authorization and route authority', async () => {
    const challenge = (await readSkill('group-challenge')).replace(/\s+/gu, ' ')
    const groupChat = (await readSkill('group-chat')).replace(/\s+/gu, ' ')

    expect(challenge).toContain(
      'request the scoring scope and `device-sync-status.v0` together',
    )
    expect(challenge).toContain(
      'Liking the server-owned offer grants only the disclosed Murph group shares.',
    )
    expect(challenge).toContain(
      'The offer cannot connect a source or grant Apple Health access.',
    )
    expect(challenge).toContain(
      'Post an additive offer once and do not retry or nag',
    )
    expect(challenge).toContain(
      'A scheduled turn has no route authority to post that offer.',
    )
    expect(challenge).toContain(
      'ask Murph interactively for a permission card',
    )
    expect(challenge).toContain(
      'never tell someone to like an ordinary standings message.',
    )
    expect(challenge).toContain('**Gap disclosure log**')
    expect(challenge).toContain('at most one row per participant `memberId`')
    expect(challenge).toContain('`firstPublicGapDate`')
    expect(challenge).toContain(
      "Before composing, read the challenge page's Gap disclosure log",
    )
    expect(challenge).toContain('first append that participant\'s `memberId`')
    expect(challenge).toContain('only after the write returns a successful save receipt')
    expect(challenge).toContain('If the write fails or is ambiguous')
    expect(challenge).toContain('send only the neutral waiting entry')
    expect(challenge).toContain(
      'list that participant neutrally as waiting on data',
    )
    expect(challenge).toContain(
      'Repeated reminders and troubleshooting belong in the affected participant\'s private thread',
    )
    expect(groupChat).toContain(
      '`device-sync-status.v0` is a separate explicit group share',
    )
    expect(groupChat).toContain(
      'A first factual named data-availability note may stay in the group',
    )
  })
})
