import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  appendJournal,
  initializeVault,
  upsertMemory,
} from '@murphai/core'
import {
  buildHostedVaultShareProjectionScopeKey,
  getHostedVaultShareDailyMetricProjectionSpec,
  HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
  HOSTED_VAULT_SHARE_PROFILE_NAME_MAX_LENGTH,
  HOSTED_VAULT_SHARE_PROFILE_NAME_RECORD_KEY,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
  type HostedVaultShareDeliveryRecordData,
  type HostedVaultShareProjectionScope,
} from '@murphai/hosted-execution/vault-share'

import {
  MURPH_ASSISTANT_SKILLS_ROOT_ENV,
} from '../src/assistant-skill-assets.js'
import {
  MURPH_MANAGED_AUTOMATIONS,
  MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
  MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
  MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
} from '../src/assistant/managed-automations.js'
import {
  resolveAssistantScheduledTaskAuthority,
  type AssistantScheduledTaskAuthority,
} from '../src/assistant/scheduled-task-authority.js'
import {
  buildAssistantNotificationDecisionSystemPromptLayers,
  buildAssistantSystemPromptLayers,
  type AssistantNotificationDecisionSystemPromptInput,
} from '../src/assistant/system-prompt.js'
import {
  executeScheduledReadDynamicTool,
  MURPH_SCHEDULED_READ_TOOL,
  readScheduledReadDynamicToolRequest,
  type ScheduledReadDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools/scheduled-read.js'
import { upsertKnowledgePage } from '../src/knowledge.js'

const tempRoots: string[] = []
const originalSkillsRoot = process.env[MURPH_ASSISTANT_SKILLS_ROOT_ENV]

afterEach(async () => {
  if (originalSkillsRoot === undefined) {
    delete process.env[MURPH_ASSISTANT_SKILLS_ROOT_ENV]
  } else {
    process.env[MURPH_ASSISTANT_SKILLS_ROOT_ENV] = originalSkillsRoot
  }
  await Promise.all(tempRoots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })))
})

describe('scheduled read dynamic tool', () => {
  it('accepts only the bounded discriminated read contract', () => {
    const validRequests: unknown[] = [
      { action: 'knowledge_list' },
      { action: 'knowledge_get', slug: 'weekly-health-insights' },
      { action: 'knowledge_search', query: 'sleep consistency' },
      { action: 'memory_show' },
      { action: 'search', query: 'afternoon energy' },
      { action: 'recent_records', family: 'journal', limit: 10 },
      { action: 'latest' },
      { action: 'metric_latest', metric: 'hrv' },
      { action: 'metric_trend', metric: 'resting_heart_rate' },
      { action: 'drift' },
      {
        action: 'sleep_pattern',
        date: '2026-07-10',
        from: '2026-07-01',
        providers: ['oura'],
        timeZone: 'America/New_York',
        to: '2026-07-10',
        windowDays: 366,
      },
      { action: 'sources' },
      { action: 'record', id: 'journal:2026-07-18' },
      { action: 'skill_get', slug: 'group-chat' },
      { action: 'group_challenge_context' },
      { action: 'group_shared' },
    ]

    for (const request of validRequests) {
      expect(readRequest(request)).toMatchObject({ kind: 'scheduled-read' })
    }

    for (const request of [
      { action: 'knowledge_get', path: 'derived/knowledge/index.md', slug: 'weekly-health-insights' },
      { action: 'search', experimentSlug: 'model-selected-experiment', query: 'sleep' },
      { action: 'search', query: 'sleep', url: 'https://example.test/private' },
      { action: 'sources', token: 'model-controlled' },
      { action: 'record', id: '../../bank/memory.md' },
      { action: 'recent_records', limit: 101 },
      { action: 'metric_trend', metric: 'hrv', windowDays: 31 },
      { action: 'sleep_pattern', timeZone: 'not-a-time-zone' },
      { action: 'sleep_pattern', windowDays: 367 },
      { action: 'sleep_pattern', now: '2026-07-10T12:00:00.000Z' },
      { action: 'skill_get', slug: '../../bank' },
      { action: 'skill_get', slug: 'not-a-registered-skill' },
      {
        action: 'group_shared',
        memberId: 'model-selected-member',
        projectionKind: 'steps-days.v0',
      },
      {
        action: 'group_shared',
        projectionKind: 'steps-days.v0',
        projectionScopeKey: 'steps-days.v0',
      },
      { action: 'group_shared', projectionKind: 'private-records.v0' },
      { action: 'group_shared', projectionKind: 'group-email.v0' },
      { action: 'group_shared', projectionScopeKey: 'group-email.v0' },
      { action: 'command', argv: ['vault-cli', 'memory', 'show'] },
    ]) {
      expect(readRequest(request)).toMatchObject({
        kind: 'invalid-scheduled-read-arguments',
      })
    }

    expect(MURPH_SCHEDULED_READ_TOOL.inputSchema).not.toHaveProperty('properties.path')
  })

  it('reads knowledge, memory, canonical search, recent records, and exact records without returning the vault root', async () => {
    const vaultRoot = await makeVaultRoot()
    const memory = await upsertMemory(vaultRoot, {
      section: 'Preferences',
      text: 'Prefers concise weekly summaries.',
    })
    await upsertKnowledgePage({
      body: 'Consistent wake time was associated with steadier morning energy.',
      pageType: 'insight',
      slug: 'weekly-health-insights',
      status: 'active',
      title: 'Weekly health insights',
      vault: vaultRoot,
    })
    await appendJournal({
      date: '2026-07-18',
      text: 'Morning energy was steady after an earlier bedtime.',
      vaultRoot,
    })

    const knowledgeList = await execute(vaultRoot, {
      action: 'knowledge_list',
      limit: 10,
    })
    expect(knowledgeList.success).toBe(true)
    expect(knowledgeList.payload).toMatchObject({
      action: 'knowledge_list',
      pageCount: 1,
      pages: [{ slug: 'weekly-health-insights' }],
    })

    const knowledgeGet = await execute(vaultRoot, {
      action: 'knowledge_get',
      slug: 'weekly-health-insights',
    })
    expect(knowledgeGet.payload).toMatchObject({
      action: 'knowledge_get',
      page: {
        body: expect.stringContaining('steadier morning energy'),
        slug: 'weekly-health-insights',
      },
    })

    const memoryShow = await execute(vaultRoot, {
      action: 'memory_show',
      memoryId: memory.record.id,
    }, memoryMaintenanceAuthority())
    expect(memoryShow.payload).toMatchObject({
      action: 'memory_show',
      document: {
        records: [{
          id: memory.record.id,
          text: 'Prefers concise weekly summaries.',
        }],
      },
      record: { id: memory.record.id },
    })

    const search = await execute(vaultRoot, {
      action: 'search',
      limit: 10,
      query: 'morning energy',
    })
    expect(search.payload).toMatchObject({
      action: 'search',
      result: {
        hits: expect.arrayContaining([
          expect.objectContaining({ recordType: 'journal' }),
        ]),
      },
    })

    const recent = await execute(vaultRoot, {
      action: 'recent_records',
      family: 'journal',
      limit: 10,
    })
    expect(recent.payload).toMatchObject({
      action: 'recent_records',
      count: 1,
      records: [expect.objectContaining({ family: 'journal' })],
    })
    const recentPayload = recent.payload as {
      records: Array<{ entityId: string }>
    }

    const exact = await execute(vaultRoot, {
      action: 'record',
      id: recentPayload.records[0]!.entityId,
    })
    expect(exact.payload).toMatchObject({
      action: 'record',
      record: { entityId: recentPayload.records[0]!.entityId },
    })

    for (const result of [knowledgeList, knowledgeGet, memoryShow, search, recent, exact]) {
      expect(result.text).not.toContain(vaultRoot)
    }
  })

  it('executes the normalized wearable read actions against an empty vault', async () => {
    const vaultRoot = await makeVaultRoot()
    for (const request of [
      { action: 'latest' as const },
      { action: 'metric_latest' as const, metric: 'hrv' },
      { action: 'metric_trend' as const, metric: 'hrv' },
      { action: 'drift' as const },
      { action: 'sources' as const },
    ]) {
      const result = await execute(vaultRoot, request)
      expect(result.success).toBe(true)
      expect(result.payload).toMatchObject({ action: request.action })
      expect(result.text).not.toContain(vaultRoot)
    }
  })

  it('delegates bounded sleep-pattern filters to the provider-neutral query owner', async () => {
    const vaultRoot = await makeVaultRoot()
    await writeSleepPatternFixture(vaultRoot)

    const result = await execute(vaultRoot, {
      action: 'sleep_pattern',
      providers: ['oura'],
      timeZone: 'America/New_York',
      to: '2026-07-10',
      windowDays: 3,
    })

    expect(result).toMatchObject({
      payload: {
        action: 'sleep_pattern',
        summary: {
          expectedNightCount: 3,
          from: '2026-07-08',
          latestNightDate: '2026-07-10',
          providers: ['oura'],
          reportingTimeZone: 'America/New_York',
          reportingTimeZoneSource: 'user_filter',
          to: '2026-07-10',
          validNightCount: 1,
        },
      },
      success: true,
    })
    expect(result.text).not.toContain(vaultRoot)
  })

  it('authorizes sleep-pattern reads for managed knowledge and research tasks', async () => {
    const vaultRoot = await makeVaultRoot()
    for (const authority of [
      {
        automationId: MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
        expectedUpdatedAt: '2026-07-18T00:00:00.000Z',
        kind: 'managed_knowledge_ledger',
        slug: 'weekly-health-insights',
      },
      {
        automationId: MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
        expectedUpdatedAt: '2026-07-18T00:00:00.000Z',
        kind: 'research_ledger',
        slug: 'weekly-health-research-scout',
      },
    ] as const satisfies readonly AssistantScheduledTaskAuthority[]) {
      const assertSourceCurrent = vi.fn(async () =>
        resolveAssistantScheduledTaskAuthority(authority))

      expect(await execute(
        vaultRoot,
        { action: 'sleep_pattern', date: '2026-07-10' },
        authority,
        undefined,
        assertSourceCurrent,
      )).toMatchObject({
        payload: { action: 'sleep_pattern' },
        success: true,
      })
      expect(assertSourceCurrent).toHaveBeenCalledOnce()
      expect(assertSourceCurrent).toHaveBeenCalledWith(authority)
    }
  })

  it('rechecks source authority for sleep-pattern reads without widening group or narrow tasks', async () => {
    const vaultRoot = await makeVaultRoot()
    await writeSleepPatternFixture(vaultRoot)
    const privateAuthority = {
      automationId: 'automation_sleep_review',
      expectedUpdatedAt: '2026-07-18T00:00:00.000Z',
      kind: 'generic_notification' as const,
    }
    const sourceCurrent = vi.fn(async () =>
      resolveAssistantScheduledTaskAuthority(privateAuthority))

    const allowed = await execute(
      vaultRoot,
      { action: 'sleep_pattern', date: '2026-07-10' },
      privateAuthority,
      undefined,
      sourceCurrent,
    )
    expect(allowed.success).toBe(true)
    expect(sourceCurrent).toHaveBeenCalledOnce()

    const changedSource = vi.fn(async () => {
      throw new Error('scheduled source changed')
    })
    const deniedChangedSource = await execute(
      vaultRoot,
      { action: 'sleep_pattern', date: '2026-07-10' },
      privateAuthority,
      undefined,
      changedSource,
    )
    expect(deniedChangedSource).toMatchObject({
      payload: { code: 'scheduled_read_unavailable' },
      success: false,
    })
    expect(changedSource).toHaveBeenCalledOnce()

    const groupRoute = vi.fn(async () => undefined)
    for (const narrowAuthority of [
      groupNotificationAuthority(),
      genericGroupAuthority(),
      memoryMaintenanceAuthority(),
      {
        automationId: 'automation_experiment_lifecycle',
        expectedUpdatedAt: '2026-07-18T00:00:00.000Z',
        kind: 'experiment_lifecycle' as const,
        phase: 'progress' as const,
      },
      groupChallengeAuthority(),
    ]) {
      expect(await execute(
        vaultRoot,
        { action: 'sleep_pattern', date: '2026-07-10' },
        narrowAuthority,
        groupRoute,
      )).toMatchObject({
        payload: { code: 'scheduled_read_action_unauthorized' },
        success: false,
      })
    }
    expect(groupRoute).not.toHaveBeenCalled()
  })

  it('reads one exact bounded group projection only when the parent authorizes it', async () => {
    const vaultRoot = await makeVaultRoot()
    await writeGroupProjectionFixture(vaultRoot)

    const unauthorized = await execute(vaultRoot, {
      action: 'group_shared',
    })
    expect(unauthorized).toMatchObject({
      payload: { code: 'scheduled_read_action_unauthorized' },
      success: false,
    })

    const nonSelectable = await execute(
      vaultRoot,
      { action: 'group_shared' },
      {
        automationId: 'automation_group_challenge',
        expectedUpdatedAt: '2026-07-18T00:00:00.000Z',
        kind: 'group_challenge',
        projectionScopeKey: 'profile-name.v0',
        slug: 'summer-steps',
      },
      async () => undefined,
    )
    expect(nonSelectable).toMatchObject({
      payload: { code: 'scheduled_read_action_unauthorized' },
      success: false,
    })

    const result = await execute(
      vaultRoot,
      {
        action: 'group_shared',
      },
      {
        automationId: 'automation_group_challenge',
        expectedUpdatedAt: '2026-07-18T00:00:00.000Z',
        kind: 'group_challenge',
        projectionScopeKey: 'steps-days.v0',
        slug: 'summer-steps',
      },
      async () => undefined,
    )
    expect(result).toMatchObject({
      payload: {
        action: 'group_shared',
        memberCount: 1,
        members: [{
          displayName: null,
          shares: [{
            projectionKind: 'steps-days.v0',
            projectionScopeKey: 'steps-days.v0',
            records: [{
              data: { metricKey: 'steps', value: 7_000 },
              recordKey: '2026-07-18',
            }],
          }],
        }],
        status: 'ok',
      },
      success: true,
    })
    expect(result.text).not.toContain(vaultRoot)
    expect(result.text).not.toContain('member_a')
    expect(result.text).not.toContain('sleep-duration-days.v0')
  })

  it('reads all consented health projections only for a current typed health-update route', async () => {
    const vaultRoot = await makeVaultRoot()
    await writeGroupProjectionFixture(vaultRoot, { stepRecordCount: 15 })
    const assertCurrentGroupRoute = vi.fn(async () => undefined)
    const authority = genericGroupAuthority()

    const result = await execute(
      vaultRoot,
      { action: 'group_shared' },
      authority,
      assertCurrentGroupRoute,
    )

    expect(result).toMatchObject({
      payload: {
        action: 'group_shared',
        memberCount: 1,
        schema: 'murph.group-health-summary.v1',
        status: 'ok',
      },
      success: true,
    })
    expect(assertCurrentGroupRoute).toHaveBeenCalledTimes(1)
    expect(result.payload).toMatchObject({
      members: [{ shares: [[0, 1], [1, 7], [2, 1]] }],
      metrics: expect.arrayContaining([
        expect.objectContaining({ stream: 'steps' }),
      ]),
      scopes: [
        expect.objectContaining({
          projectionScopeKey: 'sleep-duration-days.v0',
        }),
        expect.objectContaining({ projectionScopeKey: 'steps-days.v0' }),
        expect.objectContaining({
          projectionScopeKey:
            'activity-minutes-days.v1.activityKind.running',
        }),
      ],
    })
    expect(result.text).not.toContain('"recordKey"')
    expect(result.text).not.toContain('opaqueSourceRevision')
    for (const privateValue of [
      'group-email.v0',
      'member_a',
      'share_member_a',
      'event_member_a',
    ]) {
      expect(result.text).not.toContain(privateValue)
    }

    const changedRoute = vi.fn(async () => {
      throw new Error('current group route changed')
    })
    const denied = await execute(
      vaultRoot,
      { action: 'group_shared' },
      genericGroupAuthority(),
      changedRoute,
    )
    expect(denied).toMatchObject({
      payload: { code: 'scheduled_read_unavailable' },
      success: false,
    })
    expect(changedRoute).toHaveBeenCalledTimes(1)

    const missingRouteOwner = await execute(
      vaultRoot,
      { action: 'group_shared' },
      genericGroupAuthority(),
      null,
    )
    expect(missingRouteOwner).toMatchObject({
      payload: { code: 'scheduled_group_route_unavailable' },
      success: false,
    })
  })

  it('summarizes every health scope at maximum admitted group cardinality within the result cap', async () => {
    const vaultRoot = await makeVaultRoot()
    const fixture = await writeMaximumGroupHealthProjectionFixture(vaultRoot)
    const assertSourceCurrent = vi.fn(async () =>
      resolveAssistantScheduledTaskAuthority(genericGroupAuthority()))
    const assertCurrentGroupRoute = vi.fn(async () => undefined)

    const result = await execute(
      vaultRoot,
      { action: 'group_shared' },
      genericGroupAuthority(),
      assertCurrentGroupRoute,
      assertSourceCurrent,
    )

    expect(result.success).toBe(true)
    expect(Buffer.byteLength(result.text, 'utf8')).toBeLessThanOrEqual(256_000)
    expect(assertSourceCurrent).toHaveBeenCalledOnce()
    expect(assertCurrentGroupRoute).toHaveBeenCalledOnce()

    const payload = result.payload as {
      members: Array<{
        displayName: string | null
        shares: Array<[scopeIndex: number, retainedRecordCount: number]>
      }>
      scopes: Array<{ projectionScopeKey: string }>
    }
    expect(payload.scopes.map((scope) => scope.projectionScopeKey)).toEqual(
      fixture.healthScopeKeys,
    )
    expect(payload.members).toHaveLength(fixture.memberIds.length)
    expect(payload.members.map((member) => member.displayName)).toEqual(
      fixture.displayNames,
    )
    for (const member of payload.members) {
      expect(member.shares).toEqual(
        fixture.healthScopeKeys.map((_, scopeIndex) => [
          scopeIndex,
          HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
        ]),
      )
    }
    for (const privateValue of [
      ...fixture.memberIds,
      'private_record_key',
      'private_source_revision',
      'group-email.v0',
    ]) {
      expect(result.text).not.toContain(privateValue)
    }
  })

  it('denies shared projections to typed group notifications', async () => {
    const vaultRoot = await makeVaultRoot()
    await writeGroupProjectionFixture(vaultRoot)
    const assertCurrentGroupRoute = vi.fn(async () => undefined)

    const result = await execute(
      vaultRoot,
      { action: 'group_shared' },
      groupNotificationAuthority(),
      assertCurrentGroupRoute,
    )

    expect(result).toMatchObject({
      payload: { code: 'scheduled_read_action_unauthorized' },
      success: false,
    })
    expect(assertCurrentGroupRoute).not.toHaveBeenCalled()
  })

  it('keeps ordinary knowledge and registered skill reads available to typed group turns', async () => {
    const vaultRoot = await makeVaultRoot()
    await upsertKnowledgePage({
      body: 'Running consistency improved during the current week.',
      pageType: 'insight',
      slug: 'weekly-health-insights',
      status: 'active',
      title: 'Weekly health insights',
      vault: vaultRoot,
    })
    const skillsRoot = await makeTempRoot('murph-scheduled-health-skills-')
    await mkdir(path.join(skillsRoot, 'group-chat'), { recursive: true })
    await writeFile(
      path.join(skillsRoot, 'group-chat', 'SKILL.md'),
      '# Group chat\n\nUse room-owned state only.',
      'utf8',
    )
    process.env[MURPH_ASSISTANT_SKILLS_ROOT_ENV] = skillsRoot

    for (const authority of [
      genericGroupAuthority(),
      groupNotificationAuthority(),
    ]) {
      const knowledge = await execute(vaultRoot, {
        action: 'knowledge_get',
        slug: 'weekly-health-insights',
      }, authority)
      const skill = await execute(vaultRoot, {
        action: 'skill_get',
        slug: 'group-chat',
      }, authority)

      expect(knowledge).toMatchObject({
        payload: {
          action: 'knowledge_get',
          page: {
            body: expect.stringContaining('Running consistency improved'),
            slug: 'weekly-health-insights',
          },
        },
        success: true,
      })
      expect(skill).toMatchObject({
        payload: {
          action: 'skill_get',
          content: '# Group chat\n\nUse room-owned state only.',
          slug: 'group-chat',
        },
        success: true,
      })
    }
  })

  it('projects only exact scheduled-safe group challenge sections', async () => {
    const vaultRoot = await makeVaultRoot()
    const privateMemberId = 'member_private_challenge_participant'
    const privateCaptureRef =
      'raw/captures/2026/07/capture_private_challenge/intro-private.png'
    const privateImageUrl =
      'https://private.example.test/group-challenge/generated-image.png'
    const privateSourcePath = 'bank/private-challenge-source.md'
    await writeFile(
      path.join(vaultRoot, privateSourcePath),
      'Private challenge source.',
      'utf8',
    )
    await upsertKnowledgePage({
      body: [
        '## Rules & metric',
        '',
        'Most daily steps wins over the seven-day window.',
        '',
        '## Roster & intros',
        '',
        `- Private participant (${privateMemberId}); capture: ${privateCaptureRef}`,
        '',
        '## Baselines',
        '',
        '- Casey: 6,400 steps per day.',
        '',
        '## Stakes',
        '',
        'The winner names the closing playlist.',
        '',
        '## Canon',
        '',
        'The stairwell is known as Base Camp.',
        '',
        '## Comedy bank',
        '',
        'A tiny municipal review board audits suspicious elevator use.',
        '',
        '## Sent log',
        '',
        `Saved generated image: ${privateImageUrl}`,
        '',
        '## Prepared dispatch 2026-07-18T13:00:00.000Z',
        '',
        `Private replay ref: ${privateCaptureRef}`,
        '',
        '## Standings snapshots',
        '',
        '- 2026-07-17: Casey 8,200; Morgan 7,900.',
        '',
        '## Confounders & protected notes',
        '',
        'Morgan is traveling and is off-limits for jokes today.',
      ].join('\n'),
      pageType: 'challenge',
      slug: 'summer-steps',
      sourcePaths: [privateSourcePath],
      status: 'active',
      title: `Summer steps ${privateImageUrl}`,
      vault: vaultRoot,
    })

    const result = await execute(
      vaultRoot,
      { action: 'group_challenge_context' },
      groupChallengeAuthority(),
    )

    expect(result).toMatchObject({
      payload: {
        action: 'group_challenge_context',
        sections: {
          baselines: '- Casey: 6,400 steps per day.',
          canon: 'The stairwell is known as Base Camp.',
          comedyBank:
            'A tiny municipal review board audits suspicious elevator use.',
          confoundersAndProtectedNotes:
            'Morgan is traveling and is off-limits for jokes today.',
          rulesAndMetric:
            'Most daily steps wins over the seven-day window.',
          stakes: 'The winner names the closing playlist.',
          standingsSnapshots:
            '- 2026-07-17: Casey 8,200; Morgan 7,900.',
        },
        status: 'active',
      },
      success: true,
    })
    expect(result.payload).not.toHaveProperty('page')
    expect(result.text).not.toContain('Roster & intros')
    expect(result.text).not.toContain('Sent log')
    expect(result.text).not.toContain('Prepared dispatch')
    expect(result.text).not.toContain(privateMemberId)
    expect(result.text).not.toContain(privateCaptureRef)
    expect(result.text).not.toContain(privateImageUrl)
    expect(result.text).not.toContain(privateSourcePath)
    expect(result.text).not.toContain('markdown')
    expect(result.text).not.toContain('pagePath')
    expect(result.text).not.toContain('sourcePaths')
  })

  it('fails closed for inactive or structurally ambiguous challenge context', async () => {
    const vaultRoot = await makeVaultRoot()
    const safeBody = scheduledSafeChallengeBody()
    await upsertKnowledgePage({
      body: safeBody,
      pageType: 'challenge',
      slug: 'paused-steps',
      status: 'paused',
      title: 'Paused steps',
      vault: vaultRoot,
    })
    await upsertKnowledgePage({
      body: safeBody.replace(
        '## Standings snapshots\n\nNo standings yet.',
        '## Canon\n\nDuplicate canon must not be selected.',
      ),
      pageType: 'challenge',
      slug: 'ambiguous-steps',
      status: 'active',
      title: 'Ambiguous steps',
      vault: vaultRoot,
    })

    const inactive = await execute(
      vaultRoot,
      { action: 'group_challenge_context' },
      groupChallengeAuthority('paused-steps'),
    )
    expect(inactive).toMatchObject({
      payload: { code: 'scheduled_challenge_not_active' },
      success: false,
    })

    const ambiguous = await execute(
      vaultRoot,
      { action: 'group_challenge_context' },
      groupChallengeAuthority('ambiguous-steps'),
    )
    expect(ambiguous).toMatchObject({
      payload: { code: 'scheduled_challenge_context_invalid' },
      success: false,
    })
  })

  it.each([
    ['web URL', 'https://private.example.test/challenge'],
    ['bare web URL', 'www.private.example.test/challenge'],
    ['data URL', 'data:image/png;base64,cHJpdmF0ZQ=='],
    ['absolute POSIX path', '/private/tmp/challenge-capture.png'],
    ['relative filesystem path', '../raw/captures/challenge-capture.png'],
    ['vault-relative path', 'raw/captures/challenge-capture.png'],
    ['Windows path', 'C:\\private\\challenge-capture.png'],
    [
      'Markdown link destination',
      '[private capture](captures/challenge-capture.png)',
    ],
    ['hosted member id', 'hbm_abcdefghijklmnop'],
    ['synthetic member id', 'member_private_challenge_participant'],
    ['canonical event id', 'evt_01JNV41B483QH9GQ1Y08D7RMTA'],
    ['UUID ref', '123e4567-e89b-42d3-a456-426614174000'],
    ['SHA-256 ref', 'a'.repeat(64)],
  ])('fails closed when a safe challenge section contains a %s', async (
    _kind,
    forbiddenLocator,
  ) => {
    const vaultRoot = await makeVaultRoot()
    await upsertKnowledgePage({
      body: scheduledSafeChallengeBody().replace(
        'The stairs are Base Camp.',
        `The stairs are Base Camp. ${forbiddenLocator}`,
      ),
      pageType: 'challenge',
      slug: 'summer-steps',
      status: 'active',
      title: 'Summer steps',
      vault: vaultRoot,
    })

    const result = await execute(
      vaultRoot,
      { action: 'group_challenge_context' },
      groupChallengeAuthority(),
    )

    expect(result).toMatchObject({
      payload: { code: 'scheduled_challenge_context_invalid' },
      success: false,
    })
    expect(result.text).not.toContain(forbiddenLocator)
  })

  it('preserves ordinary challenge prose that resembles non-sensitive locators', async () => {
    const vaultRoot = await makeVaultRoot()
    const ordinaryProse = [
      'Data: on 2026-07-18, Casey/Morgan rated the bit 8/10.',
      'Use steps-days.v0 on the America/New_York clock; coach_casey keeps score.',
    ].join('\n')
    await upsertKnowledgePage({
      body: scheduledSafeChallengeBody().replace(
        'The stairs are Base Camp.',
        ordinaryProse,
      ),
      pageType: 'challenge',
      slug: 'summer-steps',
      status: 'active',
      title: 'Summer steps',
      vault: vaultRoot,
    })

    const result = await execute(
      vaultRoot,
      { action: 'group_challenge_context' },
      groupChallengeAuthority(),
    )

    expect(result).toMatchObject({
      payload: {
        sections: { canon: ordinaryProse },
      },
      success: true,
    })
  })

  it('reads only a registered SKILL.md under the resolved skills root', async () => {
    const skillsRoot = await makeTempRoot('murph-scheduled-skills-')
    const outsideRoot = await makeTempRoot('murph-scheduled-skills-outside-')
    await mkdir(path.join(skillsRoot, 'group-chat'), { recursive: true })
    await writeFile(
      path.join(outsideRoot, 'SKILL.md'),
      'outside the configured skills root',
      'utf8',
    )
    await symlink(
      path.join(outsideRoot, 'SKILL.md'),
      path.join(skillsRoot, 'group-chat', 'SKILL.md'),
    )
    process.env[MURPH_ASSISTANT_SKILLS_ROOT_ENV] = skillsRoot

    const escaped = await execute(null, {
      action: 'skill_get',
      slug: 'group-chat',
    })
    expect(escaped).toMatchObject({
      payload: { code: 'scheduled_skill_unavailable' },
      success: false,
    })

    await rm(path.join(skillsRoot, 'group-chat', 'SKILL.md'))
    await writeFile(
      path.join(skillsRoot, 'group-chat', 'SKILL.md'),
      '# Group chat\n\nUse room-owned state only.',
      'utf8',
    )
    const exact = await execute(null, {
      action: 'skill_get',
      slug: 'group-chat',
    })
    expect(exact).toMatchObject({
      payload: {
        action: 'skill_get',
        content: '# Group chat\n\nUse room-owned state only.',
        slug: 'group-chat',
      },
      success: true,
    })
  })

  it('enforces action authorization, parent vault binding, and output bounds', async () => {
    const vaultRoot = await makeVaultRoot()
    const unauthorized = await execute(vaultRoot, {
      action: 'knowledge_list',
    }, memoryMaintenanceAuthority())
    expect(unauthorized).toMatchObject({
      payload: { code: 'scheduled_read_action_unauthorized' },
      success: false,
    })

    const unbound = await execute(
      null,
      { action: 'memory_show' },
      memoryMaintenanceAuthority(),
    )
    expect(unbound).toMatchObject({
      payload: { code: 'scheduled_read_unavailable' },
      success: false,
    })

    await upsertKnowledgePage({
      body: 'x'.repeat(256_000),
      slug: 'oversized-result',
      title: 'Oversized result',
      vault: vaultRoot,
    })
    const oversized = await execute(vaultRoot, {
      action: 'knowledge_get',
      slug: 'oversized-result',
    })
    expect(oversized).toMatchObject({
      payload: { code: 'scheduled_read_result_too_large' },
      success: false,
    })
  })

  it('routes scheduled prompts through the typed read gateway without weakening the interactive route', () => {
    const scheduledInput = createScheduledPromptInput()
    const scheduled = buildAssistantSystemPromptLayers({
      ...scheduledInput,
      onboardingGuidance: false,
      turnTrigger: 'automation-cron',
    })
    expect(scheduled.stableRouteCapabilityPrompt).toContain(
      'Use only `murph.scheduled_read`',
    )
    expect(scheduled.stableRouteCapabilityPrompt).toContain(
      'action `skill_get`',
    )
    const scheduledGroup = buildAssistantSystemPromptLayers({
      ...scheduledInput,
      conversationScope: 'group',
      onboardingGuidance: false,
      turnTrigger: 'automation-cron',
    })
    expect(scheduledGroup.stableRouteCapabilityPrompt).toContain(
      'typed `group_health_update` receives all currently consented',
    )
    expect(scheduled.stableRouteCapabilityPrompt).not.toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT',
    )
    expect(scheduled.stableRouteCapabilityPrompt).not.toContain(
      '`vault-cli show`',
    )
    expect(scheduled.stableRouteCapabilityPrompt).not.toContain(
      'vault-cli commons protocol',
    )

    const interactive = buildAssistantSystemPromptLayers({
      ...scheduledInput,
      onboardingGuidance: false,
      turnTrigger: null,
    })
    expect(interactive.stableRouteCapabilityPrompt).toContain(
      'Use `vault-cli` directly as the canonical Murph runtime surface',
    )
    expect(interactive.stableRouteCapabilityPrompt).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/<slug>/SKILL.md',
    )

    const maintenance = buildAssistantNotificationDecisionSystemPromptLayers({
      ...scheduledInput,
      maintenanceTurn: true,
    })
    expect(maintenance.prompt).toContain(
      '`murph.scheduled_read` with `action: "memory_show"`',
    )
    expect(maintenance.prompt).toContain(
      'Do not call any other scheduled-read action',
    )
    expect(maintenance.prompt).not.toContain('vault-cli memory show')
  })

  it('keeps active managed automation instructions shell-free', () => {
    for (const automation of MURPH_MANAGED_AUTOMATIONS) {
      expect(automation.instructions).not.toContain('vault-cli')
    }
    expect(MURPH_MANAGED_AUTOMATIONS.map((entry) => entry.instructions).join('\n')).toContain(
      'murph.scheduled_read',
    )
  })
})

function readRequest(argumentsValue: unknown): ScheduledReadDynamicToolRequest {
  const request = readScheduledReadDynamicToolRequest({
    arguments: argumentsValue,
    tool: MURPH_SCHEDULED_READ_TOOL.name,
  })
  if (!request) {
    throw new Error('Expected scheduled read request.')
  }
  return request
}

function requireValidRequest(
  argumentsValue: unknown,
): Extract<ScheduledReadDynamicToolRequest, { kind: 'scheduled-read' }> {
  const request = readRequest(argumentsValue)
  if (request.kind !== 'scheduled-read') {
    throw new Error('Expected valid scheduled read request.')
  }
  return request
}

async function execute(
  vaultRoot: string | null,
  argumentsValue: unknown,
  authority: Parameters<typeof executeScheduledReadDynamicTool>[0]['authority'] = {
    automationId: 'automation_scheduled_read_test',
    expectedUpdatedAt: '2026-07-18T00:00:00.000Z',
    kind: 'generic_notification',
  },
  assertCurrentGroupRoute: (() => Promise<void>) | null | undefined = undefined,
  assertSourceCurrent: Parameters<
    typeof executeScheduledReadDynamicTool
  >[0]['assertSourceCurrent'] | undefined = undefined,
): Promise<{ payload: unknown; success: boolean; text: string }> {
  const resolvedAuthority = resolveAssistantScheduledTaskAuthority(authority)
  // Hosted group turns always supply the current-route owner. Positive group
  // fixtures inherit that production context; pass null to test its absence.
  const resolvedCurrentGroupRoute = assertCurrentGroupRoute === undefined && (
    resolvedAuthority.kind === 'group_notification' ||
    resolvedAuthority.kind === 'group_health_update' ||
    resolvedAuthority.kind === 'group_challenge'
  )
    ? async () => undefined
    : assertCurrentGroupRoute ?? null
  const result = await executeScheduledReadDynamicTool({
    assertCurrentGroupRoute: resolvedCurrentGroupRoute,
    assertSourceCurrent: assertSourceCurrent ?? (async () => resolvedAuthority),
    authority,
    request: requireValidRequest(argumentsValue),
    scheduledOccurrenceAt: '2026-07-18T13:00:00.000Z',
    vaultRoot,
  })
  const text = result.rpcResult.contentItems[0]?.text
  if (!text) {
    throw new Error('Expected scheduled read result text.')
  }
  return {
    payload: JSON.parse(text) as unknown,
    success: result.rpcResult.success,
    text,
  }
}

function memoryMaintenanceAuthority(): NonNullable<
  Parameters<typeof executeScheduledReadDynamicTool>[0]['authority']
> {
  return {
    automationId: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
    expectedUpdatedAt: '2026-07-18T00:00:00.000Z',
    kind: 'memory_maintenance',
  }
}

function groupChallengeAuthority(
  slug = 'summer-steps',
): NonNullable<Parameters<typeof executeScheduledReadDynamicTool>[0]['authority']> {
  return {
    automationId: 'automation_group_challenge',
    expectedUpdatedAt: '2026-07-18T00:00:00.000Z',
    kind: 'group_challenge',
    projectionScopeKey: 'steps-days.v0',
    slug,
  }
}

function genericGroupAuthority(): AssistantScheduledTaskAuthority {
  return {
    automationId: 'automation_group_update',
    expectedUpdatedAt: '2026-07-18T00:00:00.000Z',
    kind: 'group_health_update',
  }
}

function groupNotificationAuthority(): AssistantScheduledTaskAuthority {
  return {
    automationId: 'automation_group_notification',
    expectedUpdatedAt: '2026-07-18T00:00:00.000Z',
    kind: 'group_notification',
  }
}

function scheduledSafeChallengeBody(): string {
  return [
    '## Rules & metric',
    '',
    'Daily steps.',
    '',
    '## Baselines',
    '',
    'No baselines yet.',
    '',
    '## Stakes',
    '',
    'Friendly bragging rights.',
    '',
    '## Canon',
    '',
    'The stairs are Base Camp.',
    '',
    '## Comedy bank',
    '',
    'Elevator audit.',
    '',
    '## Standings snapshots',
    '',
    'No standings yet.',
    '',
    '## Confounders & protected notes',
    '',
    'No protected notes.',
  ].join('\n')
}

async function makeVaultRoot(): Promise<string> {
  const root = await makeTempRoot('murph-scheduled-read-')
  await initializeVault({ vaultRoot: root })
  return root
}

async function writeSleepPatternFixture(vaultRoot: string): Promise<void> {
  const eventDirectory = path.join(vaultRoot, 'ledger', 'events', '2026')
  await mkdir(eventDirectory, { recursive: true })
  await writeFile(
    path.join(eventDirectory, '2026-07.jsonl'),
    `${JSON.stringify({
      dayKey: '2026-07-10',
      durationMinutes: 480,
      endAt: '2026-07-10T11:00:00.000Z',
      externalRef: {
        resourceId: 'sleep-runtime-2026-07-10',
        resourceType: 'sleep',
        system: 'oura',
      },
      id: 'evt_sleep_pattern_scheduled_read_01',
      kind: 'sleep_session',
      occurredAt: '2026-07-10T03:00:00.000Z',
      recordedAt: '2026-07-10T11:05:00.000Z',
      schemaVersion: 'murph.event.v1',
      sleepType: 'main_sleep',
      source: 'device',
      startAt: '2026-07-10T03:00:00.000Z',
      title: 'Provider sleep session',
    })}\n`,
    'utf8',
  )
}

async function makeTempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

async function writeGroupProjectionFixture(
  vaultRoot: string,
  input?: { stepRecordCount?: number },
): Promise<void> {
  const projectionDirectory = path.join(vaultRoot, 'derived', 'vault-share')
  await mkdir(projectionDirectory, { recursive: true })
  const stepRecordCount = input?.stepRecordCount ?? 1
  await writeFile(
    path.join(projectionDirectory, 'projections.json'),
    JSON.stringify({
      projections: {
        'activity-minutes-days.v1.activityKind.running': {
          grantors: {
            member_a: {
              grantorMemberId: 'member_a',
              projectionKind: 'activity-minutes-days.v1',
              projectionScope: {
                projectionKind: 'activity-minutes-days.v1',
                selector: { activityKind: 'running' },
              },
              projectionScopeKey:
                'activity-minutes-days.v1.activityKind.running',
              records: [{
                receivedEventId: 'event_member_a_running_minutes',
                record: {
                  data: {
                    activityKind: 'running',
                    date: '2026-07-18',
                    sessionCount: 1,
                    sessionMinutes: 30,
                  },
                  occurredAt: '2026-07-18T00:00:00.000Z',
                  recordKey: '2026-07-18',
                },
                schema: 'murph.vault-share.delivery.v1',
                shareId: 'share_member_a_running_minutes',
              }],
              shareId: 'share_member_a_running_minutes',
              updatedAt: '2026-07-18T12:00:00.000Z',
            },
          },
          projectionScope: {
            projectionKind: 'activity-minutes-days.v1',
            selector: { activityKind: 'running' },
          },
          projectionScopeKey:
            'activity-minutes-days.v1.activityKind.running',
        },
        'steps-days.v0': {
          grantors: {
            member_a: {
              grantorMemberId: 'member_a',
              projectionKind: 'steps-days.v0',
              records: Array.from({ length: stepRecordCount }, (_, index) => {
                const day = stepRecordCount === 1
                  ? '18'
                  : String(index + 1).padStart(2, '0')
                return {
                  receivedEventId: `event_member_a_steps_${index}`,
                  record: {
                    data: {
                      date: `2026-07-${day}`,
                      metricKey: 'steps',
                      unit: 'count',
                      value: 7_000 + index,
                    },
                    occurredAt: `2026-07-${day}T00:00:00.000Z`,
                    recordKey: `2026-07-${day}`,
                    sourceRevision: `opaqueSourceRevision${index}`,
                  },
                  schema: 'murph.vault-share.delivery.v1',
                  shareId: 'share_member_a_steps',
                }
              }),
              shareId: 'share_member_a_steps',
              updatedAt: '2026-07-18T12:00:00.000Z',
            },
          },
        },
        'sleep-duration-days.v0': {
          grantors: {
            member_a: {
              grantorMemberId: 'member_a',
              projectionKind: 'sleep-duration-days.v0',
              records: [{
                receivedEventId: 'event_member_a_sleep',
                record: {
                  data: {
                    date: '2026-07-18',
                    metricKey: 'total-sleep-minutes',
                    unit: 'minutes',
                    value: 480,
                  },
                  occurredAt: '2026-07-18T00:00:00.000Z',
                  recordKey: '2026-07-18',
                },
                schema: 'murph.vault-share.delivery.v1',
                shareId: 'share_member_a_sleep',
              }],
              shareId: 'share_member_a_sleep',
              updatedAt: '2026-07-18T12:00:00.000Z',
            },
          },
        },
      },
      schema: 'murph.shared-vault-projections.v1',
      updatedAt: '2026-07-18T12:00:00.000Z',
    }),
    'utf8',
  )
}

async function writeMaximumGroupHealthProjectionFixture(
  vaultRoot: string,
): Promise<{
  displayNames: string[]
  healthScopeKeys: string[]
  memberIds: string[]
}> {
  const projectionDirectory = path.join(vaultRoot, 'derived', 'vault-share')
  await mkdir(projectionDirectory, { recursive: true })
  const healthScopes = HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES
    .filter((scope) => scope.projectionKind !== 'group-email.v0')
  const healthScopeKeys = healthScopes.map(buildHostedVaultShareProjectionScopeKey)
  const memberIds = Array.from(
    { length: 32 },
    (_, memberIndex) => `private_member_${memberIndex}`,
  )
  const displayNames = memberIds.map((_, memberIndex) =>
    `${String(memberIndex).padStart(2, '0')}${'界'.repeat(
      HOSTED_VAULT_SHARE_PROFILE_NAME_MAX_LENGTH - 2,
    )}`)
  const dates = Array.from(
    { length: HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS },
    (_, dayIndex) => `2026-07-${String(12 + dayIndex).padStart(2, '0')}`,
  )
  const projections: Record<string, {
    grantors: Record<string, object>
    projectionScope: HostedVaultShareProjectionScope
    projectionScopeKey: string
  }> = {}

  const profileNameProjectionScope = {
    projectionKind: 'profile-name.v0',
  } as const satisfies HostedVaultShareProjectionScope
  const profileNameProjectionScopeKey =
    buildHostedVaultShareProjectionScopeKey(profileNameProjectionScope)
  projections[profileNameProjectionScopeKey] = {
    grantors: Object.fromEntries(memberIds.map((memberId, memberIndex) => [
      memberId,
      {
        grantorMemberId: memberId,
        projectionKind: profileNameProjectionScope.projectionKind,
        projectionScope: profileNameProjectionScope,
        projectionScopeKey: profileNameProjectionScopeKey,
        records: [{
          receivedEventId: `private_name_event_${memberIndex}`,
          record: {
            data: { displayName: displayNames[memberIndex]! },
            occurredAt: '2026-07-18T00:00:00.000Z',
            recordKey: HOSTED_VAULT_SHARE_PROFILE_NAME_RECORD_KEY,
            sourceRevision: 'private_name_source_revision',
          },
          schema: 'murph.vault-share.delivery.v1',
          shareId: `private_name_share_${memberIndex}`,
        }],
        shareId: `private_name_share_${memberIndex}`,
        updatedAt: '2026-07-18T12:00:00.000Z',
      },
    ])),
    projectionScope: profileNameProjectionScope,
    projectionScopeKey: profileNameProjectionScopeKey,
  }

  for (const [scopeIndex, projectionScope] of healthScopes.entries()) {
    const projectionScopeKey = healthScopeKeys[scopeIndex]!
    const grantors: Record<string, object> = {}
    for (const [memberIndex, memberId] of memberIds.entries()) {
      grantors[memberId] = {
        grantorMemberId: memberId,
        projectionKind: projectionScope.projectionKind,
        projectionScope,
        projectionScopeKey,
        records: dates.map((date, recordIndex) => ({
          receivedEventId: `private_event_${memberIndex}_${scopeIndex}_${recordIndex}`,
          record: {
            data: buildMaximumGroupHealthRecordData({ date, projectionScope }),
            occurredAt: `${date}T00:00:00.000Z`,
            recordKey: date,
            sourceRevision: 'private_source_revision',
          },
          schema: 'murph.vault-share.delivery.v1',
          shareId: `private_share_${memberIndex}_${scopeIndex}`,
        })),
        shareId: `private_share_${memberIndex}_${scopeIndex}`,
        updatedAt: '2026-07-18T12:00:00.000Z',
      }
    }
    projections[projectionScopeKey] = {
      grantors,
      projectionScope,
      projectionScopeKey,
    }
  }

  await writeFile(
    path.join(projectionDirectory, 'projections.json'),
    JSON.stringify({
      projections,
      schema: 'murph.shared-vault-projections.v1',
      updatedAt: '2026-07-18T12:00:00.000Z',
    }),
    'utf8',
  )
  return { displayNames, healthScopeKeys, memberIds }
}

function buildMaximumGroupHealthRecordData(input: {
  date: string
  projectionScope: HostedVaultShareProjectionScope
}): HostedVaultShareDeliveryRecordData {
  const dailyMetric = getHostedVaultShareDailyMetricProjectionSpec(
    input.projectionScope.projectionKind,
  )
  if (dailyMetric) {
    return {
      date: input.date,
      metricKey: dailyMetric.metricKey,
      unit: 'unit',
      value: dailyMetric.minValue,
    }
  }

  switch (input.projectionScope.projectionKind) {
    case 'sleep-times.v0':
      return {
        date: input.date,
        sleepEndAt: `${input.date}T08:00:00.000Z`,
        sleepStartAt: `${input.date}T00:00:00.000Z`,
      }
    case 'workout-days.v0':
      return { date: input.date, workoutCount: 1, workoutMinutes: 30 }
    case 'heart-rate-zones-days.v0':
      return {
        date: input.date,
        zones: Array.from({ length: 20 }, (_, zone) => ({
          durationMinutes: 1,
          zone: zone + 1,
        })),
      }
    case 'activity-minutes-days.v1':
      return {
        activityKind: input.projectionScope.selector.activityKind,
        date: input.date,
        sessionCount: 1,
        sessionMinutes: 30,
      }
    case 'activity-distance-days.v1':
      return {
        activityKind: input.projectionScope.selector.activityKind,
        date: input.date,
        sessionCount: 1,
        sessionDistanceMeters: 1_000,
      }
    case 'activity-session-count-days.v1':
      return {
        activityKind: input.projectionScope.selector.activityKind,
        date: input.date,
        sessionCount: 1,
      }
    case 'group-email.v0':
    case 'profile-name.v0':
      throw new Error('Non-health scopes are not part of the maximum health fixture.')
    default:
      throw new Error('Unsupported maximum health fixture scope.')
  }
}

function createScheduledPromptInput(): AssistantNotificationDecisionSystemPromptInput {
  return {
    assistantCliContract: 'Interactive CLI contract.',
    assistantContextSnapshotPrompt: 'Context snapshot.',
    assistantDynamicContextPrompts: [],
    assistantHostedAutomationAvailable: false,
    assistantHostedDeviceConnectAvailable: false,
    assistantHostedDeviceConnectProviders: [],
    assistantHostedLabsAvailable: false,
    assistantKnowledgeToolsAvailable: true,
    assistantPersonality: null,
    assistantStyleSettingsAvailable: false,
    assistantTone: 'casual',
    channel: 'linq',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    conversationScope: 'direct',
    currentLocalDate: '2026-07-18',
    currentTimeZone: 'America/New_York',
    hostedRuntime: true,
    modelBehaviorProfile: 'gpt5-agentic',
    murphProductBaseUrl: 'https://withmurph.ai',
    scheduledOccurrenceAt: '2026-07-18T13:00:00.000Z',
  }
}
