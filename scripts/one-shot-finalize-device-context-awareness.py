from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


source_path = Path("packages/assistant-engine/src/assistant/context-snapshot.ts")
source = source_path.read_text()
source = replace_once(
    source,
    '''const ASSISTANT_CONTEXT_DEVICE_METRIC_FILTERS = [
  { metricKey: 'body-fat-percentage', limit: 1 },
  { metricKey: 'body-weight', limit: 1 },
  { metricKey: 'diastolic-blood-pressure', limit: 1 },
  { metricKey: 'systolic-blood-pressure', limit: 1 },
] as const
const ASSISTANT_CONTEXT_BODY_METRIC_KEYS = new Set([
  'body-fat-percentage',
  'body-weight',
])
''',
    '''const ASSISTANT_CONTEXT_BLOOD_PRESSURE_PAIR_LIMIT = 100
const ASSISTANT_CONTEXT_DEVICE_METRIC_FILTERS = [
  { metricKey: 'bmi', limit: 1 },
  { metricKey: 'body-fat-percentage', limit: 1 },
  { metricKey: 'body-weight', limit: 1 },
  {
    metricKey: 'diastolic-blood-pressure',
    limit: ASSISTANT_CONTEXT_BLOOD_PRESSURE_PAIR_LIMIT,
  },
  {
    metricKey: 'systolic-blood-pressure',
    limit: ASSISTANT_CONTEXT_BLOOD_PRESSURE_PAIR_LIMIT,
  },
  { metricKey: 'waist-circumference', limit: 1 },
] as const
const ASSISTANT_CONTEXT_BODY_METRIC_KEYS = new Set([
  'bmi',
  'body-fat-percentage',
  'body-weight',
  'waist-circumference',
])
''',
    "device metric filters",
)
source = replace_once(
    source,
    '''    latestBloodPressureMeasurementDate: latestAssistantSnapshotMetricDate(
      points,
      ASSISTANT_CONTEXT_BLOOD_PRESSURE_METRIC_KEYS,
    ),
''',
    '''    latestBloodPressureMeasurementDate:
      latestAssistantSnapshotPairedBloodPressureDate(points),
''',
    "paired blood-pressure coverage call",
)
helper_anchor = '''function latestAssistantSnapshotMetricDate(
'''
helper = '''function latestAssistantSnapshotPairedBloodPressureDate(
  points: Awaited<ReturnType<typeof listMetricPointsBatch>>,
): string | null {
  const systolicMeasurementEvents = new Set(
    points
      .filter((point) => point.metricKey === 'systolic-blood-pressure')
      .map(assistantSnapshotMeasurementEventKey)
      .filter((key): key is string => key !== null),
  )

  return points
    .filter((point) => point.metricKey === 'diastolic-blood-pressure')
    .filter((point) => {
      const eventKey = assistantSnapshotMeasurementEventKey(point)
      return eventKey !== null && systolicMeasurementEvents.has(eventKey)
    })
    .map((point) => point.effectiveDate)
    .filter(isStrictIsoDate)
    .sort((left, right) => right.localeCompare(left))[0]
    ?? null
}

function assistantSnapshotMeasurementEventKey(
  point: Awaited<ReturnType<typeof listMetricPointsBatch>>[number],
): string | null {
  if (
    point.source.family !== 'event'
    || point.source.kind !== 'measurement'
    || point.source.recordId.length === 0
  ) {
    return null
  }

  return JSON.stringify([point.source.path, point.source.recordId])
}

'''
source = replace_once(
    source,
    helper_anchor,
    helper + helper_anchor,
    "paired blood-pressure helper",
)
source_path.write_text(source)

snapshot_test_path = Path(
    "packages/assistant-engine/test/assistant-context-snapshot-device-availability.test.ts"
)
snapshot_test = snapshot_test_path.read_text()
insert_anchor = '''  it('rebuilds snapshots written with the previous schema version', async () => {
'''
new_test = '''  it('recognizes broader body history but requires paired blood pressure from one event', async () => {
    const parentRoot = await mkdtemp(
      path.join(tmpdir(), 'assistant-device-context-pairing-'),
    )
    const vaultRoot = path.join(parentRoot, 'vault')

    try {
      await initializeVault({
        createdAt: '2026-08-09T00:00:00.000Z',
        vaultRoot,
      })
      await addMeasurement({
        vaultRoot,
        draft: {
          occurredAt: '2026-08-09T09:00:00.000Z',
          source: 'device',
          title: 'Connected body measurement',
          measurements: [{
            metric: 'bmi',
            unit: 'kg/m2',
            value: 21.7,
          }],
        },
      })
      await addMeasurement({
        vaultRoot,
        draft: {
          occurredAt: '2026-08-09T09:05:00.000Z',
          source: 'device',
          title: 'Incomplete systolic reading',
          measurements: [{
            metric: 'systolic-blood-pressure',
            unit: 'mmHg',
            value: 120,
          }],
        },
      })
      await addMeasurement({
        vaultRoot,
        draft: {
          occurredAt: '2026-08-09T09:05:00.000Z',
          source: 'device',
          title: 'Incomplete diastolic reading',
          measurements: [{
            metric: 'diastolic-blood-pressure',
            unit: 'mmHg',
            value: 78,
          }],
        },
      })
      await markAssistantContextSnapshotDirty({
        domains: ['blood_tests'],
        vaultRoot,
      })
      await refreshAssistantContextSnapshot({
        now: () => '2026-08-09T09:10:00.000Z',
        vaultRoot,
      })

      const prompt = await readAssistantContextSnapshotPrompt({ vaultRoot })
      expect(prompt).toContain(
        'Body/scale measurement history is present (latest 2026-08-09)',
      )
      expect(prompt).not.toContain(
        'Blood-pressure measurement history is present',
      )
      expect(prompt).not.toContain('21.7')
      expect(prompt).not.toContain('120')
      expect(prompt).not.toContain('78')
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      })
    }
  })

'''
snapshot_test = replace_once(
    snapshot_test,
    insert_anchor,
    new_test + insert_anchor,
    "unpaired blood-pressure regression test",
)
snapshot_test_path.write_text(snapshot_test)

canonical_test_path = Path(
    "packages/vault-usecases/test/junction-scale-blood-pressure-canonicalization.test.ts"
)
canonical_test = canonical_test_path.read_text()
canonical_test = replace_once(
    canonical_test,
    '''    expect(systolic?.source.recordId).toBe(diastolic?.source.recordId)
''',
    '''    expect(systolic?.source).toMatchObject({
      family: 'event',
      kind: 'measurement',
    })
    expect(diastolic?.source).toMatchObject({
      family: 'event',
      kind: 'measurement',
    })
    expect(systolic?.source.recordId).toBe(diastolic?.source.recordId)
''',
    "canonical measurement source proof",
)
canonical_test_path.write_text(canonical_test)
