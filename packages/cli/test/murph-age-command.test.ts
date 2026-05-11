import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Cli } from 'incur'
import { test } from 'vitest'
import { CURRENT_VAULT_FORMAT_VERSION } from '@murphai/contracts'
import {
  METRIC_POINT_SCHEMA_VERSION,
  MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
  normalizeMetricValue,
  type MetricPoint,
  type MurphAgePublicCalculatorReport,
  type MurphAgeRiskModel,
} from '@murphai/health-metrics'
import {
  defaultMurphAgeModelCardArtifactRoot,
  rebuildQueryProjection,
} from '@murphai/query'
import { QUERY_DB_RELATIVE_PATH, openSqliteRuntimeDatabase } from '@murphai/runtime-state/node'
import {
  createIntegratedVaultServices,
  createUnwiredVaultServices,
} from '@murphai/vault-usecases'
import { registerBloodTestCommands } from '../src/commands/health-blood-test-save.js'
import { registerEventCommands } from '../src/commands/event.js'
import { registerMeasurementCommands } from '../src/commands/measurement.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import { registerMurphAgeCommands } from '../src/commands/murph-age.js'
import { registerVaultCommands } from '../src/commands/vault.js'
import type { CliEnvelope } from './cli-test-helpers.js'
import {
  createTempVaultContext,
  requireData,
  runInProcessJsonCli,
} from './cli-test-helpers.js'

function createSliceCli() {
  const cli = Cli.create('vault-cli', {
    description: 'Murph Age command slice test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  registerMurphAgeCommands(cli, createUnwiredVaultServices())
  return cli
}

function createCanonicalInputCli() {
  const cli = Cli.create('vault-cli', {
    description: 'Murph Age canonical input test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)

  const services = createIntegratedVaultServices()
  registerVaultCommands(cli, services)
  registerBloodTestCommands(cli, services)
  registerEventCommands(cli, services)
  registerMeasurementCommands(cli, services)
  registerMurphAgeCommands(cli, services)
  return cli
}

async function runSliceCli<TData>(args: string[]): Promise<CliEnvelope<TData>> {
  return (await runSliceCliResult<TData>(args)).envelope
}

async function runSliceCliResult<TData>(args: string[]): Promise<{
  envelope: CliEnvelope<TData>
  exitCode: number | null
}> {
  const cli = createSliceCli()
  let exitCode: number | null = null
  const output: string[] = []

  await cli.serve([...args, '--full-output', '--format', 'json'], {
    env: process.env,
    exit(code) {
      exitCode = code
    },
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return {
    envelope: JSON.parse(output.join('').trim()) as CliEnvelope<TData>,
    exitCode,
  }
}

interface MurphAgeModelCardStatusReport {
  loadedCardIds: string[]
  policies: Array<{
    blockers: string[]
    cardId: string
    loaded: boolean
    outcomeContext: {
      ageEstimateBasis: string
      horizonYears: number | null
      riskEndpoint: string
    }
    productAgeReady: boolean
    productPromotionBlockers: string[]
    productRiskReady: boolean
    researchUsable: boolean
    scoreBearing: boolean
    validationGate: {
      evidenceTiers: string[]
      productPromotionEvidence: boolean
      status: string
    }
    wearableScoreBearingAuthorized: boolean
  }>
  productReadyCardIds: string[]
  researchReadyCardIds: string[]
  schemaVersion: string
  warnings: Array<{ code: string }>
}

interface MurphAgeInputReadinessReport {
  bundle: {
    availableFeatureKeys: string[]
    bundleId: string
    featureStatuses: Array<{
      featureKey: string
      metricKeys: string[]
      selectedMetricKey: string | null
      status: string
    }>
    missingFeatureKeys: string[]
    recommendedCardId: string
    selectedMetricKeys: string[]
    status: string
    warnings: Array<{ code: string }>
  }
  contextBundles: Array<{
    bundleId: string
    featureStatuses: Array<{
      featureKey: string
      selectedMetricKey: string | null
      status: string
    }>
    selectedMetricKeys: string[]
    status: string
  }>
  runtimeInputs: Array<{
    key: string
    label: string
    required: true
    source: string
    status: string
  }>
  schemaVersion: string
}

test('age model-cards reports local research readiness without model internals', async () => {
  const vaultRoot = await createProjectionVault()
  try {
    await writeLocalModelCardArtifact(vaultRoot, 'lab9.json', {
      cardId: 'lab9_bp_body_10y_acm_research',
      model: fixtureLab9ResearchModel(),
      schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
    })

    const status = requireData(await runSliceCli<MurphAgeModelCardStatusReport>([
      'age',
      'model-cards',
      '--vault',
      vaultRoot,
    ]))

    assert.equal(status.schemaVersion, 'murph.age.model-card-status.v2')
    assert.deepEqual(status.loadedCardIds, ['lab9_bp_body_10y_acm_research'])
    assert.deepEqual(status.researchReadyCardIds, ['lab9_bp_body_10y_acm_research'])
    assert.deepEqual(status.productReadyCardIds, [])
    assert.deepEqual(status.warnings, [])

    const lab9 = requirePolicyStatus(status, 'lab9_bp_body_10y_acm_research')
    assert.equal(lab9.loaded, true)
    assert.equal(lab9.researchUsable, true)
    assert.equal(lab9.productRiskReady, false)
    assert.equal(lab9.productAgeReady, false)
    assert.equal(lab9.scoreBearing, true)
    assert.deepEqual(lab9.outcomeContext, {
      ageEstimateBasis: 'risk-age-equivalent',
      horizonYears: 10,
      riskEndpoint: 'all-cause-mortality',
    })
    assert.equal(lab9.validationGate.status, 'blocked')
    assert.equal(lab9.validationGate.evidenceTiers.includes('internal-anchor'), true)
    assert.equal(lab9.validationGate.productPromotionEvidence, false)
    assert.deepEqual(lab9.productPromotionBlockers, [
      'PRODUCT_POLICY_NOT_AUTHORIZED',
      'VALIDATION_GATE_BLOCKED',
      'PRODUCT_PROMOTION_EVIDENCE_MISSING',
      'PRODUCT_PROMOTION_EVIDENCE_TIER_MISSING',
      'RISK_TO_AGE_DISPLAY_NOT_AUTHORIZED',
    ])
    assert.equal(lab9.blockers.includes('PRODUCT_NOT_AUTHORIZED'), true)
    assert.equal(lab9.blockers.includes('RISK_TO_AGE_NOT_AUTHORIZED'), true)

    const wearableContext = requirePolicyStatus(status, 'wearable_context_no_risk')
    assert.equal(wearableContext.loaded, false)
    assert.equal(wearableContext.researchUsable, false)
    assert.equal(wearableContext.scoreBearing, false)
    assert.deepEqual(wearableContext.outcomeContext, {
      ageEstimateBasis: 'none',
      horizonYears: null,
      riskEndpoint: 'none',
    })
    assert.equal(wearableContext.blockers.includes('NOT_SCORE_BEARING'), true)

    const encodedStatus = JSON.stringify(status)
    for (const forbidden of [
      'fixture-lab9-research-model',
      'modelId',
      'coefficient',
      'referenceRiskCurve',
      'modelEndpoint',
      'metric-point',
      vaultRoot,
    ]) {
      assert.equal(encodedStatus.includes(forbidden), false, forbidden)
    }
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
  }
})

test('age model-cards reports missing local artifacts as policy blockers', async () => {
  const vaultRoot = await createProjectionVault()
  try {
    const status = requireData(await runSliceCli<MurphAgeModelCardStatusReport>([
      'age',
      'model-cards',
      '--vault',
      vaultRoot,
    ]))

    assert.deepEqual(status.loadedCardIds, [])
    assert.deepEqual(status.researchReadyCardIds, [])
    assert.deepEqual(status.productReadyCardIds, [])
    assert.deepEqual(status.warnings, [])

    const lab9 = requirePolicyStatus(status, 'lab9_bp_body_10y_acm_research')
    assert.equal(lab9.loaded, false)
    assert.equal(lab9.researchUsable, false)
    assert.equal(lab9.productRiskReady, false)
    assert.equal(lab9.productAgeReady, false)
    assert.equal(lab9.blockers.includes('MODEL_CARD_NOT_LOADED'), true)

    const lab5 = requirePolicyStatus(status, 'lab5_bp_bmi_transport_research')
    assert.equal(lab5.loaded, false)
    assert.equal(lab5.researchUsable, false)
    assert.equal(lab5.productRiskReady, false)
    assert.equal(lab5.productAgeReady, false)
    assert.deepEqual(lab5.productPromotionBlockers, [
      'PRODUCT_POLICY_NOT_AUTHORIZED',
      'VALIDATION_GATE_BLOCKED',
      'PRODUCT_PROMOTION_EVIDENCE_MISSING',
      'PRODUCT_PROMOTION_EVIDENCE_TIER_MISSING',
      'RISK_TO_AGE_DISPLAY_NOT_AUTHORIZED',
    ])
    assert.deepEqual(lab5.outcomeContext, {
      ageEstimateBasis: 'risk-age-equivalent',
      horizonYears: 10,
      riskEndpoint: 'all-cause-mortality',
    })
    assert.equal(lab5.blockers.includes('MODEL_CARD_NOT_LOADED'), true)
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
  }
})

test('age inputs reports feature readiness without metric values or point ids', async () => {
  const vaultRoot = await createProjectionVault()
  try {
    await rebuildQueryProjection(vaultRoot)
    insertMetricPoints(vaultRoot, [
      ...lab9BpBodyMetricPoints(),
      ...wearableContextMetricPoints(),
    ])

    const readiness = requireData(await runSliceCli<MurphAgeInputReadinessReport>([
      'age',
      'inputs',
      '--vault',
      vaultRoot,
      '--as-of',
      '2026-05-10T00:00:00.000Z',
    ]))

    assert.equal(readiness.schemaVersion, 'murph.age.input-readiness.v2')
    assert.deepEqual(readiness.runtimeInputs, [
      {
        key: 'chronological-age-years',
        label: 'Chronological age',
        required: true,
        source: 'runtime-option',
        status: 'required',
      },
      {
        key: 'sex',
        label: 'Sex',
        required: true,
        source: 'runtime-option',
        status: 'required',
      },
    ])
    assert.equal(readiness.bundle.bundleId, 'lab9-bp-body')
    assert.equal(readiness.bundle.status, 'ready')
    assert.equal(readiness.bundle.recommendedCardId, 'lab9_bp_body_10y_acm_research')
    assert.equal(readiness.bundle.availableFeatureKeys.includes('albumin'), true)
    assert.equal(readiness.bundle.selectedMetricKeys.includes('albumin'), true)
    assert.equal(readiness.bundle.featureStatuses.some((feature) =>
      feature.featureKey === 'albumin'
        && feature.selectedMetricKey === 'albumin'
        && feature.status === 'ready'
    ), true)
    assert.equal(readiness.contextBundles[0]?.bundleId, 'wearable-context')
    assert.equal(readiness.contextBundles[0]?.selectedMetricKeys.includes('steps'), true)
    assert.equal(readiness.contextBundles[0]?.featureStatuses.some((feature) =>
      feature.featureKey === 'steps'
        && feature.selectedMetricKey === 'steps'
        && feature.status === 'ready'
    ), true)

    const encodedReadiness = JSON.stringify(readiness)
    for (const forbidden of [
      'selectedPointIds',
      'metric-point:',
      '"value"',
      '"unit"',
      vaultRoot,
    ]) {
      assert.equal(encodedReadiness.includes(forbidden), false, forbidden)
    }
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
  }
})

test('age inputs reports an empty vault as metadata-only abstain readiness', async () => {
  const vaultRoot = await createProjectionVault()
  try {
    await rebuildQueryProjection(vaultRoot)

    const readiness = requireData(await runSliceCli<MurphAgeInputReadinessReport>([
      'age',
      'inputs',
      '--vault',
      vaultRoot,
      '--as-of',
      '2026-05-10T00:00:00.000Z',
    ]))

    assert.equal(readiness.schemaVersion, 'murph.age.input-readiness.v2')
    assert.deepEqual(readiness.runtimeInputs.map((input) => input.key), ['chronological-age-years', 'sex'])
    assert.equal(readiness.bundle.bundleId, 'insufficient')
    assert.equal(readiness.bundle.status, 'abstain')
    assert.equal(readiness.bundle.recommendedCardId, 'none')
    assert.deepEqual(readiness.bundle.availableFeatureKeys, [])
    assert.deepEqual(readiness.bundle.selectedMetricKeys, [])
    assert.equal(readiness.contextBundles.length, 0)

    const encodedReadiness = JSON.stringify(readiness)
    for (const forbidden of [
      'selectedPointIds',
      'metric-point:',
      '"value"',
      '"unit"',
      vaultRoot,
      'ledger/events',
    ]) {
      assert.equal(encodedReadiness.includes(forbidden), false, forbidden)
    }
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
  }
})

test('age report returns a product-mode public abstention instead of research-only claims', async () => {
  const vaultRoot = await createProjectionVault()
  try {
    await rebuildQueryProjection(vaultRoot)
    insertMetricPoints(vaultRoot, [
      ...lab9BpBodyMetricPoints(),
      ...wearableContextMetricPoints(),
    ])
    await writeLocalModelCardArtifact(vaultRoot, 'lab9.json', {
      cardId: 'lab9_bp_body_10y_acm_research',
      model: fixtureLab9ResearchModel(),
      schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
    })

    const report = requireData(await runSliceCli<MurphAgePublicCalculatorReport>([
      'age',
      'report',
      '--vault',
      vaultRoot,
      '--as-of',
      '2026-05-10T00:00:00.000Z',
      '--chronological-age-years',
      '45',
      '--sex',
      'female',
    ]))

    assert.equal(report.mode, 'product')
    assert.equal(report.status, 'abstain')
    assert.equal(report.result, null)
    assert.equal(report.authorization.productAuthorized, false)
    assert.equal(report.displaySummary.displayBlockedReason, 'product-not-authorized')
    assert.equal(report.displaySummary.displayStatus, 'abstain')
    assert.equal(report.displaySummary.wearableBridge.productAuthorized, false)
    assert.equal(report.warnings.some((warning) => warning.code === 'MODEL_CARD_NOT_AUTHORIZED'), true)
    assert.equal(hasOwnKey(report, 'bundleAssessment'), false)
    assert.equal(hasOwnKey(report, 'contextAssessments'), false)
    assert.equal(hasOwnKey(report, 'wearableShadowIncrementAssessments'), false)
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
  }
})

test('age report can run explicit local research mode through the public report boundary', async () => {
  const vaultRoot = await createProjectionVault()
  try {
    await rebuildQueryProjection(vaultRoot)
    insertMetricPoints(vaultRoot, [
      ...lab9BpBodyMetricPoints(),
      ...wearableContextMetricPoints(),
      wearablePoint('wearable-valid-day-count-28d', null, 25, 'count'),
      wearablePoint('wearable-coverage-index', null, 0.86, 'ratio'),
    ])
    await writeLocalModelCardArtifact(vaultRoot, 'lab9.json', {
      cardId: 'lab9_bp_body_10y_acm_research',
      model: fixtureLab9ResearchModel(),
      schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
    })

    const report = requireData(await runSliceCli<MurphAgePublicCalculatorReport>([
      'age',
      'report',
      '--vault',
      vaultRoot,
      '--as-of',
      '2026-05-10T00:00:00.000Z',
      '--chronological-age-years',
      '45',
      '--sex',
      'female',
      '--mode',
      'research',
    ]))

    assert.equal(report.mode, 'research')
    assert.equal(report.status, 'ready')
    assert.equal(report.displaySummary.displayStatus, 'research-only')
    assert.equal(report.displaySummary.researchEstimateAvailable, true)
    assert.deepEqual(report.displaySummary.outcomeContext, {
      ageEstimateBasis: 'risk-age-equivalent',
      horizonYears: 10,
      riskEndpoint: 'all-cause-mortality',
    })
    assert.equal(report.authorization.productAuthorized, false)
    assert.equal(report.result?.authorization.evidenceClass, 'research-internal')
    assert.equal(report.result?.featureAttributions.some((feature) => feature.metricKey === 'albumin'), true)
    assert.equal(report.result?.featureAttributions.some((feature) => feature.metricKey === 'steps'), false)
    assert.equal(report.displaySummary.wearableBridge.readyFeatureKeys.includes('activity-volume'), true)

    const firstAttribution = report.result?.featureAttributions[0]
    assert.equal(firstAttribution ? hasOwnKey(firstAttribution, 'selectedPointIds') : true, false)
    assert.equal(firstAttribution ? hasOwnKey(firstAttribution, 'value') : true, false)
    assert.equal(hasOwnKey(report, 'bundleAssessment'), false)
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
  }
})

test('age report consumes saved canonical blood tests and measurements through projection', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-age-cli-canonical-')
  try {
    const cli = createCanonicalInputCli()
    const initResult = await runInProcessJsonCli<{ created: boolean }>(cli, [
      'init',
      '--vault',
      vaultRoot,
      '--timezone',
      'UTC',
    ])
    assert.equal(requireData(initResult.envelope).created, true)

    const bloodTestResult = await runInProcessJsonCli(cli, [
      'blood-test',
      'save',
      'Functional health panel',
      '--vault',
      vaultRoot,
      '--occurred-at',
      '2026-05-01T08:00:00.000Z',
      '--test-name',
      'functional_health_panel',
      '--lab-name',
      'Function Health',
      '--fasting-status',
      'fasting',
      '--result',
      'analyte=Albumin;biomarkerSlug=albumin;value=4.4;unit=g/dL',
      '--result',
      'analyte=Creatinine;biomarkerSlug=creatinine;value=0.9;unit=mg/dL',
      '--result',
      'analyte=HbA1c;biomarkerSlug=hba1c;value=5.1;unit=percent',
      '--result',
      'analyte=Alkaline phosphatase;biomarkerSlug=alkaline-phosphatase;value=70;unit=U/L',
      '--result',
      'analyte=White blood cell count;biomarkerSlug=white-blood-cell-count;value=5.6;unit=10^3/uL',
      '--result',
      'analyte=Lymphocyte percentage;biomarkerSlug=lymphocyte-percentage;value=32;unit=percent',
      '--result',
      'analyte=Red cell distribution width;biomarkerSlug=red-cell-distribution-width;value=12.6;unit=percent',
      '--result',
      'analyte=HDL-C;biomarkerSlug=hdl-c;value=62;unit=mg/dL',
      '--result',
      'analyte=Triglycerides;biomarkerSlug=triglycerides;value=90;unit=mg/dL',
    ])
    requireData(bloodTestResult.envelope)

    const measurementResult = await runInProcessJsonCli(cli, [
      'measurement',
      'add',
      '--vault',
      vaultRoot,
      '--occurred-at',
      '2026-05-08T08:00:00.000Z',
      '--source',
      'manual',
      '--metric',
      'systolic-blood-pressure',
      '--value',
      '118',
      '--unit',
      'mmHg',
      '--metric',
      'diastolic-blood-pressure',
      '--value',
      '74',
      '--unit',
      'mmHg',
      '--metric',
      'bmi',
      '--value',
      '23.5',
      '--unit',
      'kg/m2',
    ])
    requireData(measurementResult.envelope)

    await rebuildQueryProjection(vaultRoot)
    await writeLocalModelCardArtifact(vaultRoot, 'lab9.json', {
      cardId: 'lab9_bp_body_10y_acm_research',
      model: fixtureLab9ResearchModel(),
      schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
    })

    const report = requireData(
      (
        await runInProcessJsonCli<MurphAgePublicCalculatorReport>(cli, [
          'age',
          'report',
          '--vault',
          vaultRoot,
          '--as-of',
          '2026-05-10T00:00:00.000Z',
          '--chronological-age-years',
          '45',
          '--sex',
          'female',
          '--mode',
          'research',
        ])
      ).envelope,
    )

    assert.equal(report.mode, 'research')
    assert.equal(report.status, 'ready')
    assert.equal(report.displaySummary.displayStatus, 'research-only')
    assert.equal(report.result?.status, 'ready')
    assert.equal(report.result?.authorization.scoreBearing, true)
    for (const metricKey of [
      'albumin',
      'creatinine',
      'hba1c',
      'alkaline-phosphatase',
      'white-blood-cell-count',
      'lymphocyte-percentage',
      'red-cell-distribution-width',
      'hdl-c',
      'triglycerides',
      'systolic-blood-pressure',
      'diastolic-blood-pressure',
      'bmi',
    ]) {
      assert.equal(
        report.displaySummary.selectedScoreBearingMetricKeys.includes(metricKey),
        true,
        metricKey,
      )
    }
    assert.equal(report.result?.featureAttributions.some((feature) => feature.metricKey === 'albumin'), true)
    assert.equal(report.result?.featureAttributions.some((feature) => feature.metricKey === 'bmi'), true)
    for (const attribution of report.result?.featureAttributions ?? []) {
      assert.equal(hasOwnKey(attribution, 'selectedPointIds'), false, attribution.featureKey)
      assert.equal(hasOwnKey(attribution, 'value'), false, attribution.featureKey)
      assert.equal(hasOwnKey(attribution, 'canonicalValue'), false, attribution.featureKey)
    }
    assert.equal(hasOwnKey(report, 'bundleAssessment'), false)
    assert.equal(hasOwnKey(report, 'selectedScoreBearingPointIds'), false)
    assert.equal(hasOwnKey(report.displaySummary, 'selectedScoreBearingPointIds'), false)
  } finally {
    await rm(parentRoot, { force: true, recursive: true })
  }
})

test('age report consumes canonical wearable observations as context-only bridge data', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-age-cli-wearable-')
  try {
    const cli = createCanonicalInputCli()
    const initResult = await runInProcessJsonCli<{ created: boolean }>(cli, [
      'init',
      '--vault',
      vaultRoot,
      '--timezone',
      'UTC',
    ])
    assert.equal(requireData(initResult.envelope).created, true)

    const wearableObservationPayloads = [
      wearableObservationPayload({
        facet: 'steps',
        metric: 'daily-steps',
        resourceId: 'oura-activity-2026-05-08',
        resourceType: 'daily-activity',
        title: 'Oura daily steps',
        unit: 'count',
        value: 10_000,
      }),
      wearableObservationPayload({
        facet: 'resting-heart-rate',
        metric: 'resting-heart-rate',
        resourceId: 'oura-readiness-2026-05-08',
        resourceType: 'daily-readiness',
        title: 'Oura resting heart rate',
        unit: 'bpm',
        value: 62,
      }),
      wearableObservationPayload({
        facet: 'hrv-rmssd',
        metric: 'hrv-rmssd',
        resourceId: 'oura-readiness-2026-05-08',
        resourceType: 'daily-readiness',
        title: 'Oura HRV',
        unit: 'ms',
        value: 48,
      }),
      wearableObservationPayload({
        facet: 'total-sleep-minutes',
        metric: 'total-sleep-minutes',
        resourceId: 'oura-sleep-2026-05-08',
        resourceType: 'sleep',
        title: 'Oura total sleep',
        unit: 'minutes',
        value: 450,
      }),
    ]

    for (const [index, payload] of wearableObservationPayloads.entries()) {
      const payloadPath = path.join(parentRoot, `wearable-observation-${index}.json`)
      await writeFile(payloadPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
      const result = await runInProcessJsonCli(cli, [
        'event',
        'import-json',
        '--input',
        `@${payloadPath}`,
        '--vault',
        vaultRoot,
      ])
      requireData(result.envelope)
    }

    await rebuildQueryProjection(vaultRoot)

    const report = requireData(
      (
        await runInProcessJsonCli<MurphAgePublicCalculatorReport>(cli, [
          'age',
          'report',
          '--vault',
          vaultRoot,
          '--as-of',
          '2026-05-10T00:00:00.000Z',
          '--chronological-age-years',
          '45',
          '--sex',
          'female',
          '--mode',
          'research',
        ])
      ).envelope,
    )

    assert.equal(report.mode, 'research')
    assert.equal(report.status, 'context-only')
    assert.equal(report.result, null)
    assert.equal(report.displaySummary.displayStatus, 'context-only')
    assert.deepEqual(report.displaySummary.outcomeContext, {
      ageEstimateBasis: 'none',
      horizonYears: null,
      riskEndpoint: 'none',
    })
    assert.equal(report.displaySummary.wearableContext.scoreBearing, false)
    assert.equal(report.displaySummary.wearableContext.scoreContributionAuthorized, false)
    assert.equal(report.displaySummary.wearableBridge.scoreBearing, false)
    assert.equal(report.displaySummary.wearableBridge.scoreContributionAuthorized, false)
    assert.equal(report.displaySummary.wearableBridge.productAuthorized, false)
    assert.equal(report.displaySummary.wearableBridge.readyFeatureKeys.length, 0)
    assert.equal(report.displaySummary.wearableBridge.partialFeatureKeys.includes('activity-volume'), true)
    assert.equal(report.displaySummary.wearableBridge.partialFeatureKeys.includes('sleep-duration-regularity'), true)
    assert.equal(report.displaySummary.wearableBridge.partialFeatureKeys.includes('resting-heart-rate'), true)
    assert.equal(report.displaySummary.wearableBridge.partialFeatureKeys.includes('hrv-rmssd'), true)
    assert.equal(report.displaySummary.wearableBridge.deferredFeatureKeys.includes('hrv-rmssd'), true)
    assert.equal(report.displaySummary.contextOnlyMetricKeys.includes('steps'), true)
    assert.equal(report.displaySummary.contextOnlyMetricKeys.includes('resting-heart-rate'), true)
    assert.equal(report.displaySummary.contextOnlyMetricKeys.includes('hrv-rmssd'), true)
    assert.equal(report.displaySummary.contextOnlyMetricKeys.includes('total-sleep-minutes'), true)
    assert.equal(report.displaySummary.wearableBridge.features.some((feature) => hasOwnKey(feature, 'selectedPointIds')), false)
    assert.equal(report.displaySummary.wearableBridge.features.every((feature) => feature.productAuthorized === false), true)
    assert.equal(hasOwnKey(report, 'contextAssessments'), false)
    assert.equal(hasOwnKey(report.displaySummary, 'contextOnlyPointIds'), false)
    assert.equal(hasOwnKey(report.displaySummary, 'selectedScoreBearingPointIds'), false)
  } finally {
    await rm(parentRoot, { force: true, recursive: true })
  }
})

test('age report derives wearable coverage quality from canonical observations', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-age-cli-wearable-coverage-')
  try {
    const cli = createCanonicalInputCli()
    const initResult = await runInProcessJsonCli<{ created: boolean }>(cli, [
      'init',
      '--vault',
      vaultRoot,
      '--timezone',
      'UTC',
    ])
    assert.equal(requireData(initResult.envelope).created, true)

    const wearableObservationPayloads = wearableCoverageWindowDates().flatMap((date) => [
      wearableObservationPayload({
        date,
        facet: 'steps',
        metric: 'daily-steps',
        resourceId: `oura-activity-${date}`,
        resourceType: 'daily-activity',
        title: 'Oura daily steps',
        unit: 'count',
        value: 10_000,
      }),
      wearableObservationPayload({
        date,
        facet: 'resting-heart-rate',
        metric: 'resting-heart-rate',
        resourceId: `oura-readiness-${date}`,
        resourceType: 'daily-readiness',
        title: 'Oura resting heart rate',
        unit: 'bpm',
        value: 62,
      }),
      wearableObservationPayload({
        date,
        facet: 'hrv-rmssd',
        metric: 'hrv-rmssd',
        resourceId: `oura-readiness-${date}`,
        resourceType: 'daily-readiness',
        title: 'Oura HRV',
        unit: 'ms',
        value: 48,
      }),
      wearableObservationPayload({
        date,
        facet: 'total-sleep-minutes',
        metric: 'total-sleep-minutes',
        resourceId: `oura-sleep-${date}`,
        resourceType: 'sleep',
        title: 'Oura total sleep',
        unit: 'minutes',
        value: 450,
      }),
    ])

    for (const [index, payload] of wearableObservationPayloads.entries()) {
      const payloadPath = path.join(parentRoot, `wearable-coverage-observation-${index}.json`)
      await writeFile(payloadPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
      const result = await runInProcessJsonCli(cli, [
        'event',
        'import-json',
        '--input',
        `@${payloadPath}`,
        '--vault',
        vaultRoot,
      ])
      requireData(result.envelope)
    }

    await rebuildQueryProjection(vaultRoot)

    const report = requireData(
      (
        await runInProcessJsonCli<MurphAgePublicCalculatorReport>(cli, [
          'age',
          'report',
          '--vault',
          vaultRoot,
          '--as-of',
          '2026-05-10T00:00:00.000Z',
          '--chronological-age-years',
          '45',
          '--sex',
          'female',
          '--mode',
          'research',
        ])
      ).envelope,
    )

    assert.equal(report.mode, 'research')
    assert.equal(report.status, 'context-only')
    assert.equal(report.result, null)
    assert.equal(report.displaySummary.displayStatus, 'context-only')
    assert.equal(report.displaySummary.wearableContext.quality, 'strong-context')
    assert.equal(report.displaySummary.wearableContext.scoreBearing, false)
    assert.equal(report.displaySummary.wearableContext.scoreContributionAuthorized, false)
    assert.equal(report.displaySummary.wearableBridge.scoreBearing, false)
    assert.equal(report.displaySummary.wearableBridge.scoreContributionAuthorized, false)
    assert.equal(report.displaySummary.wearableBridge.productAuthorized, false)
    for (const metricKey of [
      'wearable-valid-day-count-28d',
      'wearable-valid-night-count-28d',
      'wearable-coverage-index',
    ]) {
      assert.equal(report.displaySummary.contextOnlyMetricKeys.includes(metricKey), true, metricKey)
    }
    for (const featureKey of [
      'wearable-coverage-quality',
      'activity-volume',
      'sleep-duration-regularity',
      'resting-heart-rate',
      'hrv-rmssd',
    ]) {
      assert.equal(report.displaySummary.wearableBridge.readyFeatureKeys.includes(featureKey), true, featureKey)
    }
    assert.equal(report.displaySummary.wearableBridge.partialFeatureKeys.includes('activity-volume'), false)
    assert.equal(report.displaySummary.wearableBridge.partialFeatureKeys.includes('resting-heart-rate'), false)
    assert.equal(report.displaySummary.wearableBridge.features.some((feature) => hasOwnKey(feature, 'selectedPointIds')), false)
    assert.equal(report.displaySummary.wearableBridge.features.every((feature) => feature.productAuthorized === false), true)
    assert.equal(hasOwnKey(report, 'contextAssessments'), false)
    assert.equal(hasOwnKey(report.displaySummary, 'contextOnlyPointIds'), false)
    assert.equal(hasOwnKey(report.displaySummary, 'selectedScoreBearingPointIds'), false)
  } finally {
    await rm(parentRoot, { force: true, recursive: true })
  }
})

test('age report rejects uninitialized vault roots before calculating a report', async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), 'murph-age-cli-uninitialized-'))
  try {
    const result = await runSliceCliResult([
      'age',
      'report',
      '--vault',
      vaultRoot,
      '--as-of',
      '2026-05-10T00:00:00.000Z',
      '--chronological-age-years',
      '45',
      '--sex',
      'female',
    ])

    assert.equal(result.exitCode, 1)
    assert.equal(result.envelope.ok, false)
    if (result.envelope.ok) {
      assert.fail('expected uninitialized vault to return an error envelope')
    }
    assert.equal(result.envelope.error.code, 'invalid_vault')
    assert.match(result.envelope.error.message ?? '', /not initialized/u)
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
  }
})

function wearableObservationPayload(input: {
  date?: string
  facet: string
  metric: string
  resourceId: string
  resourceType: string
  title: string
  unit: string
  value: number
}) {
  const occurredAt = `${input.date ?? '2026-05-08'}T08:00:00.000Z`
  return {
    externalRef: {
      facet: input.facet,
      resourceId: input.resourceId,
      resourceType: input.resourceType,
      system: 'oura',
    },
    kind: 'observation',
    metric: input.metric,
    occurredAt,
    source: 'device',
    title: input.title,
    unit: input.unit,
    value: input.value,
  }
}

function wearableCoverageWindowDates(): string[] {
  const start = Date.UTC(2026, 3, 11)
  return Array.from({ length: 28 }, (_, index) =>
    new Date(start + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  )
}

async function createProjectionVault(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), 'murph-age-cli-'))
  await mkdir(path.join(vaultRoot, 'ledger/events/2026'), { recursive: true })
  await writeFile(
    path.join(vaultRoot, 'vault.json'),
    `${JSON.stringify({
      createdAt: '2026-05-01T00:00:00.000Z',
      formatVersion: CURRENT_VAULT_FORMAT_VERSION,
      timezone: 'UTC',
      title: 'Test Vault',
      vaultId: 'vault_01K72NVW6Z4QK8VYAVX7GT7S4B',
    }, null, 2)}\n`,
  )
  await writeFile(path.join(vaultRoot, 'ledger/events/2026/2026-05.jsonl'), '')
  return vaultRoot
}

async function writeLocalModelCardArtifact(
  vaultRoot: string,
  fileName: string,
  artifact: unknown,
): Promise<void> {
  const root = defaultMurphAgeModelCardArtifactRoot(vaultRoot)
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, fileName), `${JSON.stringify(artifact, null, 2)}\n`)
}

function insertMetricPoints(vaultRoot: string, points: readonly MetricPoint[]): void {
  const database = openSqliteRuntimeDatabase(path.join(vaultRoot, QUERY_DB_RELATIVE_PATH), { create: false })
  try {
    const insertMetricPoint = database.prepare(`
      INSERT INTO query_metric_points (
        id,
        sort_rank,
        metric_key,
        biomarker_key,
        value,
        text_value,
        comparator,
        unit,
        canonical_value,
        canonical_unit,
        observed_at,
        effective_date,
        recorded_at,
        reported_at,
        grain,
        statistic,
        source_family,
        source_kind,
        source_record_id,
        source_result_index,
        source_path,
        confidence,
        provenance_json,
        context_json,
        metric_point_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    points.forEach((point, index) => {
      insertMetricPoint.run(
        point.id,
        index,
        point.metricKey,
        point.biomarkerKey,
        point.value,
        point.textValue,
        point.comparator,
        point.unit,
        point.canonicalValue,
        point.canonicalUnit,
        point.observedAt,
        point.effectiveDate,
        point.recordedAt,
        point.reportedAt,
        point.grain,
        point.statistic,
        point.source.family,
        point.source.kind,
        point.source.recordId,
        point.source.resultIndex,
        point.source.path,
        point.confidence,
        JSON.stringify(point.provenance),
        JSON.stringify(point.context),
        JSON.stringify(point),
      )
    })
  } finally {
    database.close()
  }
}

function metricPoint(input: {
  biomarkerKey?: string | null
  effectiveDate: string
  id: string
  metricKey: string
  observedAt: string
  recordId: string
  sourceKind: MetricPoint['source']['kind']
  unit: string | null
  value: number
}): MetricPoint {
  const normalized = normalizeMetricValue({
    metricKey: input.metricKey,
    unit: input.unit,
    value: input.value,
  })

  return {
    biomarkerKey: input.biomarkerKey ?? null,
    canonicalUnit: normalized.canonicalUnit,
    canonicalValue: normalized.canonicalValue,
    comparator: null,
    confidence: 'high',
    context: {},
    effectiveDate: input.effectiveDate,
    grain: 'day',
    id: input.id,
    metricKey: input.metricKey,
    observedAt: input.observedAt,
    provenance: {
      dataOrigin: null,
      externalRef: null,
      labName: null,
      provider: null,
      rawRefs: [],
      sourceLabel: 'Fixture',
    },
    recordedAt: null,
    reportedAt: null,
    schemaVersion: METRIC_POINT_SCHEMA_VERSION,
    source: {
      family: input.sourceKind === 'test-result' ? 'event' : 'derived',
      kind: input.sourceKind,
      path: 'ledger/events/2026/2026-05.jsonl',
      recordId: input.recordId,
      resultIndex: null,
    },
    statistic: 'value',
    textValue: null,
    unit: input.unit,
    value: input.value,
  }
}

function lab9BpBodyMetricPoints(): MetricPoint[] {
  return [
    labPoint('albumin', 'biomarker:albumin', 4.4, 'g/dL'),
    labPoint('creatinine', 'biomarker:creatinine', 0.9, 'mg/dL'),
    labPoint('hba1c', 'biomarker:hba1c', 5.1, 'percent'),
    labPoint('alkaline-phosphatase', 'biomarker:alkaline-phosphatase', 70, 'U/L'),
    labPoint('white-blood-cell-count', 'biomarker:white-blood-cell-count', 5.6, '10^3/uL'),
    labPoint('lymphocyte-percentage', 'biomarker:lymphocyte-percentage', 32, 'percent'),
    labPoint('red-cell-distribution-width', 'biomarker:red-cell-distribution-width', 12.6, 'percent'),
    labPoint('hdl-c', 'biomarker:hdl-c', 62, 'mg/dL'),
    labPoint('triglycerides', 'biomarker:triglycerides', 90, 'mg/dL'),
    measurementPoint('systolic-blood-pressure', 'biomarker:systolic-blood-pressure', 118, 'mmHg'),
    measurementPoint('diastolic-blood-pressure', 'biomarker:diastolic-blood-pressure', 74, 'mmHg'),
    measurementPoint('bmi', null, 23.5, 'kg/m^2'),
  ]
}

function wearableContextMetricPoints(): MetricPoint[] {
  return [
    wearablePoint('steps', null, 10_000, 'count'),
    wearablePoint('resting-heart-rate', 'biomarker:resting-heart-rate', 62, 'bpm'),
    wearablePoint('hrv-rmssd', 'biomarker:hrv-rmssd', 48, 'ms'),
  ]
}

function labPoint(metricKey: string, biomarkerKey: string, value: number, unit: string): MetricPoint {
  return metricPoint({
    biomarkerKey,
    effectiveDate: '2026-05-01',
    id: `metric-point:${metricKey}:2026-05-01:lab:0`,
    metricKey,
    observedAt: '2026-05-01T08:00:00.000Z',
    recordId: `lab_${metricKey.replaceAll('-', '_')}`,
    sourceKind: 'test-result',
    unit,
    value,
  })
}

function measurementPoint(
  metricKey: string,
  biomarkerKey: string | null,
  value: number,
  unit: string,
): MetricPoint {
  return metricPoint({
    biomarkerKey,
    effectiveDate: '2026-05-08',
    id: `metric-point:${metricKey}:2026-05-08:measurement:0`,
    metricKey,
    observedAt: '2026-05-08T08:00:00.000Z',
    recordId: `measurement_${metricKey.replaceAll('-', '_')}`,
    sourceKind: 'measurement',
    unit,
    value,
  })
}

function wearablePoint(
  metricKey: string,
  biomarkerKey: string | null,
  value: number,
  unit: string,
): MetricPoint {
  return metricPoint({
    biomarkerKey,
    effectiveDate: '2026-05-08',
    id: `metric-point:${metricKey}:2026-05-08:wearable:0`,
    metricKey,
    observedAt: '2026-05-08T08:00:00.000Z',
    recordId: `wearable_${metricKey.replaceAll('-', '_')}`,
    sourceKind: 'wearable-summary',
    unit,
    value,
  })
}

function fixtureLab9ResearchModel(): MurphAgeRiskModel {
  return {
    endpoint: '10-year all-cause mortality',
    features: [
      { coefficient: 0.055, key: 'age', kind: 'chronological-age', label: 'Age' },
      { coefficient: 0.12, key: 'male', kind: 'sex', label: 'Male', sex: 'male' },
      labFeature('albumin', 'Albumin', 'albumin', -0.16, 4.2, 0.3, 'g/dL'),
      labFeature('creatinine', 'Creatinine', 'creatinine', 0.08, 0.9, 0.2, 'mg/dL'),
      labFeature('hba1c', 'HbA1c', 'hba1c', 0.12, 5.4, 0.5, 'percent'),
      labFeature('alkaline-phosphatase', 'Alkaline phosphatase', 'alkaline-phosphatase', 0.08, 70, 20, 'U/L'),
      labFeature('white-blood-cell-count', 'White blood cells', 'white-blood-cell-count', 0.08, 6, 1.5, '10^3/uL'),
      labFeature('lymphocyte-percentage', 'Lymphocytes', 'lymphocyte-percentage', -0.06, 30, 8, 'percent'),
      labFeature('red-cell-distribution-width', 'RDW', 'red-cell-distribution-width', 0.12, 13, 1, 'percent'),
      labFeature('hdl-c', 'HDL-C', 'hdl-c', -0.08, 55, 15, 'mg/dL'),
      labFeature('triglycerides', 'Triglycerides', 'triglycerides', 0.08, 120, 50, 'mg/dL'),
      labFeature('systolic-blood-pressure', 'Systolic blood pressure', 'systolic-blood-pressure', 0.1, 120, 15, 'mmHg'),
      labFeature('diastolic-blood-pressure', 'Diastolic blood pressure', 'diastolic-blood-pressure', 0.04, 75, 10, 'mmHg'),
      labFeature('bmi', 'BMI', 'bmi', 0.08, 25, 4, 'kg/m^2'),
    ],
    horizonYears: 10,
    intercept: -6.1,
    modelId: 'fixture-lab9-research-model',
    modelVersion: 'test.0',
    referencePopulation: 'fixture adult lab reference curve',
    referenceRiskCurve: [
      { ageYears: 20, riskProbability: 0.005 },
      { ageYears: 40, riskProbability: 0.025 },
      { ageYears: 60, riskProbability: 0.1 },
      { ageYears: 80, riskProbability: 0.28 },
    ],
    uncertainty: {
      baseYears: 2,
      perMissingOptionalFeatureYears: 2,
    },
  }
}

function labFeature(
  key: string,
  label: string,
  metricKey: string,
  coefficient: number,
  mean: number,
  standardDeviation: number,
  expectedUnit: string,
): MurphAgeRiskModel['features'][number] {
  return {
    coefficient,
    expectedUnit,
    key,
    kind: 'metric',
    label,
    metricKey,
    moduleId: 'clinical',
    transform: { clamp: { max: 3, min: -3 }, kind: 'z-score', mean, standardDeviation },
  }
}

function hasOwnKey(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function requirePolicyStatus(
  status: MurphAgeModelCardStatusReport,
  cardId: string,
): MurphAgeModelCardStatusReport['policies'][number] {
  const policy = status.policies.find((candidate) => candidate.cardId === cardId)
  assert.ok(policy, `expected model-card policy status for ${cardId}`)
  return policy
}
