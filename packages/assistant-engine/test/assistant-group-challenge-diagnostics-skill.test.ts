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
  it('enumerates sleep-stage and workout-array scoring semantics', async () => {
    const challenge = (await readSkill('group-challenge')).replace(/\s+/gu, ' ')

    expect(challenge).toContain('Deep sleep minutes: `deep-sleep-days.v0`')
    expect(challenge).toContain('REM sleep minutes: `rem-sleep-days.v0`')
    expect(challenge).toContain(
      "Every workout's local start time, duration, and type by day: `workouts.v0`",
    )
    expect(challenge).toContain(
      'normalize the configured threshold once at kickoff to an integer number of milliseconds after local midnight',
    )
    expect(challenge).toContain('6:00 PM is `64,800,000`')
    expect(challenge).toContain(
      '`days[date].some(w => w.startLocalMs > thresholdLocalMs)`',
    )
    expect(challenge).toContain(
      'a workout starting exactly at the threshold does not count as after it',
    )
    expect(challenge).toContain(
      'A settled date present with an empty list is a real observed zero and is scoreable as no qualifying workout',
    )
    expect(challenge).toContain(
      'A date absent from `days` is unobserved: it is not `false`, zero, or evidence that no workout happened',
    )
    expect(challenge).toContain(
      '`canonical-event-zone-or-vault-zone.v0`',
    )
    expect(challenge).toContain(
      'canonical event timezone when available and otherwise the member vault timezone',
    )
    expect(challenge).toContain(
      'original threshold wording and normalized integer `thresholdLocalMs`',
    )
    expect(challenge).toContain(
      'Score a workout date only when `date <= calendarClosedThroughDate`',
    )
    expect(challenge).toContain(
      'after the date has ended in UTC-12, the last civil timezone to leave it',
    )
    expect(challenge).toContain(
      'the visible snapshot advances only on the next ordinary projection refresh and has no promised finite refresh deadline',
    )
    expect(challenge).toContain(
      'Never advance a stale snapshot from the reader\'s clock.',
    )
    expect(challenge).toContain(
      'human-readable context, not a scoring metric or settlement authority',
    )
    expect(challenge).toContain(
      'must not silently rewrite the result the group already received',
    )
  })

  it('keeps established Steps challenges on their existing date behavior', async () => {
    const challenge = (await readSkill('group-challenge')).replace(/\s+/gu, ' ')

    expect(challenge).toContain(
      'For `deep-sleep-days.v0` and `rem-sleep-days.v0`, the producer marks the open member-local date `data.provisional: true`; absence means settled.',
    )
    expect(challenge).toContain(
      'Other scopes keep their existing date behavior; current-date Steps remains scoreable.',
    )
    expect(challenge).toContain(
      'Never substitute a reader, group, or schedule clock',
    )
    expect(challenge).not.toContain('scoringTimeZone')
    expect(challenge).not.toContain('scoringDateRule')
    expect(challenge).not.toContain('prior-dispatch-local-date-only.v0')
    expect(challenge).not.toContain(
      'Use one deterministic date-completeness rule for every challenge',
    )
    expect(challenge).not.toContain('For every challenge, also store')
    expect(challenge).not.toContain(
      'For a legacy active page missing either field, append both',
    )
    expect(challenge).not.toContain('reporting cutoff')
  })

  it('keeps current-date-only completed-scope evidence pending without diagnostics', async () => {
    const challenge = (await readSkill('group-challenge')).replace(/\s+/gu, ' ')

    expect(challenge).toContain(
      'If every record otherwise eligible under that scope\'s producer-owned completion marker is pending, keep the participant pending',
    )
    expect(challenge).toContain(
      'skip diagnostics and permission offers',
    )
    expect(challenge).toContain('describe the applicable settlement rule.')
    expect(challenge).not.toContain('next dispatch')
    expect(challenge).toContain(
      'A completed-date `pending` participant is never eligible for either offer.',
    )
  })

  it('scores prior-date records for the new completed-date scopes normally', async () => {
    const challenge = (await readSkill('group-challenge')).replace(/\s+/gu, ' ')
    const completedDateRule =
      'For `deep-sleep-days.v0` and `rem-sleep-days.v0`, the producer marks the open member-local date `data.provisional: true`; absence means settled.'

    expect(challenge).toContain(completedDateRule)
    expect(challenge).toContain(
      'Rank only settled records',
    )
    expect(challenge).toContain(
      'with challenge-metric data eligible under the scope\'s applicable date behavior: rank the participant from that metric evidence.',
    )
  })

  it('routes a genuinely missing snapshot into the existing recovery flow', async () => {
    const challenge = (await readSkill('group-challenge')).replace(/\s+/gu, ' ')

    expect(challenge).toContain(
      '`status="missing"` means it is granted but no usable record was returned',
    )
    expect(challenge).toContain(
      'A genuinely missing snapshot still follows the recovery evidence order below.',
    )
    expect(challenge).toContain(
      'The scoring projection is `granted` but is genuinely missing usable challenge-metric data for reasons other than completed-date eligibility, while `device-sync-status.v0` is `not_granted`',
    )
  })

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
      'A model-size `status="partial"` result keeps every returned member whole',
    )
    expect(challenge).toContain(
      'Never infer that an omitted member left or infer their score, diagnostic state, or permission state',
    )
    expect(challenge).toContain(
      'do not score, diagnose, or offer permission for them',
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
    expect(challenge).toContain(
      'The scheduled dispatch is the one group message where the required completeness statement and per-person missing-data lines always count as substance',
    )
    expect(challenge).toContain(
      'never trim them for length, keep them to about one line per person, keep the whole dispatch compact, and put ranking mechanics or anything longer on the challenge page',
    )
    expect(groupChat).toContain(
      'It is the only hosted model-facing path to the current Web-owned shared snapshot',
    )
    expect(groupChat).toContain(
      'returns every current group member only when `status="ok"`',
    )
    expect(groupChat).toContain(
      'instead names every still-current capacity-omitted member',
    )
    expect(groupChat).not.toContain(
      'returns every current group member with an explicit `status`',
    )
    expect(groupChat).toContain('rank missing data as zero')
    expect(groupChat).toContain(
      'A model-size `status="partial"` result names still-current capacity-omitted members',
    )
  })

  it('records scoped participant keys at kickoff and fails closed for legacy identity backfill', async () => {
    const challenge = (await readSkill('group-challenge')).replace(/\s+/gu, ' ')
    const groupChat = (await readSkill('group-chat')).replace(/\s+/gu, ' ')

    expect(challenge).toContain(
      'When the hosted group exists, after the model turn has begun and before writing the challenge roster',
    )
    expect(challenge).toContain(
      'That is the kickoff attribution and scoring read',
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
      'The scoring projection is `granted` and `available`, with challenge-metric data eligible under the scope\'s applicable date behavior',
      'A completed-date scoring projection is `granted` and `available`, but every record otherwise eligible under the scope\'s producer-owned completion marker is pending',
      'The scoring projection is `not_granted`',
      'The scoring projection is `granted` but is genuinely missing usable challenge-metric data for reasons other than completed-date eligibility, while `device-sync-status.v0` is `not_granted`',
      'The scoring projection is `granted` but is genuinely missing usable challenge-metric data for reasons other than completed-date eligibility, while a recent `device-sync-status.v0` record is `available`',
      'The scoring projection is `granted` but is genuinely missing usable challenge-metric data for reasons other than completed-date eligibility, and diagnostic data is also `granted` but `missing` or stale',
    ]

    for (let index = 1; index < evidence.length; index += 1) {
      expect(challenge.indexOf(evidence[index - 1]!)).toBeLessThan(
        challenge.indexOf(evidence[index]!),
      )
    }

    expect(challenge).toContain(
      'Apply `group-chat`\'s **Shared fact limits** before scoring.',
    )
    expect(challenge).toContain('more than two local calendar days old')
    expect(challenge).toContain('`needs-reconnect` and `disconnected`')
    expect(challenge).toContain(
      '`needs-attention` is generic and must not be translated into a denied Apple Health permission.',
    )
    expect(challenge).toContain('`setting-up` means setup is not complete.')
    expect(challenge).toContain(
      '`connected` means only that the source is connected.',
    )
    expect(challenge).toContain(
      'based on the literal status alone; do not claim reconnecting will restore the metric.',
    )
    expect(challenge).toContain(
      'this group currently lacks recent Steps for the participant',
    )
    expect(challenge).not.toContain(
      'Murph has not received recent Steps from Apple Health',
    )
    expect(challenge).toContain(
      'If the recent projection has an empty `sources` list',
    )
    expect(challenge).toContain(
      'this diagnostic result contains no visible sources',
    )
    expect(challenge).toContain(
      'Apple does not expose HealthKit read authorization',
    )
    expect(challenge).toContain(
      'without guessing about permissions, a disconnected device, source freshness, or whether the participant opened the app.',
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

  it('proactively offers exact missing shares without nagging or confusing sync', async () => {
    const challenge = (await readSkill('group-challenge')).replace(/\s+/gu, ' ')
    const groupChat = (await readSkill('group-chat')).replace(/\s+/gu, ' ')

    expect(challenge).toContain(
      'Read the scoring scope on its own first.',
    )
    // Evidence-gated challenge offers must not inherit the up-front all-scopes
    // rule: the runtime accepts only scopes the most recent read proved
    // not_granted and spends the turn's one attempt on any wider request.
    expect(challenge).toContain(
      'That all-scopes rule does **not** apply to an evidence-gated challenge offer made from `read_shared`',
    )
    expect(challenge).toContain(
      'may name only the scopes the most recent read proved `not_granted`',
    )
    expect(challenge).toContain(
      'whether it is the one-action kickoff offer or a later standings offer.',
    )
    expect(challenge).toContain(
      'During later standings, Murph may proactively open the existing server-authored access flow',
    )
    expect(challenge).toContain(
      'neither an explicit decline for that exact share nor a prior handled offer action for that exact participant and scope.',
    )
    expect(challenge).toContain(
      'A handled action for one participant never suppresses an offer needed by another.',
    )
    expect(challenge).toContain(
      'If `read_current` returns `status="none"`, do not create a hosted group as a side effect of challenge kickoff.',
    )
    expect(challenge).toContain(
      'accepting that displayed permission within 24 hours is the only action those participants need for both entry and sharing',
    )
    expect(challenge).toContain(
      'exact scoring scope it proved `not_granted`',
    )
    expect(challenge).toContain(
      'When current evidence is `not_granted`, state the exact missing group share in ordinary language in this same standings response',
    )
    expect(challenge).toContain(
      'Never infer a missing permission from granted-but-missing or stale data.',
    )
    expect(challenge).toContain(
      'A prior handled action for one participant does not cover a newly affected participant.',
    )
    expect(challenge).toContain(
      'call `murph.group action="offer_access"` exactly once after the read with only those `projectionScopes`.',
    )
    expect(challenge).toContain(
      'it adds no scheduler-side message and no pre-model work.',
    )
    expect(challenge).toContain(
      'Never author generic permission copy or tell someone to Like the standings.',
    )
    expect(challenge).toContain(
      'If a participant explicitly says they do not want to share a scope, record that choice and do not offer, repeat, or nag.',
    )
    expect(challenge).toContain(
      'permission offer cannot connect a source, grant Apple Health or operating-system Steps access',
    )
    expect(challenge).toContain(
      'Its recency evidence is unavailable because final-reply delivery owns presentation timing.',
    )
    expect(challenge).toContain(
      'Never use a scheduled link or a diagnostic-scope offer as challenge buy-in',
    )
    expect(challenge).toContain(
      'This scheduled surface returns `presentation="link"`; include the exact returned `joinUrl` once',
    )
    expect(challenge).toContain(
      'Do not infer, announce, or append a companion message claiming native consent UI is visible.',
    )
    expect(challenge).not.toContain(
      'Say only that a separate permission card is available',
    )
    expect(challenge).not.toContain("Web's card is the visible confirmation")
    expect(challenge).toContain(
      'record that the offer action was handled for that exact participant and scope',
    )
    expect(challenge).not.toContain(
      'When native consent is the only user-facing outcome',
    )
    expect(challenge).not.toContain('If the returned group proves')
    expect(challenge).toContain('active-offer/all-granted dedupe')
    expect(challenge).toContain(
      'Never offer the scoring scope merely because its grant exists but current data is missing.',
    )
    expect(challenge).toContain(
      'literal disconnected, `needs-reconnect`, and other device statuses may get status-appropriate guidance and no access offer.',
    )
    expect(challenge).not.toContain('Gap disclosure log')
    expect(challenge).not.toContain('gapState')
    expect(challenge).not.toContain('episodePublicGapDate')
    expect(challenge).toContain(
      'state the evidence-backed status, and give the smallest useful action.',
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
