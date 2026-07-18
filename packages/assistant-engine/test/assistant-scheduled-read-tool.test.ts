import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  appendJournal,
  initializeVault,
  upsertMemory,
} from '@murphai/core'

import {
  MURPH_ASSISTANT_SKILLS_ROOT_ENV,
} from '../src/assistant-skill-assets.js'
import {
  MURPH_MANAGED_AUTOMATIONS,
  MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
} from '../src/assistant/managed-automations.js'
import {
  resolveAssistantScheduledTaskAuthority,
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
): Promise<{ payload: unknown; success: boolean; text: string }> {
  const resolvedAuthority = resolveAssistantScheduledTaskAuthority(authority)
  const result = await executeScheduledReadDynamicTool({
    assertSourceCurrent: async () => resolvedAuthority,
    authority,
    request: requireValidRequest(argumentsValue),
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

async function makeTempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

async function writeGroupProjectionFixture(vaultRoot: string): Promise<void> {
  const projectionDirectory = path.join(vaultRoot, 'derived', 'vault-share')
  await mkdir(projectionDirectory, { recursive: true })
  await writeFile(
    path.join(projectionDirectory, 'projections.json'),
    JSON.stringify({
      projections: {
        'steps-days.v0': {
          grantors: {
            member_a: {
              grantorMemberId: 'member_a',
              projectionKind: 'steps-days.v0',
              records: [{
                receivedEventId: 'event_member_a_steps',
                record: {
                  data: {
                    date: '2026-07-18',
                    metricKey: 'steps',
                    unit: 'count',
                    value: 7_000,
                  },
                  occurredAt: '2026-07-18T00:00:00.000Z',
                  recordKey: '2026-07-18',
                },
                schema: 'murph.vault-share.delivery.v1',
                shareId: 'share_member_a_steps',
              }],
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
