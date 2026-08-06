from pathlib import Path

path = Path('packages/assistant-engine/test/managed-automations.test.ts')
source = path.read_text()


def replace_required(before: str, after: str, label: str) -> None:
    global source
    if before not in source:
        raise RuntimeError(f'Missing {label}')
    source = source.replace(before, after, 1)


def replace_between(
    start_marker: str,
    end_marker: str,
    replacement: str,
    label: str,
) -> None:
    global source
    start = source.find(start_marker)
    if start < 0:
        raise RuntimeError(f'Missing {label} start')
    end = source.find(end_marker, start)
    if end < 0:
        raise RuntimeError(f'Missing {label} end')
    source = source[:start] + replacement.rstrip() + source[end:]


def replace_test(name: str, replacement: str) -> None:
    global source
    marker = f"  it('{name}',"
    start = source.find(marker)
    if start < 0:
        raise RuntimeError(f'Missing test: {name}')
    next_start = source.find('\n  it(', start + len(marker))
    end = next_start if next_start >= 0 else source.rfind('\n})')
    if end < 0:
        raise RuntimeError(f'Could not find end of test: {name}')
    source = source[:start] + replacement.rstrip() + '\n' + source[end:]


helper = '''
function expectManagedAutomationSkillReference(
  instructions: string | null | undefined,
  slug: string,
): void {
  expect(instructions).toContain(
    `$MURPH_ASSISTANT_SKILLS_ROOT/${slug}/SKILL.md`,
  )
  expect(instructions).toContain('cannot change this automation')
}
'''.strip()
anchor = '\n\nbeforeEach(() => {'
if helper not in source:
    replace_required(anchor, f'\n\n{helper}{anchor}', 'beforeEach helper anchor')

replace_test(
    'keeps the managed weekly health insight seed as the baseline Sunday noon recurrence',
    '''
  it('keeps the managed weekly health insight seed as the baseline Sunday noon recurrence', () => {
    const insightSeed = MURPH_MANAGED_AUTOMATIONS.find(
      (seed) => seed.automationId === MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
    )
    if (!insightSeed || insightSeed.schedule.kind !== 'cron') {
      throw new Error('Expected the weekly health insight to use a cron schedule.')
    }

    expect(insightSeed.schedule.expression).toBe('0 12 * * 0')
    expectManagedAutomationSkillReference(
      insightSeed.instructions,
      'weekly-health-insight',
    )
    expect(insightSeed.instructions).not.toContain('Interestingness gate')
    expect(insightSeed.assistantTargetOverride).toEqual({
      reasoningEffort: 'high',
    })

    const nextRunAt = findNextAssistantCronOccurrence(
      insightSeed.schedule.expression,
      new Date('2026-06-18T16:00:00.000Z'),
      'America/New_York',
    )
    expect(nextRunAt).toBe('2026-06-21T16:00:00.000Z')
    if (!nextRunAt) {
      throw new Error('Expected the weekly health insight cron to have a next run.')
    }
    expect(findNextAssistantCronOccurrence(
      insightSeed.schedule.expression,
      new Date(nextRunAt),
      'America/New_York',
    )).toBe('2026-06-28T16:00:00.000Z')
  })
''',
)

replace_test(
    'keeps the managed monthly improvement coach seed on the first day of each month',
    '''
  it('keeps the managed monthly improvement coach seed on the first day of each month', () => {
    const seed = MURPH_MANAGED_AUTOMATIONS.find(
      (entry) => entry.automationId === MURPH_MONTHLY_IMPROVEMENT_COACH_AUTOMATION_ID,
    )
    if (!seed || seed.schedule.kind !== 'cron') {
      throw new Error('Expected the monthly improvement coach to use a cron schedule.')
    }

    expect(seed.schedule.expression).toBe('0 17 1 * *')
    expect(seed.slug).toBe('monthly-improvement-coach')
    expect(seed.title).toBe('Monthly improvement coach')
    expect(seed.summary).toBe(
      'A monthly check for one user-relevant health friction worth offering help with.',
    )
    expect(seed.assistantTargetOverride).toEqual({
      reasoningEffort: 'high',
    })
    expect(seed.tags).toContain('murph-managed:monthly-improvement-coach')
    expect(seed.tags).not.toContain(ASSISTANT_REQUIRE_SEND_AUTOMATION_TAG)
    expectManagedAutomationSkillReference(
      seed.instructions,
      'monthly-improvement-coach',
    )
    expect(seed.instructions).not.toContain(
      'Every completed run must leave one compact private decision record',
    )

    const nextRunAt = findNextAssistantCronOccurrence(
      seed.schedule.expression,
      new Date('2026-06-18T16:00:00.000Z'),
      'America/New_York',
    )
    expect(nextRunAt).toBe('2026-07-01T21:00:00.000Z')
    if (!nextRunAt) {
      throw new Error('Expected the monthly improvement coach cron to have a next run.')
    }
    expect(findNextAssistantCronOccurrence(
      seed.schedule.expression,
      new Date(nextRunAt),
      'America/New_York',
    )).toBe('2026-08-01T21:00:00.000Z')
  })
''',
)

replace_test(
    'keeps the managed weekly health research scout seed as the baseline Wednesday evening recurrence',
    '''
  it('keeps the managed weekly health research scout seed as the baseline Wednesday evening recurrence', () => {
    const researchScoutSeed = MURPH_MANAGED_AUTOMATIONS.find(
      (seed) => seed.automationId === MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
    )
    if (!researchScoutSeed || researchScoutSeed.schedule.kind !== 'cron') {
      throw new Error('Expected the weekly health research scout to use a cron schedule.')
    }

    expect(researchScoutSeed.schedule.expression).toBe('30 19 * * 3')
    expect(researchScoutSeed.assistantTargetOverride).toEqual({
      reasoningEffort: 'high',
    })
    expectManagedAutomationSkillReference(
      researchScoutSeed.instructions,
      'weekly-health-research-scout',
    )
    expect(researchScoutSeed.instructions).not.toContain('Hard provenance gate')

    const nextRunAt = findNextAssistantCronOccurrence(
      researchScoutSeed.schedule.expression,
      new Date('2026-06-18T16:00:00.000Z'),
      'America/New_York',
    )
    expect(nextRunAt).toBe('2026-06-24T23:30:00.000Z')
    if (!nextRunAt) {
      throw new Error('Expected the weekly health research scout cron to have a next run.')
    }
    expect(findNextAssistantCronOccurrence(
      researchScoutSeed.schedule.expression,
      new Date(nextRunAt),
      'America/New_York',
    )).toBe('2026-07-01T23:30:00.000Z')
  })
''',
)

replace_between(
    "    expect(digestRecord?.instructions).toContain('still remember ten seconds after reading')",
    '\n\n    const insightRecord = managedAutomationMocks.records.get(',
    '''
    expectManagedAutomationSkillReference(
      digestRecord?.instructions,
      'weekly-health-digest',
    )
    expect(digestRecord?.instructions).not.toContain(
      'still remember ten seconds after reading',
    )''',
    'fresh-vault digest policy assertions',
)
replace_between(
    "    expect(insightRecord?.instructions).toContain('On this scheduled weekly run')",
    '\n\n    const improvementCoachRecord = managedAutomationMocks.records.get(',
    '''
    expectManagedAutomationSkillReference(
      insightRecord?.instructions,
      'weekly-health-insight',
    )
    expect(insightRecord?.instructions).not.toContain('Interestingness gate')''',
    'fresh-vault insight policy assertions',
)
replace_between(
    "    expect(improvementCoachRecord?.instructions).toContain(\n      'An official weather alert alone never clears the proactive send bar',\n    )",
    '\n\n    const researchScoutRecord = managedAutomationMocks.records.get(',
    '''
    expectManagedAutomationSkillReference(
      improvementCoachRecord?.instructions,
      'monthly-improvement-coach',
    )
    expect(improvementCoachRecord?.instructions).not.toContain(
      'Every completed run must leave one compact private decision record',
    )''',
    'fresh-vault improvement policy assertions',
)
replace_between(
    "    expect(researchScoutRecord?.instructions).toContain('On this scheduled weekly run')",
    '\n\n    const productUpdatesRecord = managedAutomationMocks.records.get(',
    '''
    expectManagedAutomationSkillReference(
      researchScoutRecord?.instructions,
      'weekly-health-research-scout',
    )
    expect(researchScoutRecord?.instructions).not.toContain(
      'Hard provenance gate',
    )''',
    'fresh-vault research policy assertions',
)

replace_test(
    'updates existing research-oriented automations without rewriting their cadence',
    '''
  it('updates existing research-oriented automations without rewriting their cadence', async () => {
    managedAutomationMocks.records.set(MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID, {
      automationId: MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
      continuityPolicy: 'preserve',
      instructions: 'Each Friday at 2:30 PM local time, find one old finding.',
      route: defaultRoute,
      schedule: {
        kind: 'cron',
        expression: '30 14 * * 5',
      },
      slug: 'weekly-health-insight',
      status: 'active',
      summary: 'Old weekly insight.',
      tags: ['assistant', 'scheduled', 'murph-managed'],
      title: 'Weekly health insight',
    })
    managedAutomationMocks.records.set(MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID, {
      automationId: MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
      continuityPolicy: 'preserve',
      instructions: 'Each Friday morning, produce an old research scout.',
      route: defaultRoute,
      schedule: {
        kind: 'cron',
        expression: '0 11 * * 5',
      },
      slug: 'weekly-health-research-scout',
      status: 'active',
      summary: 'Old weekly research scout.',
      tags: ['assistant', 'scheduled', 'murph-managed'],
      title: 'Weekly health research scout',
    })

    const result = await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-20T12:00:00.000Z'),
      vaultRoot,
    })

    expect(result).toEqual({
      created: 3,
      skipped: 0,
      updated: 2,
    })
    const insightRecord = managedAutomationMocks.records.get(
      MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
    )
    expect(insightRecord).toEqual(expect.objectContaining({
      schedule: {
        kind: 'cron',
        expression: '30 14 * * 5',
      },
    }))
    expectManagedAutomationSkillReference(
      insightRecord?.instructions,
      'weekly-health-insight',
    )
    expect(insightRecord?.instructions).not.toContain(
      'Each Friday at 2:30 PM local time',
    )

    const researchScoutRecord = managedAutomationMocks.records.get(
      MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
    )
    expect(researchScoutRecord).toEqual(expect.objectContaining({
      schedule: {
        kind: 'cron',
        expression: '0 11 * * 5',
      },
    }))
    expectManagedAutomationSkillReference(
      researchScoutRecord?.instructions,
      'weekly-health-research-scout',
    )
    expect(researchScoutRecord?.instructions).not.toContain(
      'Each Friday morning',
    )
  })
''',
)

replace_between(
    "    expect(digestRecord?.instructions).toContain('On this scheduled weekly run')",
    "\n    expect(digestRecord?.instructions).not.toContain('OLD weekly digest instructions')",
    '''
    expectManagedAutomationSkillReference(
      digestRecord?.instructions,
      'weekly-health-digest',
    )''',
    'require-send digest policy assertions',
)

replace_between(
    '    expect(managedAutomationMocks.records.get(MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID))\n      .toEqual(expect.objectContaining({\n        instructions: expect.stringContaining(\'On this scheduled weekly run\'),',
    '\n  })\n\n  it(\'does not overwrite a queued device activity occurrence payload\'',
    '''
    const record = managedAutomationMocks.records.get(
      MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
    )
    expect(record).toEqual(expect.objectContaining({
      schedule: deviceActivitySchedule,
    }))
    expectManagedAutomationSkillReference(
      record?.instructions,
      'weekly-health-insight',
    )''',
    'device-activity policy assertion',
)

replace_between(
    '    expect(managedAutomationMocks.records.get(MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID))\n      .toEqual(expect.objectContaining({\n        instructions: expect.stringContaining(\'On this scheduled weekly run\'),',
    '\n    expect(managedAutomationMocks.records.get(experimentSeed.automationId))',
    '''
    const digestRecord = managedAutomationMocks.records.get(
      MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
    )
    expect(digestRecord).toEqual(expect.objectContaining({
      schedule: existingDigestSchedule,
    }))
    expectManagedAutomationSkillReference(
      digestRecord?.instructions,
      'weekly-health-digest',
    )''',
    'stable-key digest policy assertion',
)

if 'On this scheduled weekly run' in source:
    raise RuntimeError('Stale inline managed-automation prose remains')
expected_counts = {
    'still remember ten seconds after reading': 1,
    'Interestingness gate': 2,
    'Every completed run must leave one compact private decision record': 2,
    'Hard provenance gate': 2,
}
for phrase, expected_count in expected_counts.items():
    count = source.count(phrase)
    if count != expected_count:
        raise RuntimeError(
            f'Expected {expected_count} negative assertions for {phrase!r}, found {count}'
        )

path.write_text(source)
