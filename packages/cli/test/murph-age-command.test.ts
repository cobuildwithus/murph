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
  MURPH_AGE_PUBLIC_VALIDATION_GATE_SUMMARY_TEXT,
  normalizeMetricValue,
  type MetricPoint,
  type MurphAgePublicCalculatorReport,
  type MurphAgePublicDisplaySummary,
  type MurphAgeResearchCalculatorView,
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
import {
  murphAgeReportResultSchema,
  murphAgeResearchCalculatorViewResultSchema,
  murphAgeSubmittedPreviewPayloadSchema,
  registerMurphAgeCommands,
} from '../src/commands/murph-age.js'
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
  scoreReadiness: {
    bundleId: string
    contextOnly: boolean
    inputReady: boolean
    productAgePolicyReady: boolean
    productBlockedReasons: string[]
    productPromotionBlockers: string[]
    productRiskPolicyReady: boolean
    recommendedCardId: string
    researchModelCardRequired: boolean
    researchReadiness: string
    researchUsableIfModelLoaded: boolean
    scoreBearingInput: boolean
    status: string
  }
  wearableBridge: MurphAgePublicDisplaySummary['wearableBridge']
  wearableShadow: {
    anchor: {
      anchorCardId: string | null
      bundleId: string
      recommendedCardId: string
      status: string
    }
    assessments: Array<{
      family: string
      missingMetricKeys: string[]
      outputBoundary: {
        aggregateOnly: true
        coefficientsExportAllowed: false
        participantLevelExportAllowed: false
        predictionsExportAllowed: false
        productDisplayExportAllowed: false
        rowValuesExportAllowed: false
      }
      productAuthorized: false
      riskEffect: 'not-estimated'
      scoreBearing: false
      scoreContributionAuthorized: false
      selectedMetricKeys: string[]
      status: string
    }>
    blockedFamilies: string[]
    missingFamilies: string[]
    readyFamilies: string[]
    schemaVersion: string
    warnings: Array<{ code: string }>
  }
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

test('age report can use an explicit research model-card artifact root', async () => {
  const vaultRoot = await createProjectionVault()
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), 'murph-age-cli-model-cards-'))
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
    }, artifactRoot)

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
      '--card-id',
      'lab9_bp_body_10y_acm_research',
      '--model-card-artifact-root',
      artifactRoot,
    ]))

    assert.equal(report.status, 'ready')
    assert.equal(report.mode, 'research')
    assert.equal(report.authorization.cardId, 'lab9_bp_body_10y_acm_research')
    assert.equal(report.displaySummary.displayStatus, 'research-only')
    assert.equal(report.result?.authorization.cardId, 'lab9_bp_body_10y_acm_research')

    const status = requireData(await runSliceCli<MurphAgeModelCardStatusReport>([
      'age',
      'model-cards',
      '--vault',
      vaultRoot,
      '--model-card-artifact-root',
      artifactRoot,
    ]))
    assert.deepEqual(status.loadedCardIds, ['lab9_bp_body_10y_acm_research'])
    assert.deepEqual(status.researchReadyCardIds, ['lab9_bp_body_10y_acm_research'])

    const encodedReport = JSON.stringify(report)
    assert.equal(encodedReport.includes(artifactRoot), false)
    assert.equal(encodedReport.includes('modelCardArtifactRoot'), false)
    assert.equal(encodedReport.includes('fixture-lab9-research-model'), false)
    assert.equal(encodedReport.includes('coefficient'), false)
    assert.equal(encodedReport.includes('selectedPointIds'), false)
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
    await rm(artifactRoot, { force: true, recursive: true })
  }
})

test('age scaffold emits a submitted-data research preview payload', async () => {
  const payload = murphAgeSubmittedPreviewPayloadSchema.parse(
    requireData(await runSliceCli<unknown>(['age', 'scaffold'])),
  )
  const metricKeys = payload.submittedMetrics.map((metric) => metric.metricKey)

  assert.equal(payload.sex, 'female')
  assert.equal(payload.chronologicalAgeYears, 45)
  assert.equal(payload.modelCardArtifactRoot, undefined)
  assert.equal(metricKeys.includes('HbA1c'), true)
  assert.equal(metricKeys.includes('steps'), true)
  assert.equal(metricKeys.includes('total-sleep-minutes'), true)
  assert.equal(metricKeys.includes('resting-heart-rate'), true)
  assert.equal(metricKeys.includes('hrv-rmssd'), true)
})

test('age preview scores submitted labs and wearable context without a vault', async () => {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), 'murph-age-cli-model-cards-'))
  const payloadRoot = await mkdtemp(path.join(os.tmpdir(), 'murph-age-cli-preview-'))
  const payloadPath = path.join(payloadRoot, 'payload.json')
  try {
    await writeLocalModelCardArtifact(payloadRoot, 'lab5.json', {
      cardId: 'lab5_bp_bmi_transport_research',
      model: fixtureLab5ResearchModel(),
      schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
    }, artifactRoot)
    await writeFile(payloadPath, JSON.stringify({
      asOf: '2026-05-10T00:00:00.000Z',
      chronologicalAgeYears: 45,
      sex: 'female',
      submittedMetrics: [
        { metricKey: 'HbA1c', unit: '%', value: 5.3 },
        { metricKey: 'HDL_C', unit: 'mg/dL', value: 60 },
        { context: { fastingStatus: 'fasting' }, metricKey: 'Triglycerides', unit: 'mg/dL', value: 90 },
        { metricKey: 'creatinine', unit: 'mg/dL', value: 0.85 },
        {
          context: { measurementMethodKey: 'manual-cuff' },
          metricKey: 'SBP',
          sourceKind: 'measurement',
          unit: 'mmHg',
          value: 118,
        },
        { metricKey: 'diastolic_bp', sourceKind: 'measurement', unit: 'mmHg', value: 72 },
        { metricKey: 'body_mass_index', sourceKind: 'measurement', unit: 'kg/m2', value: 23.2 },
        { metricKey: 'steps', sourceKind: 'wearable-summary', unit: 'count', value: 10_000 },
        { metricKey: 'wearable_valid_day_count_28d', sourceKind: 'wearable-summary', unit: 'count', value: 22 },
        { metricKey: 'wearable_coverage_index', sourceKind: 'wearable-summary', unit: 'score', value: 0.8 },
        { metricKey: 'private metric', unit: 'count', value: 1 },
      ],
    }))

    const report = requireData(await runSliceCli<MurphAgePublicCalculatorReport>([
      'age',
      'preview',
      '--input',
      `@${payloadPath}`,
      '--model-card-artifact-root',
      artifactRoot,
    ]))

    assert.equal(report.status, 'ready')
    assert.equal(report.mode, 'research')
    assert.equal(report.displaySummary.displayStatus, 'research-only')
    assert.equal(report.result?.authorization.cardId, 'lab5_bp_bmi_transport_research')
    assert.equal(report.result?.featureAttributions.some((feature) => feature.metricKey === 'hba1c'), true)
    assert.equal(report.result?.featureAttributions.some((feature) => feature.metricKey === 'steps'), false)
    assert.equal(report.displaySummary.wearableBridge.readyFeatureKeys.includes('activity-volume'), true)
    assert.equal(report.warnings.some((warning) => warning.code === 'INVALID_INPUT'), true)

    const encodedReport = JSON.stringify(report)
    for (const forbidden of [
      artifactRoot,
      payloadPath,
      'private metric',
      'fixture-lab5-research-model',
      'fasting',
      'manual-cuff',
      'metric-point:',
      '"value"',
      '"unit"',
      '"message"',
      'selectedPointIds',
      'coefficient',
    ]) {
      assert.equal(encodedReport.includes(forbidden), false, forbidden)
    }

    const view = requireData(await runSliceCli<MurphAgeResearchCalculatorView>([
      'age',
      'preview-view',
      '--input',
      `@${payloadPath}`,
      '--model-card-artifact-root',
      artifactRoot,
    ]))

    assert.equal(murphAgeResearchCalculatorViewResultSchema.safeParse(view).success, true)
    assert.equal(view.schemaVersion, 'murph.age.research-calculator-view.v3')
    assert.equal(view.researchOnly, true)
    assert.equal(view.product.productUseAuthorized, false)
    assert.equal(view.status, 'ready')
    assert.equal(view.mode, 'research')
    assert.equal(view.displayStatus, 'research-only')
    assert.equal(view.selectedCardId, 'lab5_bp_bmi_transport_research')
    assert.equal(view.model.currentModelFamily, 'frozen-nhis-r399-plus-research-increments')
    assert.equal(view.model.scoreInterpretation, 'risk-age-equivalent-research-only')
    assert.equal(view.model.selectedResearchCardId, 'lab5_bp_bmi_transport_research')
    assert.equal(view.model.productUseAuthorized, false)
    assert.equal(view.product.ageDisplayReady, false)
    assert.equal(view.product.riskDisplayReady, false)
    assert.equal(
      view.model.blockers.join('|'),
      'biomarker-transport-not-confirmed|wearable-increment-not-validated|product-use-not-authorized',
    )
    assert.equal(view.model.functionDisability.currentUse, 'context-only-diagnostic-sidecar')
    assert.equal(view.model.functionDisability.nextAction, 'fresh-source-feasibility-before-promotion')
    assert.equal(view.model.functionDisability.scoreBearing, false)
    assert.equal(view.model.labBody.currentUse, 'score-bearing-research-when-selected')
    assert.equal(view.model.labBody.nextAction, 'validate-transport-before-product-use')
    assert.equal(view.model.labBody.transportStatus, 'internal-promising-transport-not-confirmed')
    assert.equal(
      view.model.scoreBearingFeatureKeys.join('|'),
      'creatinine|hba1c|hdl-c|triglycerides|systolic-blood-pressure|diastolic-blood-pressure|bmi',
    )
    assert.equal(view.model.scoreBearingMetricKeys.join('|'), view.selectedScoreBearingMetricKeys.join('|'))
    assert.equal(
      view.model.scoreBearingMetricKeys.join('|'),
      'creatinine|hba1c|hdl-c|triglycerides|systolic-blood-pressure|diastolic-blood-pressure|bmi',
    )
    assert.equal(view.model.wearable.currentUse, 'context-only-shadow')
    assert.equal(view.model.wearable.scoreBearing, false)
    assert.equal(view.model.wearable.scoreContributionAuthorized, false)
    assert.equal(view.model.wearable.consumerValidationStatus, 'missing')
    assert.equal(view.model.wearable.shadowEvidenceConclusion, 'public_activity_shadow_signal_mixed_keep_wearable_context_only')
    assert.equal(view.model.wearable.externalConsumerLabWearableAggregateStillMissing, true)
    assert.equal(view.model.wearable.usableAsConsumerWearableValidation, false)
    assert.equal(view.model.wearable.nextAction, 'run_external_or_partner_lab_wearable_aggregate_delta')
    assert.equal(
      view.model.wearable.nextExternalOrPartnerRouteIdsByPriority.join('|'),
      'cardia-biomarker-activity|hchs-sol-biomarker-activity|all-of-us-fitbit-labs-ehr|uk-biobank-integrated',
    )
    assert.equal(
      view.model.wearable.shadowEvidencePacketIds.join('|'),
      'r1065-nhanes-wrist-activity-shadow-loop|r1066-nhanes-wrist-activity-robustness-loop|r1067-nhanes-wrist-final-stress-test|r1038-nhanes-modern-lab-activity-loop|r1049-nhanes-activity-control-diagnostic',
    )
    assert.equal(view.model.contextOnlyMetricKeys.includes('steps'), true)
    assert.equal(typeof view.ageEstimate?.biologicalAgeYears, 'number')
    assert.equal(typeof view.risk.probability, 'number')
    assert.equal(view.featureContributions.some((feature) => feature.metricKey === 'hba1c'), true)
    assert.equal(view.featureContributions.some((feature) => feature.metricKey === 'steps'), false)
    assert.equal(view.domainContributions.some((module) => module.moduleId === 'unknown'), true)
    assert.equal(view.wearable.scoreBearing, false)
    assert.equal(view.wearable.readyFeatureKeys.includes('activity-volume'), true)

    const encodedView = JSON.stringify(view)
    for (const forbidden of [
      artifactRoot,
      payloadPath,
      'private metric',
      'fixture-lab5-research-model',
      'fasting',
      'manual-cuff',
      'metric-point:',
      '"value"',
      '"unit"',
      '"label"',
      '"message"',
      '"path"',
      'selectedPointIds',
      'coefficient',
      'contributionLogit',
      'prediction',
    ]) {
      assert.equal(encodedView.includes(forbidden), false, forbidden)
    }
  } finally {
    await rm(artifactRoot, { force: true, recursive: true })
    await rm(payloadRoot, { force: true, recursive: true })
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
      wearablePoint('wearable-valid-day-count-28d', null, 25, 'count'),
      wearablePoint('wearable-valid-night-count-28d', null, 21, 'count'),
      wearablePoint('wearable-coverage-index', null, 0.86, 'ratio'),
      wearablePoint('total-sleep-minutes', null, 450, 'minutes'),
      wearablePoint('sleep-duration-variability-minutes', null, 38, 'minutes'),
      wearablePoint('sleep-regularity-score', null, 0.72, 'score'),
      wearablePoint('sleep-midpoint-variability-minutes', null, 45, 'minutes'),
    ])

    const readiness = requireData(await runSliceCli<MurphAgeInputReadinessReport>([
      'age',
      'inputs',
      '--vault',
      vaultRoot,
      '--as-of',
      '2026-05-10T00:00:00.000Z',
    ]))

    assert.equal(readiness.schemaVersion, 'murph.age.input-readiness.v5')
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
    assert.deepEqual(readiness.scoreReadiness, {
      bundleId: 'lab9-bp-body',
      contextOnly: false,
      inputReady: true,
      productAgePolicyReady: false,
      productBlockedReasons: [
        'PRODUCT_POLICY_NOT_AUTHORIZED',
        'VALIDATION_GATE_BLOCKED',
        'PRODUCT_PROMOTION_EVIDENCE_MISSING',
        'PRODUCT_PROMOTION_EVIDENCE_TIER_MISSING',
        'RISK_TO_AGE_DISPLAY_NOT_AUTHORIZED',
      ],
      productPromotionBlockers: [
        'PRODUCT_POLICY_NOT_AUTHORIZED',
        'VALIDATION_GATE_BLOCKED',
        'PRODUCT_PROMOTION_EVIDENCE_MISSING',
        'PRODUCT_PROMOTION_EVIDENCE_TIER_MISSING',
        'RISK_TO_AGE_DISPLAY_NOT_AUTHORIZED',
      ],
      productRiskPolicyReady: false,
      recommendedCardId: 'lab9_bp_body_10y_acm_research',
      researchModelCardRequired: true,
      researchReadiness: 'ready-if-local-model-card-loaded',
      researchUsableIfModelLoaded: true,
      scoreBearingInput: true,
      status: 'research-ready-product-blocked',
    })
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
    assert.equal(readiness.wearableBridge.scoreBearing, false)
    assert.equal(readiness.wearableBridge.scoreContributionAuthorized, false)
    assert.equal(readiness.wearableBridge.productAuthorized, false)
    assert.equal(readiness.wearableBridge.readyFeatureKeys.includes('activity-volume'), true)
    assert.equal(readiness.wearableBridge.features.some((feature) =>
      feature.featureKey === 'activity-volume'
        && feature.readyMetricKeys.includes('steps')
        && feature.status === 'ready'
        && feature.scoreBearing === false
        && feature.scoreContributionAuthorized === false
        && feature.productAuthorized === false
        && feature.riskEffect === 'not-estimated'
        && feature.uncertaintyAction === 'context-only'
    ), true)
    assert.equal(readiness.wearableShadow.schemaVersion, 'murph.age.wearable-shadow-readiness.v1')
    assert.equal(readiness.wearableShadow.anchor.anchorCardId, 'lab9_bp_body_10y_acm_research')
    assert.equal(readiness.wearableShadow.anchor.bundleId, 'lab9-bp-body')
    assert.deepEqual(readiness.wearableShadow.blockedFamilies, [])
    assert.equal(readiness.wearableShadow.readyFamilies.includes('activity'), true)
    assert.equal(readiness.wearableShadow.readyFamilies.includes('sleep'), true)
    assert.equal(readiness.wearableShadow.readyFamilies.includes('resting-heart-rate'), true)
    assert.equal(readiness.wearableShadow.readyFamilies.includes('hrv'), true)
    assert.equal(readiness.wearableShadow.assessments.every((assessment) =>
      assessment.scoreBearing === false
        && assessment.scoreContributionAuthorized === false
        && assessment.productAuthorized === false
        && assessment.riskEffect === 'not-estimated'
        && assessment.outputBoundary.aggregateOnly === true
        && assessment.outputBoundary.coefficientsExportAllowed === false
        && assessment.outputBoundary.participantLevelExportAllowed === false
        && assessment.outputBoundary.predictionsExportAllowed === false
        && assessment.outputBoundary.productDisplayExportAllowed === false
        && assessment.outputBoundary.rowValuesExportAllowed === false
    ), true)
    const activityShadow = readiness.wearableShadow.assessments.find((assessment) => assessment.family === 'activity')
    assert.equal(activityShadow?.status, 'ready')
    assert.equal(activityShadow?.scoreBearing, false)
    assert.equal(activityShadow?.scoreContributionAuthorized, false)
    assert.equal(activityShadow?.productAuthorized, false)
    assert.equal(activityShadow?.riskEffect, 'not-estimated')
    assert.equal(activityShadow?.selectedMetricKeys.includes('steps'), true)
    assert.equal(activityShadow?.selectedMetricKeys.includes('wearable-coverage-index'), true)
    assert.equal(activityShadow?.outputBoundary.aggregateOnly, true)
    assert.equal(activityShadow?.outputBoundary.rowValuesExportAllowed, false)

    const encodedReadiness = JSON.stringify(readiness)
    for (const forbidden of [
      'selectedPointIds',
      'metric-point:',
      '"value"',
      '"unit"',
      '"message"',
      'modelId',
      '"coefficient"',
      'biologicalAgeYears',
      'featureAttributions',
      'moduleAttributions',
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

    assert.equal(readiness.schemaVersion, 'murph.age.input-readiness.v5')
    assert.deepEqual(readiness.runtimeInputs.map((input) => input.key), ['chronological-age-years', 'sex'])
    assert.equal(readiness.bundle.bundleId, 'insufficient')
    assert.equal(readiness.bundle.status, 'abstain')
    assert.equal(readiness.bundle.recommendedCardId, 'none')
    assert.deepEqual(readiness.scoreReadiness, {
      bundleId: 'insufficient',
      contextOnly: false,
      inputReady: false,
      productAgePolicyReady: false,
      productBlockedReasons: ['INPUT_BUNDLE_INCOMPLETE'],
      productPromotionBlockers: [],
      productRiskPolicyReady: false,
      recommendedCardId: 'none',
      researchModelCardRequired: false,
      researchReadiness: 'input-incomplete',
      researchUsableIfModelLoaded: false,
      scoreBearingInput: false,
      status: 'input-incomplete',
    })
    assert.deepEqual(readiness.bundle.availableFeatureKeys, [])
    assert.deepEqual(readiness.bundle.selectedMetricKeys, [])
    assert.equal(readiness.contextBundles.length, 0)
    assert.deepEqual(readiness.wearableBridge.readyFeatureKeys, [])
    assert.equal(readiness.wearableBridge.scoreBearing, false)
    assert.equal(readiness.wearableBridge.scoreContributionAuthorized, false)
    assert.equal(readiness.wearableBridge.productAuthorized, false)
    assert.equal(readiness.wearableShadow.anchor.anchorCardId, null)
    assert.equal(readiness.wearableShadow.anchor.bundleId, 'insufficient')
    assert.deepEqual(readiness.wearableShadow.readyFamilies, [])
    assert.deepEqual(readiness.wearableShadow.blockedFamilies, [
      'activity',
      'sleep',
      'resting-heart-rate',
      'hrv',
    ])
    assert.equal(readiness.wearableShadow.assessments.every((assessment) =>
      assessment.scoreBearing === false
        && assessment.scoreContributionAuthorized === false
        && assessment.productAuthorized === false
    ), true)

    const encodedReadiness = JSON.stringify(readiness)
    for (const forbidden of [
      'selectedPointIds',
      'metric-point:',
      '"value"',
      '"unit"',
      '"message"',
      'modelId',
      '"coefficient"',
      'biologicalAgeYears',
      'featureAttributions',
      'moduleAttributions',
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
    assert.equal(report.schemaVersion, 'murph.age.public-calculator-report.v4')
    assert.equal(report.status, 'abstain')
    assert.equal(report.result, null)
    assert.equal(report.inputReadiness.bundle.bundleId, 'lab9-bp-body')
    assert.equal(report.inputReadiness.bundle.selectedMetricKeys.includes('hba1c'), true)
    assert.equal(report.inputReadiness.contextBundles[0]?.bundleId, 'wearable-context')
    assert.equal(report.inputReadiness.contextBundles[0]?.selectedMetricKeys.includes('steps'), true)
    assert.equal(report.researchCandidateCards.length, 3)
    const lab9Candidate = report.researchCandidateCards.find((candidate) =>
      candidate.cardId === 'lab9_bp_body_10y_acm_research'
    )
    assert.ok(lab9Candidate)
    assert.equal(lab9Candidate.selected, true)
    assert.equal(lab9Candidate.modelLoaded, false)
    assert.equal(lab9Candidate.inputStatus, 'ready')
    assert.equal(lab9Candidate.blockerCodes.includes('LOCAL_MODEL_CARD_NOT_LOADED'), true)
    assert.equal(lab9Candidate.blockerCodes.includes('PRODUCT_MODE_RESEARCH_ONLY'), true)
    assert.equal(lab9Candidate.selectedMetricKeys.includes('hba1c'), true)
    assert.equal(hasOwnKey(lab9Candidate, 'selectedPointIds'), false)
    const withPrivateBundleList = (
      key: 'availableFeatureKeys' | 'missingFeatureKeys' | 'selectedMetricKeys',
      value: string,
    ) => ({
      ...report,
      inputReadiness: {
        ...report.inputReadiness,
        bundle: {
          ...report.inputReadiness.bundle,
          [key]: [value],
        },
      },
    })
    const withPrivateBundleFeatureStatus = (
      patch: Partial<MurphAgePublicCalculatorReport['inputReadiness']['bundle']['featureStatuses'][number]>,
    ) => ({
      ...report,
      inputReadiness: {
        ...report.inputReadiness,
        bundle: {
          ...report.inputReadiness.bundle,
          featureStatuses: report.inputReadiness.bundle.featureStatuses.map((feature, index) => index === 0
            ? {
              ...feature,
              ...patch,
            }
            : feature),
        },
      },
    })
    const withPrivateContextFeatureStatus = (
      patch: Partial<MurphAgePublicCalculatorReport['inputReadiness']['bundle']['featureStatuses'][number]>,
    ) => ({
      ...report,
      inputReadiness: {
        ...report.inputReadiness,
        contextBundles: report.inputReadiness.contextBundles.map((bundle, index) => index === 0
          ? {
            ...bundle,
            featureStatuses: bundle.featureStatuses.map((feature, featureIndex) => featureIndex === 0
              ? {
                ...feature,
                ...patch,
              }
              : feature),
          }
          : bundle),
      },
    })
    const withPrivateReadinessWarning = () => ({
      ...report,
      inputReadiness: {
        ...report.inputReadiness,
        bundle: {
          ...report.inputReadiness.bundle,
          warnings: [{
            code: 'MODEL_FEATURE_MISSING',
            featureKey: 'private-model-feature',
            metricKey: 'private-metric-key',
          }],
        },
      },
    })
    const withPrivateResearchCandidateList = (
      key: 'availableFeatureKeys' | 'missingFeatureKeys' | 'selectedMetricKeys',
      value: string,
    ) => ({
      ...report,
      researchCandidateCards: report.researchCandidateCards.map((candidate, index) => index === 0
        ? {
          ...candidate,
          [key]: [value],
        }
        : candidate),
    })
    const withPrivateResearchCandidateWarning = () => ({
      ...report,
      researchCandidateCards: report.researchCandidateCards.map((candidate, index) => index === 0
        ? {
          ...candidate,
          warnings: [{
            code: 'MODEL_FEATURE_MISSING',
            featureKey: 'private-model-feature',
            metricKey: 'private-metric-key',
          }],
        }
        : candidate),
    })
    for (const invalidPublicReadinessReport of [
      withPrivateBundleList('availableFeatureKeys', 'private-model-feature'),
      withPrivateBundleList('missingFeatureKeys', 'private-model-feature'),
      withPrivateBundleList('selectedMetricKeys', 'private-metric-key'),
      withPrivateBundleFeatureStatus({ featureKey: 'private-model-feature' }),
      withPrivateContextFeatureStatus({ metricKeys: ['private-metric-key'] }),
      withPrivateContextFeatureStatus({ selectedMetricKey: 'private-metric-key' }),
      withPrivateReadinessWarning(),
      withPrivateResearchCandidateList('availableFeatureKeys', 'private-model-feature'),
      withPrivateResearchCandidateList('missingFeatureKeys', 'private-model-feature'),
      withPrivateResearchCandidateList('selectedMetricKeys', 'private-metric-key'),
      withPrivateResearchCandidateWarning(),
    ]) {
      assert.equal(murphAgeReportResultSchema.safeParse(invalidPublicReadinessReport).success, false)
    }
    assert.equal(report.authorization.productAuthorized, false)
    assert.equal(report.displaySummary.schemaVersion, 'murph.age.public-display-summary.v4')
    assert.equal(report.displaySummary.displayBlockedReason, 'product-not-authorized')
    assert.equal(report.displaySummary.displayStatus, 'abstain')
    assert.equal(report.displaySummary.validationGate?.status, 'blocked')
    assert.equal(
      report.displaySummary.validationGate?.summary,
      MURPH_AGE_PUBLIC_VALIDATION_GATE_SUMMARY_TEXT.blocked,
    )
    assert.equal(report.displaySummary.productPromotionBlockers.includes('PRODUCT_POLICY_NOT_AUTHORIZED'), true)
    assert.equal(report.displaySummary.productPromotionBlockers.includes('PRODUCT_PROMOTION_EVIDENCE_MISSING'), true)
    assert.equal(report.displaySummary.wearableBridge.productAuthorized, false)
    assert.equal(report.warnings.some((warning) => warning.code === 'MODEL_CARD_NOT_AUTHORIZED'), true)
    assert.equal(hasOwnKey(report, 'bundleAssessment'), false)
    assert.equal(hasOwnKey(report, 'contextAssessments'), false)
    assert.equal(hasOwnKey(report, 'wearableShadowIncrementAssessments'), false)

    const encodedReport = JSON.stringify(report)
    for (const forbidden of [
      'metric-point:',
      'selectedPointIds',
      '"value"',
      '"unit"',
      '"label"',
      '"message"',
      '"path"',
      'fixture-lab9-research-model',
      'modelId',
      'coefficient',
      'referenceRiskCurve',
      'biologicalAgeYears',
      'ageDeltaYears',
    ]) {
      assert.equal(encodedReport.includes(forbidden), false, forbidden)
    }
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
    assert.equal(report.displaySummary.validationGate?.status, 'blocked')
    assert.equal(
      report.displaySummary.validationGate?.summary,
      MURPH_AGE_PUBLIC_VALIDATION_GATE_SUMMARY_TEXT.blocked,
    )
    assert.equal(report.displaySummary.productPromotionBlockers.includes('RISK_TO_AGE_DISPLAY_NOT_AUTHORIZED'), true)
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
    const selectedCandidate = report.researchCandidateCards.find((candidate) => candidate.selected)
    assert.equal(selectedCandidate?.cardId, 'lab9_bp_body_10y_acm_research')
    assert.equal(selectedCandidate?.modelLoaded, true)
    assert.equal(selectedCandidate?.blockerCodes.length, 0)

    const firstAttribution = report.result?.featureAttributions[0]
    assert.equal(firstAttribution ? hasOwnKey(firstAttribution, 'selectedPointIds') : true, false)
    assert.equal(firstAttribution ? hasOwnKey(firstAttribution, 'value') : true, false)
    assert.equal(hasOwnKey(report, 'bundleAssessment'), false)
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
  }
})

test('age report can explicitly select the R399 NHIS proxy anchor card', async () => {
  const vaultRoot = await createProjectionVault()
  try {
    await rebuildQueryProjection(vaultRoot)
    insertMetricPoints(vaultRoot, [
      ...r399ProxyMetricPoints(),
      ...wearableContextMetricPoints(),
      wearablePoint('wearable-valid-day-count-28d', null, 25, 'count'),
      wearablePoint('wearable-coverage-index', null, 0.86, 'ratio'),
    ])
    await writeLocalModelCardArtifact(vaultRoot, 'r399.json', {
      cardId: 'r399_nhis_proxy_10y_acm_research',
      model: fixtureR399ProxyResearchModel(),
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
      '52',
      '--sex',
      'female',
      '--mode',
      'research',
      '--card-id',
      'r399_nhis_proxy_10y_acm_research',
    ]))

    assert.equal(report.mode, 'research')
    assert.equal(report.status, 'ready')
    assert.equal(report.inputReadiness.bundle.bundleId, 'r399-nhis-proxy-anchor')
    assert.equal(report.authorization.cardId, 'r399_nhis_proxy_10y_acm_research')
    assert.equal(report.authorization.productAuthorized, false)
    assert.equal(report.authorization.riskToAgeDisplayAuthorized, false)
    assert.equal(report.displaySummary.displayStatus, 'research-only')
    assert.equal(report.displaySummary.contextOnlyMetricKeys.includes('steps'), true)
    assert.equal(report.displaySummary.selectedScoreBearingMetricKeys.includes('bmi'), true)
    assert.equal(report.displaySummary.selectedScoreBearingMetricKeys.includes('self-rated-health'), true)
    assert.equal(report.result?.authorization.cardId, 'r399_nhis_proxy_10y_acm_research')
    assert.equal(report.result?.authorization.evidenceClass, 'research-internal')
    assert.equal(report.result?.featureAttributions.some((feature) => feature.metricKey === 'bmi'), true)
    assert.equal(report.result?.featureAttributions.some((feature) => feature.metricKey === 'self-rated-health'), true)
    assert.equal(report.result?.featureAttributions.some((feature) => feature.metricKey === 'steps'), false)
    assert.equal(report.result?.featureAttributions.some((feature) => feature.status === 'imputed'), true)
    assert.equal(hasOwnKey(report, 'bundleAssessment'), false)

    const encodedReport = JSON.stringify(report)
    for (const forbidden of [
      'metric-point:',
      'selectedPointIds',
      '"value"',
      '"unit"',
      '"label"',
      '"message"',
      'fixture-r399-proxy-anchor-model',
      'modelId',
      'coefficient',
      'referenceRiskCurve',
    ]) {
      assert.equal(encodedReport.includes(forbidden), false, forbidden)
    }
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

test('age report resolves common analyte-only lab names from JSON imports', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-age-cli-analyte-alias-')
  const payloadPath = path.join(parentRoot, 'blood-panel.json')
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

    await writeFile(
      payloadPath,
      JSON.stringify({
        occurredAt: '2026-05-01T08:00:00.000Z',
        title: 'Function Health panel',
        testName: 'functional_health_panel',
        labName: 'Function Health',
        fastingStatus: 'fasting',
        results: [
          { analyte: 'Albumin', value: 4.4, unit: 'g/dL' },
          { analyte: 'Creatinine', value: 0.9, unit: 'mg/dL' },
          { analyte: 'HbA1c', value: 5.1, unit: 'percent' },
          { analyte: 'Alkaline phosphatase', value: 70, unit: 'U/L' },
          { analyte: 'White blood cell count (WBC)', value: 5.6, unit: '10^3/uL' },
          { analyte: 'Lymphocyte pct', value: 32, unit: 'percent' },
          { analyte: 'Red cell distribution width (RDW)', value: 12.6, unit: 'percent' },
          { analyte: 'HDL-C', value: 62, unit: 'mg/dL' },
          { analyte: 'Triglycerides', value: 90, unit: 'mg/dL' },
        ],
      }),
      'utf8',
    )

    const bloodTestResult = await runInProcessJsonCli(cli, [
      'blood-test',
      'import-json',
      '--input',
      `@${payloadPath}`,
      '--vault',
      vaultRoot,
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

    assert.equal(report.status, 'ready')
    assert.equal(report.inputReadiness.bundle.bundleId, 'lab9-bp-body')
    assert.equal(report.displaySummary.displayStatus, 'research-only')
    for (const metricKey of [
      'albumin',
      'hba1c',
      'alkaline-phosphatase',
      'white-blood-cell-count',
      'lymphocyte-percentage',
      'red-cell-distribution-width',
    ]) {
      assert.equal(
        report.displaySummary.selectedScoreBearingMetricKeys.includes(metricKey),
        true,
        metricKey,
      )
    }
    assert.equal(report.result?.featureAttributions.some((feature) => feature.metricKey === 'hba1c'), true)
    assert.equal(hasOwnKey(report, 'bundleAssessment'), false)
  } finally {
    await rm(parentRoot, { force: true, recursive: true })
  }
})

test('age report falls back to the Lab5 transport bundle from analyte-only imports', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-age-cli-lab5-fallback-')
  const payloadPath = path.join(parentRoot, 'partial-blood-panel.json')
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

    await writeFile(
      payloadPath,
      JSON.stringify({
        occurredAt: '2026-05-01T08:00:00.000Z',
        title: 'Partial clinical panel',
        testName: 'partial_clinical_panel',
        labName: 'Local lab',
        fastingStatus: 'fasting',
        results: [
          { analyte: 'HbA1c', value: 5.2, unit: 'percent' },
          { analyte: 'HDL-C', value: 58, unit: 'mg/dL' },
          { analyte: 'Triglycerides', value: 105, unit: 'mg/dL' },
          { analyte: 'Creatinine', value: 0.92, unit: 'mg/dL' },
        ],
      }),
      'utf8',
    )

    const bloodTestResult = await runInProcessJsonCli(cli, [
      'blood-test',
      'import-json',
      '--input',
      `@${payloadPath}`,
      '--vault',
      vaultRoot,
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
      '119',
      '--unit',
      'mmHg',
      '--metric',
      'diastolic-blood-pressure',
      '--value',
      '76',
      '--unit',
      'mmHg',
      '--metric',
      'bmi',
      '--value',
      '24.2',
      '--unit',
      'kg/m2',
    ])
    requireData(measurementResult.envelope)

    await rebuildQueryProjection(vaultRoot)
    await writeLocalModelCardArtifact(vaultRoot, 'lab5.json', {
      cardId: 'lab5_bp_bmi_transport_research',
      model: fixtureLab5ResearchModel(),
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

    assert.equal(report.status, 'ready')
    assert.equal(report.inputReadiness.bundle.bundleId, 'lab5-bp-bmi')
    assert.equal(report.inputReadiness.bundle.recommendedCardId, 'lab5_bp_bmi_transport_research')
    assert.equal(report.displaySummary.displayStatus, 'research-only')
    assert.equal(report.result?.authorization.evidenceClass, 'research-transport')
    assert.equal(report.result?.authorization.cardId, 'lab5_bp_bmi_transport_research')
    for (const metricKey of [
      'hba1c',
      'hdl-c',
      'triglycerides',
      'creatinine',
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
    assert.equal(report.displaySummary.selectedScoreBearingMetricKeys.includes('albumin'), false)
    assert.equal(report.result?.featureAttributions.some((feature) => feature.metricKey === 'hba1c'), true)
    assert.equal(report.result?.featureAttributions.some((feature) => feature.metricKey === 'albumin'), false)
    for (const attribution of report.result?.featureAttributions ?? []) {
      assert.equal(hasOwnKey(attribution, 'selectedPointIds'), false, attribution.featureKey)
      assert.equal(hasOwnKey(attribution, 'value'), false, attribution.featureKey)
      assert.equal(hasOwnKey(attribution, 'canonicalValue'), false, attribution.featureKey)
    }
    assert.equal(hasOwnKey(report, 'bundleAssessment'), false)
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
  artifactRoot?: string,
): Promise<void> {
  const root = artifactRoot ?? defaultMurphAgeModelCardArtifactRoot(vaultRoot)
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

function r399ProxyMetricPoints(): MetricPoint[] {
  return [
    measurementPoint('bmi', null, 24.2, 'kg/m^2'),
    metricPoint({
      effectiveDate: '2026-05-08',
      id: 'metric-point:self-rated-health:2026-05-08:survey:0',
      metricKey: 'self-rated-health',
      observedAt: '2026-05-08T08:00:00.000Z',
      recordId: 'survey_self_rated_health',
      sourceKind: 'survey-response',
      unit: 'score',
      value: 2,
    }),
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

function fixtureLab5ResearchModel(): MurphAgeRiskModel {
  return {
    ...fixtureLab9ResearchModel(),
    features: [
      { coefficient: 0.055, key: 'age', kind: 'chronological-age', label: 'Age' },
      { coefficient: 0.12, key: 'male', kind: 'sex', label: 'Male', sex: 'male' },
      labFeature('creatinine', 'Creatinine', 'creatinine', 0.08, 0.9, 0.2, 'mg/dL'),
      labFeature('hba1c', 'HbA1c', 'hba1c', 0.12, 5.4, 0.5, 'percent'),
      labFeature('hdl-c', 'HDL-C', 'hdl-c', -0.08, 55, 15, 'mg/dL'),
      labFeature('triglycerides', 'Triglycerides', 'triglycerides', 0.08, 120, 50, 'mg/dL'),
      labFeature('systolic-blood-pressure', 'Systolic blood pressure', 'systolic-blood-pressure', 0.1, 120, 15, 'mmHg'),
      labFeature('diastolic-blood-pressure', 'Diastolic blood pressure', 'diastolic-blood-pressure', 0.04, 75, 10, 'mmHg'),
      labFeature('bmi', 'BMI', 'bmi', 0.08, 25, 4, 'kg/m^2'),
    ],
    modelId: 'fixture-lab5-research-model',
  }
}

function fixtureR399ProxyResearchModel(): MurphAgeRiskModel {
  return {
    endpoint: '10-year all-cause mortality',
    features: [
      {
        coefficient: 0.035,
        key: 'age',
        kind: 'chronological-age',
        label: 'Age',
        moduleId: 'demographics',
        transform: { clamp: { max: 3, min: -3 }, kind: 'z-score', mean: 52, standardDeviation: 14 },
      },
      {
        coefficient: 0.01,
        key: 'age-squared',
        kind: 'chronological-age-squared',
        label: 'Age squared',
        moduleId: 'demographics',
        transform: { clamp: { max: 3, min: -3 }, kind: 'z-score', mean: 2900, standardDeviation: 1400 },
      },
      {
        coefficient: -0.12,
        key: 'female',
        kind: 'sex',
        label: 'Female',
        moduleId: 'demographics',
        sex: 'female',
      },
      {
        coefficient: -0.02,
        key: 'age-x-female',
        kind: 'age-sex-interaction',
        label: 'Age by female',
        moduleId: 'demographics',
        sex: 'female',
        transform: { clamp: { max: 3, min: -3 }, kind: 'z-score', mean: 27, standardDeviation: 25 },
      },
      {
        coefficient: 0.05,
        expectedUnit: 'kg/m^2',
        key: 'bmi',
        kind: 'metric',
        label: 'BMI',
        metricKey: 'bmi',
        missingValue: 27,
        moduleId: 'body',
        required: false,
        transform: { clamp: { max: 3, min: -3 }, kind: 'z-score', mean: 27, standardDeviation: 5 },
      },
      {
        coefficient: 0.02,
        key: 'bmi-missing',
        kind: 'metric-missingness',
        label: 'BMI missing',
        metricKey: 'bmi',
        moduleId: 'data-quality',
      },
      {
        coefficient: 0.09,
        key: 'self-rated-health',
        kind: 'metric',
        label: 'Self-rated health',
        metricKey: 'self-rated-health',
        missingValue: 3,
        moduleId: 'function',
        required: false,
        transform: { clamp: { max: 3, min: -3 }, kind: 'z-score', mean: 3, standardDeviation: 1 },
      },
      {
        coefficient: 0.03,
        key: 'self-rated-health-missing',
        kind: 'metric-missingness',
        label: 'Self-rated health missing',
        metricKey: 'self-rated-health',
        moduleId: 'data-quality',
      },
      {
        coefficient: 0.06,
        key: 'smoking-status',
        kind: 'metric',
        label: 'Smoking status',
        metricKey: 'smoking-status-proxy',
        missingValue: 1,
        moduleId: 'behavior',
        required: false,
        transform: { clamp: { max: 3, min: -3 }, kind: 'z-score', mean: 1, standardDeviation: 0.8 },
      },
      {
        coefficient: 0.02,
        key: 'smoking-status-missing',
        kind: 'metric-missingness',
        label: 'Smoking status missing',
        metricKey: 'smoking-status-proxy',
        moduleId: 'data-quality',
      },
    ],
    horizonYears: 10,
    intercept: -4.4,
    modelId: 'fixture-r399-proxy-anchor-model',
    modelVersion: 'test.0',
    referencePopulation: 'fixture NHIS proxy reference curve',
    referenceRiskCurve: [
      { ageYears: 20, riskProbability: 0.01 },
      { ageYears: 40, riskProbability: 0.03 },
      { ageYears: 60, riskProbability: 0.1 },
      { ageYears: 80, riskProbability: 0.3 },
    ],
    uncertainty: {
      baseYears: 2,
      perMissingOptionalFeatureYears: 0.5,
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
