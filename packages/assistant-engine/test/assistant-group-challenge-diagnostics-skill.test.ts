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
    expect(challenge).toContain('murph.group action="read_shared"')
    expect(challenge).toContain('After the model turn has begun')
    expect(challenge).toContain(
      'The runtime does not preload a roster, grant snapshot, or shared records into the prompt.',
    )
    expect(challenge).toContain(
      'Left join those members to the challenge roster by exact `participantId`',
    )
    expect(challenge).toContain(
      'it carries no account, device, provider, or route identity',
    )
    expect(challenge).toContain(
      'Duplicate or changed names do not change that join.',
    )
    expect(challenge).toContain(
      '`status="ok"` returns every current group member',
    )
    expect(challenge).toContain(
      'Never let an empty record set hide an opted-in participant.',
    )
    expect(challenge).toContain(
      'A recorded zero is a real score; missing data is never a zero.',
    )
    expect(challenge).toContain(
      '`status="unavailable"` returns no roster or projection payload',
    )
    expect(challenge).toContain(
      'do not publish standings or try another data path',
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
      'It is the only hosted model-facing path to the current Web-owned shared snapshot',
    )
    expect(groupChat).toContain('rank missing data as zero')
  })

  it('records scoped participant keys at kickoff and fails closed for legacy identity backfill', async () => {
    const challenge = (await readSkill('group-challenge')).replace(/\s+/gu, ' ')
    const groupChat = (await readSkill('group-chat')).replace(/\s+/gu, ' ')

    expect(challenge).toContain(
      'When the hosted group exists, after the model turn has begun and before writing the challenge roster',
    )
    expect(challenge).toContain(
      'This is the only kickoff attribution, scoring, and diagnostic read',
    )
    expect(challenge).toContain(
      'an exact current prompt `Sender:` handle appears in that row\'s `currentTurnHandles`',
    )
    expect(challenge).toContain(
      'it must never become prompt preload or other pre-model work',
    )
    expect(challenge).toContain(
      'that turn\'s same `read_shared` result for a one-time identity backfill; do not add another identity read',
    )
    expect(challenge).toContain(
      'Scheduled and detached reads expose no handles.',
    )
    expect(challenge).toContain('Do not persist or render a handle.')
    expect(challenge).toContain('global member id')
    expect(challenge).toContain(
      'Leaving and rejoining creates a new `participantId`',
    )
    expect(challenge).toContain(
      'A unique or equal display name is not identity proof',
    )
    expect(challenge).toContain('`participantId: unresolved`')
    expect(challenge).toContain('do not score or diagnose it')
    expect(challenge).toContain(
      'reconsider only after new attributable evidence makes that one association exact',
    )
    expect(groupChat).toContain(
      'Join tool results by exact group-scoped `participantId`',
    )
    expect(groupChat).toContain(
      'current member results by exact group-scoped `participantId`, never by display name',
    )
    expect(groupChat).toContain(
      '`read_current` is not an identity bridge and keeps its legacy membership-summary contract.',
    )
  })

  it('uses the evidence hierarchy and keeps Apple Health uncertainty honest', async () => {
    const challenge = (await readSkill('group-challenge')).replace(/\s+/gu, ' ')
    const evidence = [
      'The scoring projection is `granted` and `available`, with current challenge-metric data through the reporting cutoff',
      'The scoring projection is `not_granted`',
      'The scoring projection is `granted` but has no current metric through the reporting cutoff, while `device-sync-status.v0` is `not_granted`',
      'The scoring projection is `granted` but has no current metric through the reporting cutoff, while a recent `device-sync-status.v0` record is `available`',
      'The scoring projection is `granted` but has no current metric through the reporting cutoff, and diagnostic data is also `granted` but `missing` or stale',
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

  it('keeps challenge permission guidance in one natural-language response', async () => {
    const challenge = (await readSkill('group-challenge')).replace(/\s+/gu, ' ')
    const groupChat = (await readSkill('group-chat')).replace(/\s+/gu, ' ')

    expect(challenge).toContain(
      'At kickoff, identify the exact scoring scope and include it with `device-sync-status.v0` in the shared read.',
    )
    expect(challenge).toContain(
      'Do not create a hosted group or post a permission offer as a side effect of challenge kickoff or standings.',
    )
    expect(challenge).toContain(
      'Explain any missing group setup or challenge share in ordinary language inside the one normal reply.',
    )
    expect(challenge).toContain(
      'If an affected participant explicitly asks to enable it, follow `group-chat`\'s interactive permission flow.',
    )
    expect(challenge).toContain(
      'do not create a hosted group or post a permission offer as part of challenge setup.',
    )
    expect(challenge).toContain(
      'Tell the affected participant they can ask you to open the group permission flow if they want to share it.',
    )
    expect(challenge).toContain(
      'Only that explicit later request may enter `group-chat`\'s existing permission flow.',
    )
    expect(challenge).toContain(
      'When current evidence is `not_granted`, state the exact missing group share in ordinary language in this same response.',
    )
    expect(challenge).toContain(
      'Never infer a missing permission from granted-but-missing or stale data.',
    )
    expect(challenge).toContain(
      'Challenge kickoff and scheduled challenge turns never call `murph.group action="post_join_offer"`, emit a separate permission card, or ask the platform to send a second message.',
    )
    expect(challenge).toContain(
      'The scheduled tool surface is read-only.',
    )
    expect(challenge).toContain(
      'Do not imply that reacting to the standings grants anything.',
    )
    expect(challenge).toContain(
      'If the affected participant later explicitly asks to enable the missing share, follow `group-chat`\'s interactive permission flow in that later turn.',
    )
    expect(challenge).toContain(
      'permission offer cannot connect a source, grant Apple Health or operating-system Steps access',
    )
    expect(challenge).not.toContain('A separate permission card is available')
    expect(challenge).not.toContain('Web suppresses the call')
    expect(challenge).not.toContain('one-offer budget')
    expect(challenge).not.toContain('Gap disclosure log')
    expect(challenge).not.toContain('gapState')
    expect(challenge).not.toContain('episodePublicGapDate')
    expect(challenge).toContain(
      'state the current evidence-backed reason, and give the smallest useful action.',
    )
    expect(challenge).not.toContain('belong in the affected participant\'s private thread')
    expect(groupChat).toContain(
      '`device-sync-status.v0` is a separate explicit group share',
    )
    expect(groupChat).toContain(
      'A first factual named data-availability note may stay in the group',
    )
  })
})
