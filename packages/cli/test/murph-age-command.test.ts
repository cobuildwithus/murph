import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Cli } from 'incur'
import { test } from 'vitest'
import { CURRENT_VAULT_FORMAT_VERSION } from '@murphai/contracts'
import {
  METRIC_POINT_SCHEMA_VERSION,
  normalizeMetricValue,
  type MetricPoint,
} from '@murphai/health-metrics'
import {
  MURPH_AGE_INCREMENT_EVALUATION_CARD_SCHEMA_VERSION,
  MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
  MURPH_AGE_PUBLIC_VALIDATION_GATE_SUMMARY_TEXT,
  MURPH_AGE_RESEARCH_CALCULATOR_VIEW_SCHEMA_VERSION,
  MURPH_AGE_SUBMITTED_CALCULATOR_CAPABILITY_SCHEMA_VERSION,
  MURPH_AGE_SUBMITTED_CALCULATOR_VIEW_BUNDLE_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_SCHEMA_VERSION,
  MURPH_AGE_WEARABLE_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION,
  listMurphAgeSubmittedCalculatorInputBundleSpecs,
  listMurphAgeSubmittedCalculatorMetricInputSpecs,
  type MurphAgePublicCalculatorReport,
  type MurphAgePublicCalculatorView,
  type MurphAgePublicDisplaySummary,
  type MurphAgeResearchCalculatorView,
  type MurphAgeRiskModel,
  type MurphAgeSubmittedCalculatorViewBundle,
  type MurphAgeWearableResidualParameterPack,
} from '@murphai/health-metrics/murph-age'
import { rebuildQueryProjection } from '@murphai/query'
import { defaultMurphAgeModelCardArtifactRoot } from '@murphai/query/murph-age'
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
  murphAgeAggregateEvidenceStatusResultSchema,
  murphAgeCalculatorViewResultSchema,
  murphAgePublicCalculatorViewResultSchema,
  murphAgeResearchCalculatorViewResultSchema,
  murphAgeSubmittedCalculatorViewBundleResultSchema,
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
  registerMeasurementCommands(cli)
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

interface MurphAgeAggregateEvidenceStatusReport {
  assessments: Array<{
    blockers: string[]
    layer: string | null
    routeId: string | null
    status: string
    validationStatus: string
    warningCodes: string[]
    warningCount: number
  }>
  benchmarkCards: Array<{
    accelerometryProtocol: string
    architecturePattern: string
    benchmarkId: string
    benchmarkStatus: string
    denominatorPolicy: {
      adultAgeRangeYears: {
        max: number
        min: number
      }
      eligibleLinkedMortalityRequired: boolean
      labBodyAnchorDenominatorRequired: boolean
      objectiveActivityWindowRequired: boolean
      publicUseRowsOnly: boolean
      sameDenominatorRequired: boolean
    }
    endpoint: {
      endpointFamily: string
      horizonYears: number
      indexDateRule: string
      outcomeAscertainment: string
      washoutDays: number
    }
    evidenceClass: string
    featureFamilies: string[]
    measurementMethod: string
    modelLadder: Array<{
      modelId: string
      role: string
    }>
    outputBoundary: {
      aggregateOnly: boolean
      coefficientsExportAllowed: boolean
      localArtifactPathExportAllowed: boolean
      modelParametersExportAllowed: boolean
      participantIdentifiersExportAllowed: boolean
      participantLevelExportAllowed: boolean
      predictionsExportAllowed: boolean
      productDisplayExportAllowed: boolean
      rowValuesExportAllowed: boolean
      sourceTextExportAllowed: boolean
      splitMembershipExportAllowed: boolean
    }
    productAuthorized: boolean
    rowParsingAuthorized: boolean
    schemaVersion: string
    scoreBearing: boolean
    scoreContributionAuthorized: boolean
    sourceRouteId: string
    splitPolicy: {
      aggregateSplitCountsExportOnly: boolean
      participantIdsExportAllowed: boolean
      splitMembershipExportAllowed: boolean
    }
    transformIds: string[]
  }>
  blockedReceiptCount: number
  inputCardCount: number
  missingSourceRouteIds: string[]
  nextExecutionSourceRouteIds: string[]
  nextMissingSourceRouteIds: string[]
  nsrrDatasetRequests: Array<{
    datasetId: string
    includeInLeanRequest: boolean
    productAuthorized: boolean
    recommendedDownloadTargets: string[]
    requestCheckboxLabel: string
    requestPriorityRank: number
    rowParsingAuthorized: boolean
    sourceRouteId: string
  }>
  readyCardCount: number
  readySourceRouteIds: string[]
  receiptScienceReviewReadyCount: number
  receiptScienceReviewReadySourceRouteIds: string[]
  receiptScienceReviewStatus: string
  receiptSummaries: Array<{
    blockers: string[]
    conclusion: string
    denominator: {
      evaluatedRowCount: number | null
      eventCount: number | null
      minimumCellCount: number | null
    }
    m1ToM5Deltas: {
      aucDelta: number | null
      brierDelta: number | null
      cIndexDelta: number | null
      logLossDelta: number | null
    } | null
    m2ToM5Deltas: {
      aucDelta: number | null
      brierDelta: number | null
      cIndexDelta: number | null
      logLossDelta: number | null
    } | null
    modelIdsPresent: string[]
    productAuthorized: boolean
    receiptSchemaVersion: string
    reviewGptRequired: boolean
    scoreBearingPromotionAuthorized: boolean
    sourceRouteId: string | null
    validationStatus: string
    warningCodes: string[]
    warningCount: number
    wearableScoreBearingAuthorized: boolean
  }>
  receiptSlots: Array<{
    denominator: {
      minimumEventCountForScienceDelta: number
      requiredFields: string[]
      smallCellSuppressionRequired: boolean
    }
    endpoint: {
      acceptedEndpointFamilies: string[]
      acceptedOutcomeAscertainments: string[]
      outcomeLinkedRequired: boolean
    }
    evaluatorFrozenBeforeExecutionRequired: boolean
    metricFields: string[]
    modelIds: string[]
    negativeControlFields: string[]
    productAuthorized: boolean
    receiptSchemaVersion: string
    sameDenominatorRequired: boolean
    schemaVersion: string
    scoreBearing: boolean
    scoreContributionAuthorized: boolean
    sourceRouteAliases: string[]
    sourceRouteId: string
  }>
  routeSlots: Array<{
    acceptedAggregateMetricDeltaFields: string[]
    anchorCardId: string
    candidateBatchId: string
    candidateId: string
    layer: string
    requiredAggregateSampleFields: string[]
    sourceRouteId: string
  }>
  schemaVersion: string
  sourceRouteIdsByExecutionPriority: string[]
  status: string
  validNoDeltaReceiptCount: number
  validNoDeltaReceiptSourceRouteIds: string[]
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
  inputBundleSpecs: Array<{
    bundleId: string
    completion: {
      alternativeFeatureKeyGroups: string[][]
      minReadyFeatureCount: number | null
      requiredFeatureKeys: string[]
      rule: string
    }
    featureSpecs: Array<{
      featureKey: string
      metricKeys: string[]
      requiredForCompletion: boolean
    }>
    productScoreBearingAuthorized: boolean
    researchAgeEstimateEligible: boolean
    scoreBearing: boolean
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

test('age evidence validates aggregate receipts without exposing unsafe receipt details', async () => {
  const templateStatus = requireData(await runSliceCli<MurphAgeAggregateEvidenceStatusReport>([
    'age',
    'evidence',
    '--include-benchmark-cards',
    'true',
    '--include-templates',
    'true',
  ]))

  assert.equal(templateStatus.schemaVersion, 'murph.age.aggregate-evidence-status.v7')
  murphAgeAggregateEvidenceStatusResultSchema.parse(templateStatus)
  assert.equal(templateStatus.status, 'blocked')
  assert.equal(templateStatus.inputCardCount, 0)
  assert.equal(templateStatus.readyCardCount, 0)
  assert.equal(templateStatus.receiptScienceReviewStatus, 'no-receipts')
  assert.equal(templateStatus.receiptScienceReviewReadyCount, 0)
  assert.deepEqual(templateStatus.receiptScienceReviewReadySourceRouteIds, [])
  assert.equal(templateStatus.validNoDeltaReceiptCount, 0)
  assert.deepEqual(templateStatus.validNoDeltaReceiptSourceRouteIds, [])
  assert.equal(templateStatus.blockedReceiptCount, 0)
  assert.deepEqual(templateStatus.receiptSummaries, [])
  assert.deepEqual(templateStatus.nsrrDatasetRequests, [])
  assert.deepEqual(templateStatus.nextExecutionSourceRouteIds, [
    'nhanes-activity-shadow-lmf',
    'all-of-us-fitbit-labs-ehr',
    'mipact-apple-watch-ehr',
  ])
  assert.equal(templateStatus.sourceRouteIdsByExecutionPriority[0], 'nhanes-activity-shadow-lmf')
  assert.equal(templateStatus.benchmarkCards.length, 2)
  assert.equal(templateStatus.benchmarkCards[0]?.schemaVersion, 'murph.age.wearable-activity-benchmark-card.v1')
  assert.equal(templateStatus.benchmarkCards[0]?.benchmarkId, 'nhanes_2003_06_hip_activity_lmf_v1')
  assert.equal(templateStatus.benchmarkCards[0]?.accelerometryProtocol, 'nhanes-2003-2006-hip-am7164-waking-7d')
  assert.equal(templateStatus.benchmarkCards[0]?.sourceRouteId, 'nhanes-activity-shadow-lmf')
  assert.equal(templateStatus.benchmarkCards[0]?.architecturePattern, 'anchor-plus-wearable-residual-shadow')
  assert.equal(templateStatus.benchmarkCards[0]?.measurementMethod, 'research-actigraphy')
  assert.equal(templateStatus.benchmarkCards[0]?.denominatorPolicy.publicUseRowsOnly, true)
  assert.equal(templateStatus.benchmarkCards[0]?.denominatorPolicy.objectiveActivityWindowRequired, true)
  assert.equal(templateStatus.benchmarkCards[0]?.endpoint.endpointFamily, 'all-cause-mortality')
  assert.equal(templateStatus.benchmarkCards[0]?.endpoint.horizonYears, 10)
  assert.equal(templateStatus.benchmarkCards[0]?.outputBoundary.rowValuesExportAllowed, false)
  assert.equal(templateStatus.benchmarkCards[0]?.outputBoundary.predictionsExportAllowed, false)
  assert.equal(templateStatus.benchmarkCards[0]?.outputBoundary.coefficientsExportAllowed, false)
  assert.equal(templateStatus.benchmarkCards[0]?.outputBoundary.modelParametersExportAllowed, false)
  assert.equal(templateStatus.benchmarkCards[0]?.outputBoundary.localArtifactPathExportAllowed, false)
  assert.equal(templateStatus.benchmarkCards[0]?.productAuthorized, false)
  assert.equal(templateStatus.benchmarkCards[0]?.scoreBearing, false)
  assert.equal(templateStatus.benchmarkCards[0]?.scoreContributionAuthorized, false)
  assert.equal(templateStatus.benchmarkCards[0]?.rowParsingAuthorized, false)
  assert.equal(templateStatus.benchmarkCards[0]?.modelLadder.at(-1)?.modelId, 'm5-residualized-wearable-after-controls')
  assert.equal(templateStatus.benchmarkCards[0]?.featureFamilies.includes('activity-volume'), true)
  assert.equal(templateStatus.benchmarkCards[0]?.featureFamilies.includes('wearable-coverage-quality'), true)
  assert.equal(templateStatus.benchmarkCards[0]?.transformIds.includes('coverage-quality-control'), true)
  assert.equal(templateStatus.benchmarkCards[0]?.splitPolicy.aggregateSplitCountsExportOnly, true)
  assert.equal(templateStatus.benchmarkCards[0]?.splitPolicy.participantIdsExportAllowed, false)
  assert.equal(templateStatus.benchmarkCards[0]?.splitPolicy.splitMembershipExportAllowed, false)
  assert.equal(templateStatus.benchmarkCards[1]?.benchmarkId, 'nhanes_2011_14_wrist_activity_lmf_v1')
  assert.equal(templateStatus.benchmarkCards[1]?.accelerometryProtocol, 'nhanes-2011-2014-wrist-gt3x-plus-24h-7d')
  const encodedBenchmarkCards = JSON.stringify(templateStatus.benchmarkCards)
  for (const forbidden of [
    '"coefficients":',
    'localPath',
    '"participantIds":',
    '"predictions":',
    '"rowValues":',
    '"sourceText":',
    'splitMembership":[',
  ]) {
    assert.equal(encodedBenchmarkCards.includes(forbidden), false, forbidden)
  }
  assert.equal(templateStatus.routeSlots.length > 0, true)
  assert.equal(
    templateStatus.routeSlots.some((slot) => slot.sourceRouteId === 'cardia-biomarker-activity'),
    true,
  )
  assert.equal(
    templateStatus.routeSlots.some((slot) => slot.layer === 'wearable-shadow-increment'),
    true,
  )
  const cardiaBiomarkerSlot = templateStatus.routeSlots.find((slot) =>
    slot.sourceRouteId === 'cardia-biomarker-activity' &&
    slot.layer === 'biomarker-increment'
  )
  assert.equal(cardiaBiomarkerSlot?.anchorCardId, 'r399_nhis_proxy_10y_acm_research')
  assert.equal(cardiaBiomarkerSlot?.candidateBatchId, 'ordinary-lab-wearable-aggregate-v1')
  assert.equal(
    cardiaBiomarkerSlot?.candidateId,
    'cardia-biomarker-activity-biomarker-increment',
  )
  assert.equal(templateStatus.receiptSlots.length > 0, true)
  const allOfUsReceiptSlot = templateStatus.receiptSlots.find((slot) =>
    slot.sourceRouteId === 'all-of-us-fitbit-labs-ehr'
  )
  assert.equal(allOfUsReceiptSlot?.schemaVersion, 'murph.age.wearable-lab-aggregate-receipt-template.v1')
  assert.equal(allOfUsReceiptSlot?.receiptSchemaVersion, MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_SCHEMA_VERSION)
  assert.deepEqual(allOfUsReceiptSlot?.sourceRouteAliases, ['all_of_us_workbench_aggregate'])
  assert.deepEqual(allOfUsReceiptSlot?.modelIds, [
    'm0-anchor-only',
    'm1-anchor-plus-lab-body-bp',
    'm2-coverage-device-ehr-density-control',
    'm3-wearable-residual',
    'm4-wearable-plus-coverage',
    'm5-residualized-wearable-after-controls',
  ])
  assert.equal(allOfUsReceiptSlot?.denominator.minimumEventCountForScienceDelta, 100)
  assert.equal(allOfUsReceiptSlot?.denominator.smallCellSuppressionRequired, true)
  assert.equal(allOfUsReceiptSlot?.endpoint.outcomeLinkedRequired, true)
  assert.equal(allOfUsReceiptSlot?.evaluatorFrozenBeforeExecutionRequired, true)
  assert.equal(allOfUsReceiptSlot?.sameDenominatorRequired, true)
  assert.equal(allOfUsReceiptSlot?.productAuthorized, false)
  assert.equal(allOfUsReceiptSlot?.scoreBearing, false)
  assert.equal(allOfUsReceiptSlot?.scoreContributionAuthorized, false)
  assert.equal(allOfUsReceiptSlot?.metricFields.includes('logLoss'), true)
  assert.equal(allOfUsReceiptSlot?.negativeControlFields.includes('coverageOnlyBeatenByResidualWearable'), true)
  assert.equal(allOfUsReceiptSlot?.endpoint.acceptedEndpointFamilies.includes('all-cause-mortality'), true)
  assert.equal(allOfUsReceiptSlot?.endpoint.acceptedOutcomeAscertainments.includes('ehr-event'), true)

  const nsrrStatus = requireData(await runSliceCli<MurphAgeAggregateEvidenceStatusReport>([
    'age',
    'evidence',
    '--include-nsrr-requests',
    'true',
  ]))
  assert.equal(nsrrStatus.schemaVersion, 'murph.age.aggregate-evidence-status.v7')
  murphAgeAggregateEvidenceStatusResultSchema.parse(nsrrStatus)
  assert.equal(nsrrStatus.receiptScienceReviewStatus, 'no-receipts')
  assert.equal(nsrrStatus.receiptScienceReviewReadyCount, 0)
  assert.deepEqual(nsrrStatus.receiptScienceReviewReadySourceRouteIds, [])
  assert.equal(nsrrStatus.validNoDeltaReceiptCount, 0)
  assert.deepEqual(nsrrStatus.validNoDeltaReceiptSourceRouteIds, [])
  assert.equal(nsrrStatus.blockedReceiptCount, 0)
  assert.deepEqual(nsrrStatus.receiptSummaries, [])
  assert.deepEqual(nsrrStatus.nsrrDatasetRequests.map((request) => request.datasetId), [
    'mesa-sleep',
    'hchs-sol',
    'shhs',
    'mros-sleep',
    'sof-sleep',
    'wsc',
    'haassa',
  ])
  assert.deepEqual(
    nsrrStatus.nsrrDatasetRequests
      .filter((request) => request.includeInLeanRequest)
      .map((request) => request.datasetId),
    ['mesa-sleep', 'hchs-sol', 'shhs', 'mros-sleep', 'sof-sleep'],
  )
  assert.equal(nsrrStatus.nsrrDatasetRequests[0]?.requestCheckboxLabel, 'Multi-Ethnic Study of Atherosclerosis')
  assert.deepEqual(nsrrStatus.nsrrDatasetRequests[0]?.recommendedDownloadTargets, ['mesa/datasets', 'mesa/actigraphy'])
  assert.equal(nsrrStatus.nsrrDatasetRequests[0]?.sourceRouteId, 'nsrr-mesa-sleep-autonomic')
  assert.equal(nsrrStatus.nsrrDatasetRequests.every((request) => request.productAuthorized === false), true)
  assert.equal(nsrrStatus.nsrrDatasetRequests.every((request) => request.rowParsingAuthorized === false), true)

  const payloadRoot = await mkdtemp(path.join(os.tmpdir(), 'murph-age-cli-evidence-'))
  try {
    const receiptPath = path.join(payloadRoot, 'receipts.json')
    await writeFile(receiptPath, `${JSON.stringify({
      receipts: [
        aggregateEvidenceReceipt({
          candidateId: 'cardia-biomarker-activity-biomarker-increment',
          layer: 'biomarker-increment',
          sourceRouteId: 'cardia-biomarker-activity',
        }),
        wearableLabAggregateReceipt({
          receiptId: 'all-of-us-fitbit-lab-wearable-aggregate-v0',
          sourceRouteId: 'all_of_us_workbench_aggregate',
        }),
        {
          ...wearableLabAggregateReceipt({
            receiptId: 'unsafe-all-of-us-fitbit-lab-wearable-aggregate-v0',
            sourceRouteId: 'all_of_us_workbench_aggregate',
          }),
          productAuthorized: true,
          denominator: {
            evaluatedRowCount: -12_400,
            eventCount: -130,
            minimumCellCount: -25,
            personYears: -96_000,
            suppressedCellCount: -1,
          },
          rowValues: ['unsafe-receipt-row-value'],
          models: wearableLabAggregateReceipt({
            receiptId: 'unsafe-all-of-us-fitbit-lab-wearable-aggregate-v0',
            sourceRouteId: 'all_of_us_workbench_aggregate',
          }).models.map((model) =>
            model.modelId === 'm0-anchor-only'
              ? {
                ...model,
                metrics: {
                  ...model.metrics,
                  coefficients: ['unsafe-receipt-coefficient'],
                  participantIds: ['unsafe-receipt-participant'],
                  predictions: ['unsafe-receipt-prediction'],
                },
              }
              : model
          ),
          privateLocalPath: '/tmp/unsafe-receipt-local-path',
        },
        {
          ...aggregateEvidenceReceipt({
            candidateId: 'hchs-sol-biomarker-activity-wearable-shadow-increment',
            layer: 'wearable-shadow-increment',
            sourceRouteId: 'hchs-sol-biomarker-activity',
          }),
          participantIds: ['synthetic-participant'],
          evaluation: {
            ...aggregateEvidenceReceipt({
              candidateId: 'hchs-sol-biomarker-activity-wearable-shadow-increment',
              layer: 'wearable-shadow-increment',
              sourceRouteId: 'hchs-sol-biomarker-activity',
            }).evaluation,
            aggregateMetricDeltas: {
              aucDelta: 0.002,
              coefficients: [0.1],
            },
            aggregateSample: {
              evaluatedRowCount: 320,
              eventCount: 32,
              minimumCellCount: 16,
              rowValues: [1],
            },
            splitMembership: ['synthetic-split'],
          },
          outputBoundary: {
            ...aggregateEvidenceReceipt({
              candidateId: 'hchs-sol-biomarker-activity-wearable-shadow-increment',
              layer: 'wearable-shadow-increment',
              sourceRouteId: 'hchs-sol-biomarker-activity',
            }).outputBoundary,
            localPath: '/tmp/synthetic',
          },
        },
        aggregateEvidenceReceipt({
          candidateId: 'spoofed-mipact-apple-watch-ehr-biomarker-increment',
          layer: 'biomarker-increment',
          sourceRouteId: 'mipact-apple-watch-ehr',
        }),
      ],
    }, null, 2)}\n`)

    const status = requireData(await runSliceCli<MurphAgeAggregateEvidenceStatusReport>([
      'age',
      'evidence',
      '--input',
      `@${receiptPath}`,
      '--include-templates',
      'true',
    ]))

    assert.equal(status.schemaVersion, 'murph.age.aggregate-evidence-status.v7')
    murphAgeAggregateEvidenceStatusResultSchema.parse(status)
    assert.equal(status.status, 'ready')
    assert.deepEqual(status.benchmarkCards, [])
    assert.deepEqual(status.nsrrDatasetRequests, [])
    assert.equal(status.inputCardCount, 5)
    assert.equal(status.readyCardCount, 2)
    assert.deepEqual(status.readySourceRouteIds, ['cardia-biomarker-activity', 'all-of-us-fitbit-labs-ehr'])
    assert.equal(status.receiptScienceReviewStatus, 'science-review-ready')
    assert.equal(status.receiptScienceReviewReadyCount, 1)
    assert.deepEqual(status.receiptScienceReviewReadySourceRouteIds, ['all-of-us-fitbit-labs-ehr'])
    assert.equal(status.validNoDeltaReceiptCount, 0)
    assert.deepEqual(status.validNoDeltaReceiptSourceRouteIds, [])
    assert.equal(status.blockedReceiptCount, 1)
    assert.deepEqual(status.nextExecutionSourceRouteIds, [
      'nhanes-activity-shadow-lmf',
      'mipact-apple-watch-ehr',
      'framingham-activity-cvd',
    ])
    assert.equal(status.nextMissingSourceRouteIds.includes('cardia-biomarker-activity'), false)
    assert.equal(status.missingSourceRouteIds.includes('hchs-sol-biomarker-activity'), true)
    assert.equal(status.missingSourceRouteIds.includes('all-of-us-fitbit-labs-ehr'), false)

    const readyAssessment = status.assessments.find((assessment) =>
      assessment.routeId === 'cardia-biomarker-activity'
    )
    assert.equal(readyAssessment?.status, 'ready')
    assert.deepEqual(readyAssessment?.blockers, [])
    assert.equal(readyAssessment?.warningCount, 0)

    const aggregateReceiptAssessment = status.assessments.find((assessment) =>
      assessment.routeId === 'all-of-us-fitbit-labs-ehr'
    )
    assert.equal(aggregateReceiptAssessment?.status, 'ready')
    assert.equal(aggregateReceiptAssessment?.layer, 'wearable-shadow-increment')
    assert.deepEqual(aggregateReceiptAssessment?.blockers, [])
    assert.equal(status.receiptSummaries.length, 2)
    const aggregateReceiptSummary = status.receiptSummaries[0]
    assert.equal(aggregateReceiptSummary?.sourceRouteId, 'all-of-us-fitbit-labs-ehr')
    assert.equal(aggregateReceiptSummary?.conclusion, 'reviewgpt-science-delta')
    assert.equal(aggregateReceiptSummary?.reviewGptRequired, true)
    assert.equal(aggregateReceiptSummary?.validationStatus, 'valid')
    assert.deepEqual(aggregateReceiptSummary?.blockers, [])
    assert.equal(aggregateReceiptSummary?.denominator.eventCount, 130)
    assert.equal(
      aggregateReceiptSummary?.m1ToM5Deltas?.logLossDelta !== null
        && aggregateReceiptSummary?.m1ToM5Deltas?.logLossDelta !== undefined
        && Math.abs(aggregateReceiptSummary.m1ToM5Deltas.logLossDelta + 0.008) < 1e-12,
      true,
    )
    assert.equal(
      aggregateReceiptSummary?.m2ToM5Deltas?.brierDelta !== null
        && aggregateReceiptSummary?.m2ToM5Deltas?.brierDelta !== undefined
        && Math.abs(aggregateReceiptSummary.m2ToM5Deltas.brierDelta + 0.0018) < 1e-12,
      true,
    )
    assert.equal(aggregateReceiptSummary?.productAuthorized, false)
    assert.equal(aggregateReceiptSummary?.scoreBearingPromotionAuthorized, false)
    assert.equal(aggregateReceiptSummary?.wearableScoreBearingAuthorized, false)
    const unsafeAggregateReceiptSummary = status.receiptSummaries[1]
    assert.equal(unsafeAggregateReceiptSummary?.sourceRouteId, 'all-of-us-fitbit-labs-ehr')
    assert.equal(unsafeAggregateReceiptSummary?.conclusion, 'blocked')
    assert.equal(unsafeAggregateReceiptSummary?.reviewGptRequired, false)
    assert.equal(unsafeAggregateReceiptSummary?.validationStatus, 'invalid')
    assert.deepEqual(unsafeAggregateReceiptSummary?.blockers, ['receipt_invalid'])
    assert.deepEqual(unsafeAggregateReceiptSummary?.denominator, {
      evaluatedRowCount: null,
      eventCount: null,
      minimumCellCount: null,
    })
    assert.equal(unsafeAggregateReceiptSummary?.m1ToM5Deltas, null)
    assert.equal(unsafeAggregateReceiptSummary?.m2ToM5Deltas, null)
    assert.deepEqual(unsafeAggregateReceiptSummary?.modelIdsPresent, [])
    assert.equal(unsafeAggregateReceiptSummary?.productAuthorized, false)
    assert.equal(
      unsafeAggregateReceiptSummary?.receiptSchemaVersion,
      MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_SCHEMA_VERSION,
    )
    assert.equal(unsafeAggregateReceiptSummary?.scoreBearingPromotionAuthorized, false)
    assert.equal(unsafeAggregateReceiptSummary?.wearableScoreBearingAuthorized, false)

    const blockedAssessment = status.assessments.find((assessment) =>
      assessment.routeId === 'hchs-sol-biomarker-activity'
    )
    assert.equal(blockedAssessment?.status, 'blocked')
    assert.equal(blockedAssessment?.blockers.includes('increment_evaluation_card_invalid'), true)
    assert.equal(blockedAssessment?.warningCodes.includes('MODEL_CARD_POLICY_VIOLATION'), true)

    const templateMismatchAssessment = status.assessments.find((assessment) =>
      assessment.routeId === 'mipact-apple-watch-ehr'
    )
    assert.equal(templateMismatchAssessment?.status, 'blocked')
    assert.equal(
      templateMismatchAssessment?.blockers.includes('route_slot_template_mismatch'),
      true,
    )

    const encodedStatus = JSON.stringify(status)
    for (const forbidden of [
      'synthetic-participant',
      'synthetic-split',
      'rowValues',
      'coefficients',
      'localPath',
      'privateLocalPath',
      'unsafe-receipt-coefficient',
      'unsafe-receipt-local-path',
      'unsafe-receipt-participant',
      'unsafe-receipt-prediction',
      'unsafe-receipt-row-value',
      payloadRoot,
      receiptPath,
    ]) {
      assert.equal(encodedStatus.includes(forbidden), false, forbidden)
    }

    const validNoDeltaReceiptPath = path.join(payloadRoot, 'valid-no-delta-receipts.json')
    await writeFile(validNoDeltaReceiptPath, `${JSON.stringify({
      receipts: [
        {
          ...wearableLabAggregateReceipt({
            receiptId: 'valid-no-delta-all-of-us-fitbit-lab-wearable-aggregate-v0',
            sourceRouteId: 'all_of_us_workbench_aggregate',
          }),
          denominator: {
            evaluatedRowCount: 12_400,
            eventCount: 90,
            minimumCellCount: 25,
            personYears: 96_000,
            suppressedCellCount: 0,
          },
        },
      ],
    }, null, 2)}\n`)
    const validNoDeltaStatus = requireData(await runSliceCli<MurphAgeAggregateEvidenceStatusReport>([
      'age',
      'evidence',
      '--input',
      `@${validNoDeltaReceiptPath}`,
    ]))
    assert.equal(validNoDeltaStatus.schemaVersion, 'murph.age.aggregate-evidence-status.v7')
    murphAgeAggregateEvidenceStatusResultSchema.parse(validNoDeltaStatus)
    assert.equal(validNoDeltaStatus.status, 'blocked')
    assert.equal(validNoDeltaStatus.receiptScienceReviewStatus, 'valid-no-delta')
    assert.equal(validNoDeltaStatus.receiptScienceReviewReadyCount, 0)
    assert.deepEqual(validNoDeltaStatus.receiptScienceReviewReadySourceRouteIds, [])
    assert.equal(validNoDeltaStatus.validNoDeltaReceiptCount, 1)
    assert.deepEqual(validNoDeltaStatus.validNoDeltaReceiptSourceRouteIds, ['all-of-us-fitbit-labs-ehr'])
    assert.equal(validNoDeltaStatus.blockedReceiptCount, 0)

    const blockedOnlyReceiptPath = path.join(payloadRoot, 'blocked-only-receipts.json')
    await writeFile(blockedOnlyReceiptPath, `${JSON.stringify({
      receipts: [
        {
          ...wearableLabAggregateReceipt({
            receiptId: 'blocked-only-all-of-us-fitbit-lab-wearable-aggregate-v0',
            sourceRouteId: 'all_of_us_workbench_aggregate',
          }),
          productAuthorized: true,
          rowValues: ['blocked-only-unsafe-row-value'],
        },
      ],
    }, null, 2)}\n`)
    const blockedOnlyStatus = requireData(await runSliceCli<MurphAgeAggregateEvidenceStatusReport>([
      'age',
      'evidence',
      '--input',
      `@${blockedOnlyReceiptPath}`,
    ]))
    assert.equal(blockedOnlyStatus.schemaVersion, 'murph.age.aggregate-evidence-status.v7')
    murphAgeAggregateEvidenceStatusResultSchema.parse(blockedOnlyStatus)
    assert.equal(blockedOnlyStatus.status, 'blocked')
    assert.equal(blockedOnlyStatus.receiptScienceReviewStatus, 'blocked')
    assert.equal(blockedOnlyStatus.receiptScienceReviewReadyCount, 0)
    assert.deepEqual(blockedOnlyStatus.receiptScienceReviewReadySourceRouteIds, [])
    assert.equal(blockedOnlyStatus.validNoDeltaReceiptCount, 0)
    assert.deepEqual(blockedOnlyStatus.validNoDeltaReceiptSourceRouteIds, [])
    assert.equal(blockedOnlyStatus.blockedReceiptCount, 1)
    assert.equal(JSON.stringify(blockedOnlyStatus).includes('blocked-only-unsafe-row-value'), false)
  } finally {
    await rm(payloadRoot, { force: true, recursive: true })
  }
})

test('age evidence reports malformed JSON without echoing receipt text', async () => {
  const payloadRoot = await mkdtemp(path.join(os.tmpdir(), 'murph-age-cli-evidence-invalid-'))
  try {
    const receiptPath = path.join(payloadRoot, 'receipts.json')
    await writeFile(receiptPath, '{"participantIds":["synthetic-participant"],')

    const result = await runSliceCliResult<unknown>([
      'age',
      'evidence',
      '--input',
      `@${receiptPath}`,
    ])

    assert.equal(result.exitCode, 1)
    assert.equal(result.envelope.ok, false)
    if (result.envelope.ok) {
      assert.fail('expected malformed evidence input to return an error envelope')
    }
    assert.equal(result.envelope.error.code, 'invalid_payload')
    assert.match(result.envelope.error.message ?? '', /must contain valid JSON/u)

    const encodedEnvelope = JSON.stringify(result.envelope)
    for (const forbidden of [
      'synthetic-participant',
      'participantIds',
      payloadRoot,
      receiptPath,
    ]) {
      assert.equal(encodedEnvelope.includes(forbidden), false, forbidden)
    }
  } finally {
    await rm(payloadRoot, { force: true, recursive: true })
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
  assert.equal(metricKeys.includes('albumin'), true)
  assert.equal(metricKeys.includes('alkaline-phosphatase'), true)
  assert.equal(metricKeys.includes('white-blood-cell-count'), true)
  assert.equal(metricKeys.includes('lymphocyte-percentage'), true)
  assert.equal(metricKeys.includes('red-cell-distribution-width'), true)
  assert.equal(metricKeys.includes('waist-circumference'), true)
  assert.equal(metricKeys.includes('steps'), true)
  assert.equal(metricKeys.includes('activity-minutes'), true)
  assert.equal(metricKeys.includes('mvpa-minutes'), true)
  assert.equal(metricKeys.includes('peak-30-minute-cadence'), true)
  assert.equal(metricKeys.includes('sedentary-minutes'), true)
  assert.equal(metricKeys.includes('total-sleep-minutes'), true)
  assert.equal(metricKeys.includes('deep-sleep-minutes'), true)
  assert.equal(metricKeys.includes('rem-sleep-minutes'), true)
  assert.equal(metricKeys.includes('sleep-duration-variability-minutes'), true)
  assert.equal(metricKeys.includes('sleep-efficiency'), true)
  assert.equal(metricKeys.includes('sleep-regularity-score'), true)
  assert.equal(metricKeys.includes('sleep-score'), true)
  assert.equal(metricKeys.includes('sleep-midpoint-variability-minutes'), true)
  assert.equal(metricKeys.includes('spo2'), true)
  assert.equal(metricKeys.includes('respiratory-rate'), true)
  assert.equal(metricKeys.includes('resting-heart-rate'), true)
  assert.equal(metricKeys.includes('hrv-rmssd'), true)
  assert.equal(metricKeys.includes('readiness-score'), true)
  assert.equal(metricKeys.includes('skin-temperature-deviation'), true)
  assert.equal(metricKeys.includes('estimated-vo2-max'), true)
  assert.equal(metricKeys.includes('wearable_valid_day_count_28d'), true)
  assert.equal(metricKeys.includes('wearable_valid_night_count_28d'), true)
  assert.equal(metricKeys.includes('wearable_coverage_index'), true)
})

test('age submitted preview payload keeps wearable residual family and layer ids paired', () => {
  const basePayload = {
    asOf: '2026-05-10T00:00:00.000Z',
    chronologicalAgeYears: 45,
    sex: 'female',
    submittedMetrics: [
      { metricKey: 'HbA1c', sourceKind: 'test-result', unit: '%', value: 5.4 },
    ],
  }
  const sleepPack = testWearableResidualParameterPack({
    center: 420,
    coefficient: -0.04,
    family: 'sleep',
    layerId: 'sleep-residual-v1',
    metricKey: 'total-sleep-minutes',
    scale: 30,
  })

  assert.equal(murphAgeSubmittedPreviewPayloadSchema.safeParse({
    ...basePayload,
    wearableResidualParameterPacks: [sleepPack],
  }).success, true)
  assert.equal(murphAgeSubmittedPreviewPayloadSchema.safeParse({
    ...basePayload,
    wearableResidualParameterPacks: [{
      ...sleepPack,
      layerId: 'activity-residual-v1',
    }],
  }).success, false)
  assert.equal(murphAgeSubmittedPreviewPayloadSchema.safeParse({
    ...basePayload,
    wearableResidualParameterPack: {
      ...sleepPack,
      layerId: 'activity-residual-v1',
    },
  }).success, false)
  assert.equal(murphAgeSubmittedPreviewPayloadSchema.safeParse({
    ...basePayload,
    wearableResidualParameterPack: {
      ...sleepPack,
      layerId: 'multi-wearable-residual-v1',
    },
  }).success, false)
})

test('age preview scores submitted labs and wearable context without a vault', async () => {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), 'murph-age-cli-model-cards-'))
  const payloadControlledArtifactRoot = await mkdtemp(path.join(os.tmpdir(), 'murph-age-cli-payload-model-cards-'))
  const payloadRoot = await mkdtemp(path.join(os.tmpdir(), 'murph-age-cli-preview-'))
  const payloadPath = path.join(payloadRoot, 'payload.json')
  const functionPayloadPath = path.join(payloadRoot, 'function-payload.json')
  const multiWearablePayloadPath = path.join(payloadRoot, 'multi-wearable-payload.json')
  const productPayloadPath = path.join(payloadRoot, 'product-payload.json')
  const functionPackHash = 'sha256:3333333333333333333333333333333333333333333333333333333333333333'
  const wearablePackHash = 'sha256:2222222222222222222222222222222222222222222222222222222222222222'
  try {
    await writeLocalModelCardArtifact(payloadRoot, 'lab5.json', {
      cardId: 'lab5_bp_bmi_transport_research',
      model: fixtureLab5ResearchModel(),
      schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
    }, artifactRoot)
    await writeFile(path.join(payloadControlledArtifactRoot, 'bad.json'), '{')
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
      wearableResidualParameterPack: {
        anchorCardId: 'lab5_bp_bmi_transport_research',
        calibrationIntercept: 0,
        calibrationSlope: 1,
        deploymentRights: 'research-only',
        endpoint: '10-year all-cause mortality',
        evidenceTier: 'same-family-sanity',
        family: 'activity',
        featureWeights: [{
          center: 8_000,
          coefficient: -0.08,
          metricKey: 'steps',
          scale: 2_000,
          transform: 'center-scale',
        }],
        globalWearableCapLogit: 0.2,
        horizonYears: 10,
        intercept: 0,
        layerId: 'activity-residual-v1',
        packHash: wearablePackHash,
        schemaVersion: 'murph.age.wearable-residual-parameter-pack.v1',
        sourceRouteId: 'nhanes-activity-shadow-lmf',
      },
    }))
    await writeFile(multiWearablePayloadPath, JSON.stringify({
      asOf: '2026-05-10T00:00:00.000Z',
      chronologicalAgeYears: 45,
      sex: 'female',
      submittedMetrics: [
        { metricKey: 'HbA1c', sourceKind: 'test-result', unit: '%', value: 5.3 },
        { metricKey: 'HDL_C', unit: 'mg/dL', value: 60 },
        { metricKey: 'Triglycerides', unit: 'mg/dL', value: 90 },
        { metricKey: 'creatinine', unit: 'mg/dL', value: 0.85 },
        { metricKey: 'SBP', sourceKind: 'measurement', unit: 'mmHg', value: 118 },
        { metricKey: 'diastolic_bp', sourceKind: 'measurement', unit: 'mmHg', value: 72 },
        { metricKey: 'body_mass_index', sourceKind: 'measurement', unit: 'kg/m2', value: 23.2 },
        { metricKey: 'total-sleep-minutes', sourceKind: 'sleep-summary', unit: 'minutes', value: 450 },
        { metricKey: 'wearable_valid_night_count_28d', sourceKind: 'sleep-summary', unit: 'count', value: 22 },
        { metricKey: 'wearable_coverage_index', sourceKind: 'wearable-summary', unit: 'score', value: 0.91 },
        { metricKey: 'resting-heart-rate', sourceKind: 'wearable-summary', unit: 'bpm', value: 54 },
        { metricKey: 'wearable_valid_day_count_28d', sourceKind: 'wearable-summary', unit: 'count', value: 24 },
        { metricKey: 'hrv-rmssd', sourceKind: 'wearable-summary', unit: 'ms', value: 70 },
      ],
      wearableResidualParameterPacks: [
        testWearableResidualParameterPack({
          center: 420,
          coefficient: -0.04,
          family: 'sleep',
          layerId: 'sleep-residual-v1',
          metricKey: 'total-sleep-minutes',
          scale: 30,
        }),
        testWearableResidualParameterPack({
          center: 60,
          coefficient: 0.05,
          family: 'resting-heart-rate',
          layerId: 'resting-heart-rate-residual-v1',
          metricKey: 'resting-heart-rate',
          scale: 10,
        }),
        testWearableResidualParameterPack({
          center: 50,
          coefficient: -0.02,
          family: 'hrv',
          layerId: 'hrv-residual-v1',
          metricKey: 'hrv-rmssd',
          scale: 20,
        }),
      ],
    }))
    await writeFile(functionPayloadPath, JSON.stringify({
      asOf: '2026-05-10T00:00:00.000Z',
      chronologicalAgeYears: 45,
      functionResidualParameterPack: {
        anchorCardId: 'lab5_bp_bmi_transport_research',
        calibrationIntercept: 0,
        calibrationSlope: 1,
        deploymentRights: 'research-only',
        endpoint: '10-year all-cause mortality',
        evidenceTier: 'same-family-sanity',
        featureWeights: [{
          center: 0,
          coefficient: 0.04,
          metricKey: 'iadl-limitation-count',
          scale: 1,
          transform: 'center-scale',
        }, {
          center: 0,
          coefficient: 0.06,
          metricKey: 'mobility-limitation-count',
          scale: 1,
          transform: 'center-scale',
        }],
        globalFunctionCapLogit: 0.2,
        horizonYears: 10,
        intercept: 0,
        layerId: 'function-mobility-residual-v1',
        packHash: functionPackHash,
        schemaVersion: 'murph.age.function-residual-parameter-pack.v1',
        sourceRouteId: 'mhas-harmonized-aging',
      },
      sex: 'female',
      submittedMetrics: [
        { metricKey: 'HbA1c', unit: '%', value: 5.3 },
        { metricKey: 'HDL_C', unit: 'mg/dL', value: 60 },
        { metricKey: 'Triglycerides', unit: 'mg/dL', value: 90 },
        { metricKey: 'creatinine', unit: 'mg/dL', value: 0.85 },
        { metricKey: 'SBP', sourceKind: 'measurement', unit: 'mmHg', value: 118 },
        { metricKey: 'diastolic_bp', sourceKind: 'measurement', unit: 'mmHg', value: 72 },
        { metricKey: 'body_mass_index', sourceKind: 'measurement', unit: 'kg/m2', value: 23.2 },
        { metricKey: 'iadl-limitation-count', sourceKind: 'measurement', unit: 'count', value: 1 },
        { metricKey: 'mobility-limitation-count', sourceKind: 'measurement', unit: 'count', value: 1 },
      ],
    }))
    await writeFile(productPayloadPath, JSON.stringify({
      asOf: '2026-05-10T00:00:00.000Z',
      chronologicalAgeYears: 45,
      modelCardArtifactRoot: payloadControlledArtifactRoot,
      sex: 'female',
      submittedMetrics: [
        { metricKey: 'HbA1c', unit: '%', value: 5.3 },
        { metricKey: 'HDL_C', unit: 'mg/dL', value: 60 },
        { metricKey: 'Triglycerides', unit: 'mg/dL', value: 90 },
        { metricKey: 'creatinine', unit: 'mg/dL', value: 0.85 },
        { metricKey: 'SBP', sourceKind: 'measurement', unit: 'mmHg', value: 118 },
        { metricKey: 'diastolic_bp', sourceKind: 'measurement', unit: 'mmHg', value: 72 },
        { metricKey: 'body_mass_index', sourceKind: 'measurement', unit: 'kg/m2', value: 23.2 },
        { metricKey: 'steps', sourceKind: 'wearable-summary', unit: 'count', value: 10_000 },
        { metricKey: 'wearable_valid_day_count_28d', sourceKind: 'wearable-summary', unit: 'count', value: 22 },
        { metricKey: 'wearable_coverage_index', sourceKind: 'wearable-summary', unit: 'score', value: 0.8 },
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
    const reportResidualLayer = report.wearableResidualLayer
    assert.ok(reportResidualLayer)
    assert.equal(reportResidualLayer.status, 'research-parameterized-shadow-delta')
    assert.equal(reportResidualLayer.parameterPackHash, wearablePackHash)
    assert.equal(reportResidualLayer.residualDeltaLogit, -0.08)
    assert.equal(typeof reportResidualLayer.anchorRiskAgeEquivalentYears, 'number')
    assert.equal(typeof reportResidualLayer.finalRiskAgeEquivalentYears, 'number')
    assert.equal(typeof reportResidualLayer.residualDeltaYears, 'number')
    assert.equal(
      reportResidualLayer.finalRiskAgeEquivalentYears !== null
        && reportResidualLayer.anchorRiskAgeEquivalentYears !== null
        && reportResidualLayer.finalRiskAgeEquivalentYears < reportResidualLayer.anchorRiskAgeEquivalentYears,
      true,
    )
    assert.equal(reportResidualLayer.residualDeltaYears !== null && reportResidualLayer.residualDeltaYears < 0, true)
    assert.equal(reportResidualLayer.scoreBearing, false)
    assert.equal(
      report.displaySummary.wearableBridge.features.find((feature) => feature.featureKey === 'activity-volume')
        ?.measurementMethod,
      'consumer-device',
    )
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
    assert.equal(view.schemaVersion, MURPH_AGE_RESEARCH_CALCULATOR_VIEW_SCHEMA_VERSION)
    assert.equal(view.researchOnly, true)
    assert.equal(view.product.productUseAuthorized, false)
    assert.equal(view.status, 'ready')
    assert.equal(view.mode, 'research')
    assert.equal(view.displayStatus, 'research-only')
    assert.equal(view.selectedCardId, 'lab5_bp_bmi_transport_research')
    assert.equal(
      view.arbiter.strategy,
      'r399-anchor-l1b-current-alpha-lab9-secondary-lab5-transport-l1-glycemia-function-sidecar-wearables-context',
    )
    assert.equal(
      view.arbiter.labConflictPolicy,
      'l1b-current-alpha-lab9-secondary-lab5-transport-l1-glycemia-guard-r399-anchor-fallback',
    )
    assert.equal(view.arbiter.wearableScorePolicy, 'research-residual-shadow-product-blocked')
    assert.equal(view.arbiter.selectedCardRole, 'transport-fallback-and-discordance-guard')
    assert.equal(view.arbiter.selectionReason, 'transport-fallback-selected')
    const viewResidualLayer = view.wearableResidualLayer
    assert.ok(viewResidualLayer)
    assert.equal(viewResidualLayer.status, 'research-parameterized-shadow-delta')
    assert.equal(viewResidualLayer.parameterizationAvailable, true)
    assert.equal(viewResidualLayer.parameterPackHash, wearablePackHash)
    assert.equal(viewResidualLayer.residualDeltaLogit, -0.08)
    assert.equal(viewResidualLayer.anchorRiskAgeEquivalentYears, reportResidualLayer.anchorRiskAgeEquivalentYears)
    assert.equal(viewResidualLayer.finalRiskAgeEquivalentYears, reportResidualLayer.finalRiskAgeEquivalentYears)
    assert.equal(viewResidualLayer.residualDeltaYears, reportResidualLayer.residualDeltaYears)
    assert.equal(viewResidualLayer.scoreBearing, false)
    assert.equal(viewResidualLayer.selectedMetricKeys.includes('steps'), true)
    assert.equal(view.wearable.scorePolicy.productStatus, 'context-only')
    assert.equal(view.wearable.scorePolicy.productWearableMultiplier, 0)
    assert.equal(view.wearable.scorePolicy.residualLayerContract.layerId, 'activity-residual-v1')
    assert.equal(view.wearable.scorePolicy.residualLayerContract.family, 'activity')
    assert.equal(view.wearable.scorePolicy.residualLayerContract.combinationScale, 'logit-residual')
    assert.equal(view.wearable.scorePolicy.residualLayerContract.residualDeltaStatus, 'zero-until-validated')
    assert.equal(view.wearable.scorePolicy.residualLayerContract.signalMetricKeys.includes('steps'), true)
    assert.deepEqual(
      view.wearable.scorePolicy.residualLayerContract.featureSetContract.activityVolumeCandidateMetricKeys,
      ['steps', 'activity-minutes', 'mvpa-minutes', 'peak-30-minute-cadence', 'sedentary-minutes'],
    )
    assert.equal(
      view.wearable.scorePolicy.residualLayerContract.featureSetContract.proprietaryDeviceScoresExcluded,
      true,
    )
    assert.equal(view.wearable.scorePolicy.residualLayerContract.qualityGateMetricKeys.includes('wearable-valid-day-count-28d'), true)
    assert.equal(view.wearable.scorePolicy.residualLayerContract.scoreContributionAuthorized, false)
    assert.equal(view.wearable.scorePolicy.residualLayerContract.parameterPackContract.requiredForResidualScoring, true)
    assert.equal(view.wearable.scorePolicy.residualLayerContract.parameterPackContract.familyPriorityOrder[0], 'activity')
    assert.equal(
      view.wearable.scorePolicy.residualLayerContract.parameterPackContract.emptyPackBehavior,
      'exact-current-zero-delta-behavior',
    )
    assert.equal(
      view.wearable.scorePolicy.residualLayerContract.parameterPackContract.requiredFields.includes('packHash'),
      true,
    )
    const lab5ArbiterCandidate = view.arbiter.candidateCards.find((candidate) =>
      candidate.cardId === 'lab5_bp_bmi_transport_research'
    )
    assert.ok(lab5ArbiterCandidate)
    assert.equal(lab5ArbiterCandidate.role, 'transport-fallback-and-discordance-guard')
    assert.equal(lab5ArbiterCandidate.readyForResearchRun, true)
    assert.equal(lab5ArbiterCandidate.selected, true)
    assert.equal(view.model.currentModelFamily, 'frozen-nhis-r399-plus-research-increments')
    assert.equal(view.model.composition.currentScoringMode, 'selected-card-plus-parameterized-residual-shadow')
    assert.equal(view.model.composition.anchorLayerStatus, 'available-as-research-anchor-and-fallback-not-layered')
    assert.equal(
      view.model.composition.wearableStatus,
      'research-shadow-residual-score-product-blocked',
    )
    assert.equal(view.model.wearable.currentUse, 'research-shadow-residual-score')
    assert.equal(view.model.wearable.researchScoreBearing, true)
    assert.equal(view.model.wearable.scoreBearing, false)
    const wearableResidualFeatureContribution = view.featureContributions.find((feature) =>
      feature.featureKey === 'wearable-multi-family-residual'
    )
    assert.ok(wearableResidualFeatureContribution)
    assert.equal(
      wearableResidualFeatureContribution.contributionYears,
      view.wearableResidualLayer?.residualDeltaYears,
    )
    assert.equal(wearableResidualFeatureContribution.metricKey, null)
    assert.equal(wearableResidualFeatureContribution.moduleId, 'wearable')
    assert.equal(
      view.model.layeredResearchPath.architecturePattern,
      'frozen-r399-anchor-plus-selected-lab-card-plus-function-and-wearable-residuals',
    )
    assert.equal(
      view.model.layeredResearchPath.currentExecutableMode,
      'single-card-plus-parameterized-residual-shadow-score',
    )
    assert.deepEqual(view.model.layeredResearchPath.activeResearchScoreLayerIds, [
      'selected-lab-body-card',
      'wearable-multi-family-residual',
    ])
    assert.deepEqual(view.model.layeredResearchPath.parameterPackBlockedLayerIds, [
      'function-disability-sidecar',
    ])
    assert.equal(view.model.layeredResearchPath.productAuthorized, false)
    assert.equal(view.layeredAgeEstimate?.status, 'wearable-shadow-applied')
    assert.equal(view.layeredAgeEstimate?.basis, 'wearable-shadow-risk-age')
    assert.equal(view.layeredAgeEstimate?.productAuthorized, false)
    assert.equal(view.layeredAgeEstimate?.residualScoreContributionAuthorized, false)
    assert.deepEqual(view.layeredAgeEstimate?.appliedLayerIds, [
      'selected-lab-body-card',
      'wearable-multi-family-residual',
    ])
    assert.equal(view.layeredAgeEstimate?.intervalYears, null)
    assert.equal(view.layeredAgeEstimate?.uncertaintyStatus, 'not-reestimated-for-shadow')
    const functionLayer = view.model.layeredResearchPath.layers.find((layer) =>
      layer.layerId === 'function-disability-sidecar'
    )
    assert.ok(functionLayer)
    assert.equal(functionLayer.status, 'parameter-pack-needed')
    assert.equal(functionLayer.parameterPackRequired, true)
    assert.equal(functionLayer.parameterPackAvailable, false)
    assert.equal(functionLayer.metricKeys.join('|'), 'adl-limitation-count|iadl-limitation-count|mobility-limitation-count|frailty-symptom-count')
    assert.equal(functionLayer.sourceEvidenceIds.join('|'), 'mhas-function-mobility-sidecar-local-run')
    const functionPackView = requireData(await runSliceCli<MurphAgeResearchCalculatorView>([
      'age',
      'preview-view',
      '--input',
      `@${functionPayloadPath}`,
      '--model-card-artifact-root',
      artifactRoot,
    ]))
    assert.equal(murphAgeResearchCalculatorViewResultSchema.safeParse(functionPackView).success, true)
    assert.equal(functionPackView.selectedCardId, 'lab5_bp_bmi_transport_research')
    assert.equal(functionPackView.functionResidualLayer?.status, 'research-parameterized-shadow-delta')
    assert.equal(functionPackView.functionResidualLayer?.parameterPackHash, functionPackHash)
    assert.equal(functionPackView.functionResidualLayer?.residualDeltaLogit, 0.1)
    assert.equal(functionPackView.functionResidualLayer?.scoreBearing, false)
    assert.equal(functionPackView.functionResidualLayer?.scoreContributionAuthorized, false)
    assert.equal(functionPackView.layeredAgeEstimate?.status, 'selected-card-only')
    assert.deepEqual(functionPackView.model.layeredResearchPath.parameterPackBlockedLayerIds, [
      'wearable-multi-family-residual',
    ])
    const encodedFunctionLayer = JSON.stringify(functionPackView.functionResidualLayer)
    for (const forbidden of [
      'coefficient',
      'metric-point:',
      'finalRiskProbability',
      'finalRiskAgeEquivalentYears',
      'anchorRiskAgeEquivalentYears',
    ]) {
      assert.equal(encodedFunctionLayer.includes(forbidden), false, forbidden)
    }
    const multiWearableView = requireData(await runSliceCli<MurphAgeResearchCalculatorView>([
      'age',
      'calculate',
      '--input',
      `@${multiWearablePayloadPath}`,
      '--mode',
      'research',
      '--model-card-artifact-root',
      artifactRoot,
    ]))
    assert.equal(murphAgeResearchCalculatorViewResultSchema.safeParse(multiWearableView).success, true)
    assert.equal(multiWearableView.wearableResidualLayer?.layerId, 'multi-wearable-residual-v1')
    assert.equal(multiWearableView.wearableResidualLayer?.status, 'research-parameterized-shadow-delta')
    assert.equal(multiWearableView.wearableResidualLayer?.residualDeltaLogit, -0.09)
    assert.equal(multiWearableView.wearableResidualLayer?.selectedMetricKeys.includes('total-sleep-minutes'), true)
    assert.equal(multiWearableView.wearableResidualLayer?.selectedMetricKeys.includes('resting-heart-rate'), true)
    assert.equal(multiWearableView.wearableResidualLayer?.selectedMetricKeys.includes('hrv-rmssd'), true)
    assert.equal(multiWearableView.wearableResidualLayer?.scoreBearing, false)
    assert.equal(multiWearableView.wearableResidualLayer?.scoreContributionAuthorized, false)
    assert.equal(
      multiWearableView.model.composition.currentScoringMode,
      'selected-card-plus-parameterized-residual-shadow',
    )
    assert.equal(
      multiWearableView.model.composition.wearableStatus,
      'research-shadow-residual-score-product-blocked',
    )
    assert.equal(multiWearableView.model.wearable.currentUse, 'research-shadow-residual-score')
    assert.equal(multiWearableView.model.wearable.researchScoreBearing, true)
    assert.equal(multiWearableView.model.wearable.scoreBearing, false)
    assert.deepEqual(multiWearableView.model.layeredResearchPath.activeResearchScoreLayerIds, [
      'selected-lab-body-card',
      'wearable-multi-family-residual',
    ])
    assert.equal(
      multiWearableView.model.layeredResearchPath.currentExecutableMode,
      'single-card-plus-parameterized-residual-shadow-score',
    )
    const wearableResidualLayer = multiWearableView.model.layeredResearchPath.layers.find((layer) =>
      layer.layerId === 'wearable-multi-family-residual'
    )
    assert.ok(wearableResidualLayer)
    assert.equal(wearableResidualLayer.status, 'active-research-shadow-score')
    assert.equal(wearableResidualLayer.parameterPackRequired, true)
    assert.equal(wearableResidualLayer.parameterPackAvailable, true)
    assert.equal(wearableResidualLayer.scoreBearingNow, true)
    assert.equal(wearableResidualLayer.scoreContributionAuthorized, false)
    assert.equal(wearableResidualLayer.metricKeys.includes('total-sleep-minutes'), true)
    assert.equal(wearableResidualLayer.metricKeys.includes('resting-heart-rate'), true)
    assert.equal(wearableResidualLayer.metricKeys.includes('hrv-rmssd'), true)
    assert.equal(multiWearableView.model.researchAppliedFeatureKeys.includes('wearable-multi-family-residual'), true)
    assert.equal(multiWearableView.model.researchAppliedMetricKeys.includes('total-sleep-minutes'), true)
    assert.equal(multiWearableView.model.researchAppliedMetricKeys.includes('resting-heart-rate'), true)
    assert.equal(multiWearableView.model.researchAppliedMetricKeys.includes('hrv-rmssd'), true)
    assert.equal(multiWearableView.model.researchAppliedWearableMetricKeys.includes('total-sleep-minutes'), true)
    assert.equal(multiWearableView.model.researchAppliedWearableMetricKeys.includes('wearable-valid-night-count-28d'), true)
    assert.equal(multiWearableView.model.researchAppliedWearableMetricKeys.includes('wearable-coverage-index'), true)
    assert.equal(multiWearableView.model.researchAppliedWearableMetricKeys.includes('resting-heart-rate'), true)
    assert.equal(multiWearableView.model.researchAppliedWearableMetricKeys.includes('wearable-valid-day-count-28d'), true)
    assert.equal(multiWearableView.model.researchAppliedWearableMetricKeys.includes('hrv-rmssd'), true)
    assert.equal(multiWearableView.model.scoreBearingMetricKeys.includes('total-sleep-minutes'), false)
    assert.equal(view.model.scoreInterpretation, 'risk-age-equivalent-research-only')
    assert.equal(view.model.selectedResearchCardId, 'lab5_bp_bmi_transport_research')
    assert.equal(view.model.productUseAuthorized, false)
    assert.equal(view.product.ageDisplayReady, false)
    assert.equal(view.product.riskDisplayReady, false)
    assert.equal(
      view.model.blockers.join('|'),
      'biomarker-transport-not-confirmed|wearable-increment-not-validated|product-use-not-authorized',
    )
    assert.equal(view.model.functionDisability.currentUse, 'hardened-research-lead-sidecar-not-product-age')
    assert.equal(
      view.model.functionDisability.nextAction,
      'parameterize-function-sidecar-for-layered-scoring-then-fresh-validation',
    )
    assert.equal(view.model.functionDisability.scoreBearing, false)
    assert.equal(view.model.labBody.currentUse, 'score-bearing-research-when-selected')
    assert.equal(view.model.labBody.nextAction, 'validate-transport-before-product-use')
    assert.equal(view.model.labBody.transportStatus, 'internal-promising-transport-not-confirmed')
    assert.equal(view.model.latestLocalRunEvidenceStatus, 'mixed-research-only-no-product-promotion')
    assert.equal(
      view.model.latestLocalRunEvidence.map((item) => item.evidenceId).join('|'),
      'midus-lab-lift-local-run|creles-glycemia-transport-local-run|haalsi-glucose-transport-local-run|nshap-hba1c-transport-local-run|mhas-function-mobility-sidecar-local-run|sage-physiology-shadow-local-run|wearables-context-only-local-run',
    )
    assert.equal(
      view.model.latestLocalRunEvidence.find((item) => item.evidenceId === 'midus-lab-lift-local-run')?.signal,
      'weak',
    )
    assert.equal(
      view.model.latestLocalRunEvidence.find((item) => item.evidenceId === 'midus-lab-lift-local-run')?.supportedMetricKeys.join('|'),
      'glucose|egfr|bmi',
    )
    assert.equal(
      view.model.latestLocalRunEvidence.find((item) => item.evidenceId === 'creles-glycemia-transport-local-run')?.signal,
      'weak',
    )
    assert.equal(
      view.model.latestLocalRunEvidence.find((item) => item.evidenceId === 'creles-glycemia-transport-local-run')?.supportedMetricKeys.join('|'),
      'glucose',
    )
    assert.equal(
      view.model.latestLocalRunEvidence.find((item) => item.evidenceId === 'nshap-hba1c-transport-local-run')?.signal,
      'partial',
    )
    assert.equal(
      view.model.latestLocalRunEvidence.find((item) => item.evidenceId === 'nshap-hba1c-transport-local-run')?.supportedMetricKeys.join('|'),
      'hba1c',
    )
    const mhasFunctionSidecarEvidence = view.model.latestLocalRunEvidence.find((item) =>
      item.evidenceId === 'mhas-function-mobility-sidecar-local-run'
    )
    assert.ok(mhasFunctionSidecarEvidence)
    assert.equal(mhasFunctionSidecarEvidence.cohortLabel, 'MHAS')
    assert.equal(mhasFunctionSidecarEvidence.bundleId, 'function-context')
    assert.equal(mhasFunctionSidecarEvidence.sourceRouteId, 'mhas-harmonized-aging')
    assert.equal(mhasFunctionSidecarEvidence.signal, 'supported')
    assert.equal(mhasFunctionSidecarEvidence.scoringMathChanged, false)
    assert.equal(mhasFunctionSidecarEvidence.productAuthorizationChanged, false)
    assert.equal(
      mhasFunctionSidecarEvidence.supportedMetricKeys.join('|'),
      'adl-limitation-count|iadl-limitation-count|mobility-limitation-count|frailty-symptom-count',
    )
    const sagePhysiologyEvidence = view.model.latestLocalRunEvidence.find((item) =>
      item.evidenceId === 'sage-physiology-shadow-local-run'
    )
    assert.ok(sagePhysiologyEvidence)
    assert.equal(sagePhysiologyEvidence.cohortLabel, 'SAGE')
    assert.equal(sagePhysiologyEvidence.sourceRouteId, 'who-sage-south-africa-transport')
    assert.equal(sagePhysiologyEvidence.signal, 'context-only')
    assert.equal(sagePhysiologyEvidence.scoringMathChanged, false)
    assert.equal(sagePhysiologyEvidence.productAuthorizationChanged, false)
    assert.equal(
      sagePhysiologyEvidence.supportedMetricKeys.join('|'),
      'bmi|systolic-blood-pressure|diastolic-blood-pressure|resting-heart-rate|activity-minutes|total-sleep-minutes',
    )
    assert.equal(view.model.latestLocalRunEvidence.every((item) => item.scoringMathChanged === false), true)
    assert.equal(view.model.latestLocalRunEvidence.every((item) => item.productAuthorizationChanged === false), true)
    assert.equal(
      view.model.latestLocalRunEvidence.find((item) => item.evidenceId === 'haalsi-glucose-transport-local-run')?.supportedMetricKeys.join('|'),
      'glucose',
    )
    assert.equal(
      view.model.latestLocalRunEvidence.find((item) => item.evidenceId === 'wearables-context-only-local-run')?.signal,
      'context-only',
    )
    assert.equal(
      view.model.scoreBearingFeatureKeys.join('|'),
      'creatinine|hba1c|hdl-c|triglycerides|systolic-blood-pressure|diastolic-blood-pressure|bmi',
    )
    assert.equal(view.model.scoreBearingMetricKeys.join('|'), view.selectedScoreBearingMetricKeys.join('|'))
    assert.equal(
      view.model.scoreBearingMetricKeys.join('|'),
      'creatinine|hba1c|hdl-c|triglycerides|systolic-blood-pressure|diastolic-blood-pressure|bmi',
    )
    assert.equal(view.model.wearable.currentUse, 'research-shadow-residual-score')
    assert.equal(view.model.wearable.researchScoreBearing, true)
    assert.equal(view.model.wearable.scoreBearing, false)
    assert.equal(view.model.wearable.scoreContributionAuthorized, false)
    assert.equal(view.model.wearable.consumerValidationStatus, 'missing')
    assert.equal(
      view.model.wearable.shadowEvidenceConclusion,
      'public_multi_family_wearable_shadow_signal_mixed_keep_context_only',
    )
    assert.equal(view.model.wearable.externalConsumerLabWearableAggregateStillMissing, true)
    assert.equal(view.model.wearable.usableAsConsumerWearableValidation, false)
    assert.equal(view.model.wearable.nextAction, 'run_external_or_partner_lab_wearable_aggregate_delta')
    assert.equal(
      view.model.wearable.nextExternalOrPartnerRouteIdsByPriority.join('|'),
      'all-of-us-fitbit-labs-ehr|mipact-apple-watch-ehr|framingham-activity-cvd|uk-biobank-integrated|cardia-biomarker-activity|hchs-sol-biomarker-activity|nsrr-mesa-sleep-autonomic|whi-opach-womens-health-activity|nako-accelerometer-biobank|hunt-activity-sensor-biobank|lifelines-activelife-biobank',
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
    assert.equal(view.domainContributions.some((module) => module.moduleId === 'clinical'), true)
    assert.equal(view.domainContributions.some((module) => module.moduleId === 'unknown'), false)
    assert.equal(view.wearable.scoreBearing, false)
    assert.equal(view.wearable.candidateFeatureCount, 9)
    assert.equal(view.wearable.readyFeatureKeys.includes('activity-volume'), true)
    assert.equal(view.wearable.firstPriorityReadyFeatureKeys.includes('activity-volume'), true)
    assert.equal(view.wearable.firstPriorityIncompleteFeatureKeys.includes('actigraphy-activity-counts'), true)
    assert.equal(view.wearable.firstPriorityIncompleteFeatureKeys.includes('sedentary-time'), true)
    assert.equal(view.wearable.secondPriorityIncompleteFeatureKeys.includes('resting-heart-rate'), true)
    assert.equal(view.wearable.deferredFeatureKeys.includes('hrv-rmssd'), true)
    assert.equal(
      view.wearable.features.find((feature) => feature.featureKey === 'activity-volume')?.qualityReady,
      true,
    )

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

    const productCalculatorView = requireData(await runSliceCli<MurphAgePublicCalculatorView>([
      'age',
      'calculate',
      '--input',
      `@${payloadPath}`,
      '--model-card-artifact-root',
      artifactRoot,
    ]))

    assert.equal(murphAgePublicCalculatorViewResultSchema.safeParse(productCalculatorView).success, true)
    assert.equal(murphAgeCalculatorViewResultSchema.safeParse(productCalculatorView).success, true)
    assert.equal(productCalculatorView.schemaVersion, 'murph.age.public-calculator-view.v5')
    assert.equal(productCalculatorView.mode, 'product')
    assert.equal(productCalculatorView.status, 'abstain')
    assert.equal(productCalculatorView.displayCategory, 'abstain')
    assert.equal(productCalculatorView.displayBlockedReason, 'product-not-authorized')
    assert.equal(productCalculatorView.ageEstimate, null)
    assert.equal(productCalculatorView.risk.probability, null)
    assert.equal(productCalculatorView.selectedCardId, null)
    assert.deepEqual(productCalculatorView.selectedScoreBearingMetricKeys, [])
    assert.equal(productCalculatorView.featureDrivers.older.length, 0)
    assert.equal(productCalculatorView.featureDrivers.younger.length, 0)
    assert.equal(productCalculatorView.scoreReadiness.status, 'validation-pending')
    assert.equal(productCalculatorView.scoreReadiness.inputBundleId, 'l1b-glycemia-body')
    assert.equal(productCalculatorView.scoreReadiness.contextBundleIds.includes('wearable-context'), true)
    assert.equal(productCalculatorView.scoreReadiness.riskAvailable, false)
    assert.equal(productCalculatorView.scoreReadiness.biologicalAgeAvailable, false)
    assert.equal(
      productCalculatorView.scoreReadiness.unlockRequirements.includes('external-outcome-validation'),
      true,
    )
    assert.equal(
      productCalculatorView.scoreReadiness.unlockRequirements.includes('validated-wearable-parameter-pack'),
      true,
    )
    assert.equal(productCalculatorView.wearable.scoreBearing, false)
    assert.equal(productCalculatorView.wearable.scorePolicy.productStatus, 'context-only')
    assert.equal(productCalculatorView.wearable.scorePolicy.productWearableMultiplier, 0)
    assert.equal(productCalculatorView.wearable.candidateFeatureCount, 9)
    assert.equal(productCalculatorView.wearable.readyFeatureKeys.includes('activity-volume'), true)
    assert.equal(productCalculatorView.wearable.missingFeatureKeys.includes('actigraphy-activity-counts'), true)
    assert.equal(productCalculatorView.wearable.features.some((feature) => feature.featureKey === 'resting-heart-rate'), true)

    const productCalculatorViewWithPayloadRoot = requireData(await runSliceCli<MurphAgePublicCalculatorView>([
      'age',
      'calculate',
      '--input',
      `@${productPayloadPath}`,
    ]))

    assert.equal(murphAgePublicCalculatorViewResultSchema.safeParse(productCalculatorViewWithPayloadRoot).success, true)
    assert.equal(productCalculatorViewWithPayloadRoot.mode, 'product')
    assert.equal(productCalculatorViewWithPayloadRoot.status, 'abstain')
    assert.equal(
      productCalculatorViewWithPayloadRoot.warnings.some((warning) => warning.code === 'INVALID_INPUT'),
      false,
    )
    assert.equal(JSON.stringify(productCalculatorViewWithPayloadRoot).includes(payloadControlledArtifactRoot), false)

    const previousModelCardArtifactRootEnv = process.env.MURPH_AGE_MODEL_CARD_ARTIFACT_ROOT
    try {
      process.env.MURPH_AGE_MODEL_CARD_ARTIFACT_ROOT = payloadControlledArtifactRoot
      const productCalculatorViewWithAmbientRoot = requireData(await runSliceCli<MurphAgePublicCalculatorView>([
        'age',
        'calculate',
        '--input',
        `@${productPayloadPath}`,
      ]))

      assert.equal(murphAgePublicCalculatorViewResultSchema.safeParse(productCalculatorViewWithAmbientRoot).success, true)
      assert.equal(productCalculatorViewWithAmbientRoot.mode, 'product')
      assert.equal(productCalculatorViewWithAmbientRoot.status, 'abstain')
      assert.equal(
        productCalculatorViewWithAmbientRoot.warnings.some((warning) => warning.code === 'INVALID_INPUT'),
        false,
      )
      assert.equal(JSON.stringify(productCalculatorViewWithAmbientRoot).includes(payloadControlledArtifactRoot), false)
    } finally {
      if (previousModelCardArtifactRootEnv === undefined) {
        delete process.env.MURPH_AGE_MODEL_CARD_ARTIFACT_ROOT
      } else {
        process.env.MURPH_AGE_MODEL_CARD_ARTIFACT_ROOT = previousModelCardArtifactRootEnv
      }
    }

    const productOnlyCalculatorBundle = requireData(await runSliceCli<MurphAgeSubmittedCalculatorViewBundle>([
      'age',
      'calculate-bundle',
      '--input',
      `@${productPayloadPath}`,
    ]))

    assert.equal(
      murphAgeSubmittedCalculatorViewBundleResultSchema.safeParse(productOnlyCalculatorBundle).success,
      true,
    )
    assert.equal(productOnlyCalculatorBundle.schemaVersion, MURPH_AGE_SUBMITTED_CALCULATOR_VIEW_BUNDLE_SCHEMA_VERSION)
    assert.equal(
      productOnlyCalculatorBundle.capabilities.schemaVersion,
      MURPH_AGE_SUBMITTED_CALCULATOR_CAPABILITY_SCHEMA_VERSION,
    )
    assert.deepEqual(productOnlyCalculatorBundle.capabilities.contextBundleIds, [
      'wearable-context',
      'function-context',
    ])
    assert.deepEqual(productOnlyCalculatorBundle.capabilities.scoreBearingBundleIds, [
      'l1b-glycemia-body',
      'lab9-bp-body',
      'lab5-bp-bmi',
      'l1-glycemia',
      'r399-nhis-proxy-anchor',
    ])
    assert.deepEqual(productOnlyCalculatorBundle.capabilities.runtimeInputKeys, [
      'chronological-age-years',
      'sex',
    ])
    assert.equal(productOnlyCalculatorBundle.capabilities.researchPreviewSupported, true)
    assert.equal(productOnlyCalculatorBundle.researchPreview, null)
    assert.equal(productOnlyCalculatorBundle.product.view.mode, 'product')
    assert.equal(productOnlyCalculatorBundle.product.view.status, 'abstain')
    assert.equal(productOnlyCalculatorBundle.product.view.ageEstimate, null)
    assert.equal(productOnlyCalculatorBundle.product.view.risk.probability, null)
    assert.equal(productOnlyCalculatorBundle.product.view.selectedCardId, null)
    assert.equal(
      productOnlyCalculatorBundle.product.view.warnings.some((warning) => warning.code === 'INVALID_INPUT'),
      false,
    )
    assert.equal(JSON.stringify(productOnlyCalculatorBundle).includes(payloadControlledArtifactRoot), false)

    const productCalculatorBundleWithBadRoot = requireData(await runSliceCli<MurphAgeSubmittedCalculatorViewBundle>([
      'age',
      'calculate-bundle',
      '--input',
      `@${productPayloadPath}`,
      '--model-card-artifact-root',
      payloadControlledArtifactRoot,
    ]))

    assert.equal(
      murphAgeSubmittedCalculatorViewBundleResultSchema.safeParse(productCalculatorBundleWithBadRoot).success,
      true,
    )
    assert.equal(productCalculatorBundleWithBadRoot.product.view.mode, 'product')
    assert.equal(productCalculatorBundleWithBadRoot.product.view.status, 'abstain')
    assert.equal(productCalculatorBundleWithBadRoot.researchPreview, null)
    assert.equal(
      productCalculatorBundleWithBadRoot.product.view.warnings.some((warning) => warning.code === 'INVALID_INPUT'),
      true,
    )
    assert.equal(JSON.stringify(productCalculatorBundleWithBadRoot).includes(payloadControlledArtifactRoot), false)
    assert.equal(JSON.stringify(productCalculatorBundleWithBadRoot).includes('"message"'), false)

    const calculatorBundle = requireData(await runSliceCli<MurphAgeSubmittedCalculatorViewBundle>([
      'age',
      'calculate-bundle',
      '--input',
      `@${payloadPath}`,
      '--include-research-preview',
      '--model-card-artifact-root',
      artifactRoot,
    ]))

    assert.equal(
      murphAgeSubmittedCalculatorViewBundleResultSchema.safeParse(calculatorBundle).success,
      true,
    )
    assert.equal(calculatorBundle.schemaVersion, MURPH_AGE_SUBMITTED_CALCULATOR_VIEW_BUNDLE_SCHEMA_VERSION)
    assert.equal(
      calculatorBundle.capabilities.schemaVersion,
      MURPH_AGE_SUBMITTED_CALCULATOR_CAPABILITY_SCHEMA_VERSION,
    )
    assert.equal(calculatorBundle.capabilities.acceptedMetricKeys.includes('hba1c'), true)
    assert.equal(calculatorBundle.capabilities.acceptedMetricKeys.includes('steps'), true)
    assert.equal(calculatorBundle.capabilities.acceptedMetricKeys.includes('respiratory-rate'), true)
    assert.equal(calculatorBundle.capabilities.acceptedMetricKeys.includes('skin-temperature-deviation'), true)
    assert.deepEqual(calculatorBundle.capabilities.acceptedSourceKinds, [
      'activity-summary',
      'measurement',
      'profile',
      'questionnaire',
      'sleep-summary',
      'survey-response',
      'test-result',
      'wearable-summary',
    ])
    assert.deepEqual(calculatorBundle.capabilities.acceptedUserInputFamilies, [
      'demographics-age-sex',
      'bloodwork-common-labs',
      'vitals-body-composition',
      'wearable-activity',
      'wearable-recovery-autonomic',
      'wearable-sleep',
    ])
    assert.equal(calculatorBundle.capabilities.wearableContextMetricKeys.includes('total-sleep-minutes'), true)
    assert.equal(calculatorBundle.capabilities.wearableContextMetricKeys.includes('sleep-score'), true)
    assert.equal(calculatorBundle.capabilities.wearableContextMetricKeys.includes('readiness-score'), true)
    assert.equal(calculatorBundle.capabilities.wearableFirstPriorityFeatureKeys.includes('activity-volume'), true)
    assert.equal(calculatorBundle.capabilities.wearableSecondPriorityFeatureKeys.includes('resting-heart-rate'), true)
    assert.deepEqual(calculatorBundle.capabilities.wearableScoreBearingMetricKeys, [])
    assert.deepEqual(calculatorBundle.capabilities.productScoreBearingMetricKeys, [])
    assert.equal(calculatorBundle.capabilities.productAgeDisplayAuthorized, false)
    assert.equal(calculatorBundle.capabilities.productRiskDisplayAuthorized, false)
    assert.deepEqual(calculatorBundle.inputBundleSpecs, listMurphAgeSubmittedCalculatorInputBundleSpecs())
    assert.deepEqual(calculatorBundle.metricInputSpecs, listMurphAgeSubmittedCalculatorMetricInputSpecs())
    assert.equal(
      calculatorBundle.inputBundleSpecs.some((spec) =>
        spec.bundleId === 'wearable-context' && spec.scoreBearing === false
      ),
      true,
    )
    const submittedMetricSpecByKey = new Map(
      calculatorBundle.metricInputSpecs.map((spec) => [spec.metricKey, spec]),
    )
    assert.deepEqual(
      submittedMetricSpecByKey.get('hba1c')?.researchScoreBearingCardIds,
      [
        'l1b_glycemia_body_10y_acm_research',
        'lab9_bp_body_10y_acm_research',
        'lab5_bp_bmi_transport_research',
        'l1_tiny_glycemia_10y_acm_research',
      ],
    )
    assert.equal(
      submittedMetricSpecByKey.get('albumin')?.researchScoreBearingCardIds.includes(
        'lab9_bp_body_10y_acm_research',
      ),
      true,
    )
    assert.equal(
      submittedMetricSpecByKey.get('creatinine')?.researchScoreBearingCardIds.includes(
        'lab5_bp_bmi_transport_research',
      ),
      true,
    )
    assert.equal(
      submittedMetricSpecByKey.get('resting-heart-rate')?.calculatorRoles.includes('wearable-context'),
      true,
    )
    assert.equal(
      submittedMetricSpecByKey.get('resting-heart-rate')?.wearableScoreBearingAuthorized,
      false,
    )
    for (const spec of calculatorBundle.metricInputSpecs.filter((inputSpec) =>
      inputSpec.calculatorRoles.includes('wearable-context')
    )) {
      assert.deepEqual(spec.researchScoreBearingCardIds, [])
      assert.equal(spec.productScoreBearingAuthorized, false)
      assert.equal(spec.wearableScoreBearingAuthorized, false)
    }
    assert.deepEqual(calculatorBundle.capabilities.outputBoundary, {
      modelParametersExportAllowed: false,
      participantLevelExportAllowed: false,
      productScoreDisplayAuthorized: false,
      researchPreviewRequiresExplicitOptIn: true,
      rowValuesExportAllowed: false,
      submittedMetricScalarEchoAllowed: false,
    })
    assert.equal(calculatorBundle.product.view.mode, 'product')
    assert.equal(calculatorBundle.product.view.status, 'abstain')
    assert.equal(calculatorBundle.product.view.displayBlockedReason, 'product-not-authorized')
    assert.equal(calculatorBundle.product.view.ageEstimate, null)
    assert.equal(calculatorBundle.product.view.risk.probability, null)
    assert.equal(calculatorBundle.product.view.selectedCardId, null)
    assert.equal(calculatorBundle.product.view.scoreReadiness.riskAvailable, false)
    assert.equal(calculatorBundle.product.view.scoreReadiness.biologicalAgeAvailable, false)
    assert.equal(
      calculatorBundle.product.view.scoreReadiness.unlockRequirements.includes('external-outcome-validation'),
      true,
    )
    assert.equal(
      calculatorBundle.product.view.scoreReadiness.unlockRequirements.includes('validated-wearable-parameter-pack'),
      true,
    )
    assert.equal(calculatorBundle.product.view.wearable.scoreBearing, false)
    assert.equal(calculatorBundle.product.view.wearable.readyFeatureKeys.includes('activity-volume'), true)
    assert.ok(calculatorBundle.researchPreview)
    assert.equal(calculatorBundle.researchPreview.view.mode, 'research')
    assert.equal(calculatorBundle.researchPreview.view.status, 'ready')
    assert.equal(calculatorBundle.researchPreview.view.selectedCardId, 'lab5_bp_bmi_transport_research')
    assert.equal(typeof calculatorBundle.researchPreview.view.ageEstimate?.biologicalAgeYears, 'number')
    assert.equal(typeof calculatorBundle.researchPreview.view.risk.probability, 'number')
    assert.equal(calculatorBundle.researchPreview.view.wearable.scoreBearing, false)
    assert.equal(
      calculatorBundle.researchPreview.view.featureContributions.some((feature) => feature.metricKey === 'hba1c'),
      true,
    )
    assert.equal(
      calculatorBundle.researchPreview.view.featureContributions.some((feature) => feature.metricKey === 'steps'),
      false,
    )
    assert.equal(
      calculatorBundle.researchPreview.view.wearableResidualLayer?.parameterPackHash,
      wearablePackHash,
    )

    const encodedCalculatorBundle = JSON.stringify(calculatorBundle)
    for (const forbidden of [
      artifactRoot,
      payloadPath,
      'private metric',
      'fixture-lab5-research-model',
      'fastingStatus',
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
      assert.equal(encodedCalculatorBundle.includes(forbidden), false, forbidden)
    }

    const researchCalculatorView = requireData(await runSliceCli<MurphAgeResearchCalculatorView>([
      'age',
      'calculate',
      '--input',
      `@${payloadPath}`,
      '--mode',
      'research',
      '--model-card-artifact-root',
      artifactRoot,
    ]))

    assert.equal(murphAgeResearchCalculatorViewResultSchema.safeParse(researchCalculatorView).success, true)
    assert.equal(murphAgeCalculatorViewResultSchema.safeParse(researchCalculatorView).success, true)
    assert.equal(researchCalculatorView.schemaVersion, MURPH_AGE_RESEARCH_CALCULATOR_VIEW_SCHEMA_VERSION)
    assert.equal(researchCalculatorView.researchOnly, true)
    assert.equal(researchCalculatorView.mode, 'research')
    assert.equal(researchCalculatorView.status, 'ready')
    assert.equal(researchCalculatorView.selectedCardId, 'lab5_bp_bmi_transport_research')
    assert.equal(typeof researchCalculatorView.ageEstimate?.biologicalAgeYears, 'number')
    assert.equal(typeof researchCalculatorView.risk.probability, 'number')
    assert.equal(researchCalculatorView.featureContributions.some((feature) => feature.metricKey === 'hba1c'), true)
    assert.equal(researchCalculatorView.featureContributions.some((feature) => feature.metricKey === 'steps'), false)
    assert.equal(researchCalculatorView.featureDrivers.younger.some((driver) => driver.metricKey === 'hba1c'), true)
    assert.equal(researchCalculatorView.featureDrivers.older.every((driver) => driver.direction === 'older'), true)
    assert.equal(researchCalculatorView.featureDrivers.younger.every((driver) => driver.direction === 'younger'), true)
    assert.equal(researchCalculatorView.wearable.candidateFeatureCount, 9)
    assert.equal(researchCalculatorView.wearable.readyFeatureKeys.includes('activity-volume'), true)
    assert.equal(researchCalculatorView.wearable.missingFeatureKeys.includes('actigraphy-activity-counts'), true)
    assert.equal(
      researchCalculatorView.wearable.scorePolicy.requiredPromotionSignals.includes(
        'deployable-parameterization-authorized',
      ),
      true,
    )
    assert.equal(researchCalculatorView.wearable.scorePolicy.residualLayerContract.layerId, 'activity-residual-v1')
    assert.equal(researchCalculatorView.wearable.scorePolicy.residualLayerContract.scoreBearing, false)
    assert.equal(researchCalculatorView.wearable.scorePolicy.residualLayerContract.productMultiplier, 0)
    const calculatorResidualLayer = researchCalculatorView.wearableResidualLayer
    assert.ok(calculatorResidualLayer)
    assert.equal(calculatorResidualLayer.status, 'research-parameterized-shadow-delta')
    assert.equal(calculatorResidualLayer.parameterPackHash, wearablePackHash)
    assert.equal(typeof calculatorResidualLayer.anchorRiskAgeEquivalentYears, 'number')
    assert.equal(typeof calculatorResidualLayer.finalRiskAgeEquivalentYears, 'number')
    assert.equal(typeof calculatorResidualLayer.residualDeltaYears, 'number')
    assert.equal(calculatorResidualLayer.scoreBearing, false)
    assert.equal(researchCalculatorView.layeredAgeEstimate?.status, 'wearable-shadow-applied')
    assert.equal(researchCalculatorView.layeredAgeEstimate?.basis, 'wearable-shadow-risk-age')
    assert.equal(
      researchCalculatorView.layeredAgeEstimate?.biologicalAgeYears,
      calculatorResidualLayer.finalRiskAgeEquivalentYears,
    )
    assert.equal(
      researchCalculatorView.ageEstimate?.biologicalAgeYears,
      researchCalculatorView.layeredAgeEstimate?.biologicalAgeYears,
    )
    assert.equal(researchCalculatorView.layeredAgeEstimate?.riskProbability, calculatorResidualLayer.finalRiskProbability)
    assert.equal(researchCalculatorView.risk.probability, calculatorResidualLayer.finalRiskProbability)
    assert.equal(researchCalculatorView.layeredAgeEstimate?.residualDeltaYears, calculatorResidualLayer.residualDeltaYears)
    assert.equal(researchCalculatorView.layeredAgeEstimate?.productAuthorized, false)
    assert.equal(researchCalculatorView.layeredAgeEstimate?.residualScoreContributionAuthorized, false)
    assert.deepEqual(researchCalculatorView.layeredAgeEstimate?.appliedLayerIds, [
      'selected-lab-body-card',
      'wearable-multi-family-residual',
    ])
    const parameterizedWearableLayer = researchCalculatorView.model.layeredResearchPath.layers.find((layer) =>
      layer.layerId === 'wearable-multi-family-residual'
    )
    assert.ok(parameterizedWearableLayer)
    assert.equal(parameterizedWearableLayer.status, 'active-research-shadow-score')
    assert.equal(parameterizedWearableLayer.parameterPackAvailable, true)
    assert.equal(parameterizedWearableLayer.scoreBearingNow, true)
    assert.equal(parameterizedWearableLayer.scoreContributionAuthorized, false)
    assert.deepEqual(researchCalculatorView.model.layeredResearchPath.activeResearchScoreLayerIds, [
      'selected-lab-body-card',
      'wearable-multi-family-residual',
    ])
    assert.deepEqual(researchCalculatorView.model.layeredResearchPath.parameterPackBlockedLayerIds, [
      'function-disability-sidecar',
    ])

    for (const encodedCalculatorView of [
      JSON.stringify(productCalculatorView),
      JSON.stringify(researchCalculatorView),
    ]) {
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
        assert.equal(encodedCalculatorView.includes(forbidden), false, forbidden)
      }
    }
  } finally {
    await rm(artifactRoot, { force: true, recursive: true })
    await rm(payloadControlledArtifactRoot, { force: true, recursive: true })
    await rm(payloadRoot, { force: true, recursive: true })
  }
})

test('age calculate-bundle supports L1 glycemia plus wearable context as a research preview', async () => {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), 'murph-age-cli-l1-model-cards-'))
  const payloadRoot = await mkdtemp(path.join(os.tmpdir(), 'murph-age-cli-l1-preview-'))
  const payloadPath = path.join(payloadRoot, 'payload.json')
  try {
    await writeLocalModelCardArtifact(payloadRoot, 'l1.json', {
      cardId: 'l1_tiny_glycemia_10y_acm_research',
      model: fixtureL1GlycemiaResearchModel(),
      schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
    }, artifactRoot)
    await writeFile(payloadPath, JSON.stringify({
      asOf: '2026-05-10T00:00:00.000Z',
      chronologicalAgeYears: 45,
      sex: 'female',
      submittedMetrics: [
        { metricKey: 'HbA1c', sourceKind: 'test-result', unit: '%', value: 5.4 },
        { metricKey: 'steps', sourceKind: 'wearable-summary', unit: 'count', value: 10_000 },
        { metricKey: 'activity-minutes', sourceKind: 'wearable-summary', unit: 'minutes', value: 62 },
        { metricKey: 'resting-heart-rate', sourceKind: 'wearable-summary', unit: 'bpm', value: 58 },
        { metricKey: 'wearable_valid_day_count_28d', sourceKind: 'wearable-summary', unit: 'count', value: 24 },
        { metricKey: 'wearable_coverage_index', sourceKind: 'wearable-summary', unit: 'score', value: 0.86 },
      ],
    }))

    const calculatorBundle = requireData(await runSliceCli<MurphAgeSubmittedCalculatorViewBundle>([
      'age',
      'calculate-bundle',
      '--input',
      `@${payloadPath}`,
      '--include-research-preview',
      '--model-card-artifact-root',
      artifactRoot,
    ]))

    assert.equal(
      murphAgeSubmittedCalculatorViewBundleResultSchema.safeParse(calculatorBundle).success,
      true,
    )
    assert.equal(calculatorBundle.product.view.mode, 'product')
    assert.equal(calculatorBundle.product.view.status, 'abstain')
    assert.equal(calculatorBundle.product.view.displayBlockedReason, 'product-not-authorized')
    assert.equal(calculatorBundle.product.view.ageEstimate, null)
    assert.equal(calculatorBundle.product.view.risk.probability, null)
    assert.ok(calculatorBundle.researchPreview)
    assert.equal(calculatorBundle.researchPreview.view.mode, 'research')
    assert.equal(calculatorBundle.researchPreview.view.status, 'ready')
    assert.equal(calculatorBundle.researchPreview.view.selectedCardId, 'l1_tiny_glycemia_10y_acm_research')
    assert.equal(calculatorBundle.researchPreview.view.arbiter.selectedCardRole, 'minimal-glycemia-first-pass')
    assert.equal(typeof calculatorBundle.researchPreview.view.ageEstimate?.biologicalAgeYears, 'number')
    assert.equal(typeof calculatorBundle.researchPreview.view.risk.probability, 'number')
    assert.equal(calculatorBundle.researchPreview.view.wearable.scoreBearing, false)
    assert.equal(calculatorBundle.researchPreview.view.wearable.readyFeatureKeys.includes('activity-volume'), true)
    assert.equal(
      calculatorBundle.researchPreview.view.featureContributions.some((feature) => feature.metricKey === 'hba1c'),
      true,
    )
    assert.equal(
      calculatorBundle.researchPreview.view.featureContributions.some((feature) => feature.metricKey === 'steps'),
      false,
    )

    const encoded = JSON.stringify(calculatorBundle)
    for (const forbidden of [
      artifactRoot,
      payloadPath,
      'fixture-l1-glycemia-research-model',
      'metric-point:',
      '"value"',
      '"unit"',
      '"label"',
      '"message"',
      'selectedPointIds',
      'coefficient',
      'contributionLogit',
      'prediction',
    ]) {
      assert.equal(encoded.includes(forbidden), false, forbidden)
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

    assert.equal(readiness.schemaVersion, 'murph.age.input-readiness.v6')
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
    assert.equal(readiness.bundle.bundleId, 'l1b-glycemia-body')
    assert.equal(readiness.bundle.status, 'ready')
    assert.equal(readiness.bundle.recommendedCardId, 'l1b_glycemia_body_10y_acm_research')
    assert.deepEqual(readiness.inputBundleSpecs.map((spec) => spec.bundleId), [
      'l1b-glycemia-body',
      'lab9-bp-body',
      'lab5-bp-bmi',
      'l1-glycemia',
      'r399-nhis-proxy-anchor',
      'wearable-context',
      'function-context',
    ])
    assert.equal(
      readiness.inputBundleSpecs.find((spec) => spec.bundleId === 'lab9-bp-body')
        ?.completion.requiredFeatureKeys.includes('albumin'),
      true,
    )
    assert.equal(
      readiness.inputBundleSpecs.find((spec) => spec.bundleId === 'wearable-context')
        ?.scoreBearing,
      false,
    )
    assert.deepEqual(readiness.scoreReadiness, {
      bundleId: 'l1b-glycemia-body',
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
      recommendedCardId: 'l1b_glycemia_body_10y_acm_research',
      researchModelCardRequired: true,
      researchReadiness: 'ready-if-local-model-card-loaded',
      researchUsableIfModelLoaded: true,
      scoreBearingInput: true,
      status: 'research-ready-product-blocked',
    })
    assert.deepEqual(readiness.bundle.availableFeatureKeys.sort(), ['bmi', 'glycemia'])
    assert.equal(readiness.bundle.selectedMetricKeys.includes('hba1c'), true)
    assert.equal(readiness.bundle.selectedMetricKeys.includes('bmi'), true)
    assert.equal(readiness.bundle.featureStatuses.some((feature) =>
      feature.featureKey === 'glycemia'
        && feature.selectedMetricKey === 'hba1c'
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
        && feature.measurementMethod === 'consumer-device'
        && feature.scoreBearing === false
        && feature.scoreContributionAuthorized === false
        && feature.productAuthorized === false
        && feature.riskEffect === 'not-estimated'
        && feature.uncertaintyAction === 'context-only'
    ), true)
    assert.equal(readiness.wearableShadow.schemaVersion, 'murph.age.wearable-shadow-readiness.v1')
    assert.equal(readiness.wearableShadow.anchor.anchorCardId, 'l1b_glycemia_body_10y_acm_research')
    assert.equal(readiness.wearableShadow.anchor.bundleId, 'l1b-glycemia-body')
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

    assert.equal(readiness.schemaVersion, 'murph.age.input-readiness.v6')
    assert.equal(readiness.inputBundleSpecs.some((spec) => spec.bundleId === 'lab5-bp-bmi'), true)
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
    assert.equal(report.schemaVersion, 'murph.age.public-calculator-report.v6')
    assert.equal(report.status, 'abstain')
    assert.equal(report.result, null)
    assert.equal(report.wearableResidualLayer, null)
    assert.equal(report.inputReadiness.bundle.bundleId, 'l1b-glycemia-body')
    assert.equal(report.inputReadiness.bundle.selectedMetricKeys.includes('hba1c'), true)
    assert.equal(report.inputReadiness.contextBundles[0]?.bundleId, 'wearable-context')
    assert.equal(report.inputReadiness.contextBundles[0]?.selectedMetricKeys.includes('steps'), true)
    assert.equal(report.researchCandidateCards.length, 5)
    const l1bCandidate = report.researchCandidateCards.find((candidate) =>
      candidate.cardId === 'l1b_glycemia_body_10y_acm_research'
    )
    assert.ok(l1bCandidate)
    assert.equal(l1bCandidate.selected, true)
    assert.equal(l1bCandidate.modelLoaded, false)
    assert.equal(l1bCandidate.inputStatus, 'ready')
    assert.equal(l1bCandidate.blockerCodes.includes('LOCAL_MODEL_CARD_NOT_LOADED'), true)
    assert.equal(l1bCandidate.blockerCodes.includes('PRODUCT_MODE_RESEARCH_ONLY'), true)
    assert.equal(l1bCandidate.selectedMetricKeys.includes('hba1c'), true)
    assert.equal(hasOwnKey(l1bCandidate, 'selectedPointIds'), false)
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
      JSON.stringify({
        analyte: 'Albumin',
        biomarkerSlug: 'albumin',
        value: 4.4,
        unit: 'g/dL',
      }),
      '--result',
      JSON.stringify({
        analyte: 'Creatinine',
        biomarkerSlug: 'creatinine',
        value: 0.9,
        unit: 'mg/dL',
      }),
      '--result',
      JSON.stringify({
        analyte: 'HbA1c',
        biomarkerSlug: 'hba1c',
        value: 5.1,
        unit: 'percent',
      }),
      '--result',
      JSON.stringify({
        analyte: 'Alkaline phosphatase',
        biomarkerSlug: 'alkaline-phosphatase',
        value: 70,
        unit: 'U/L',
      }),
      '--result',
      JSON.stringify({
        analyte: 'White blood cell count',
        biomarkerSlug: 'white-blood-cell-count',
        value: 5.6,
        unit: '10^3/uL',
      }),
      '--result',
      JSON.stringify({
        analyte: 'Lymphocyte percentage',
        biomarkerSlug: 'lymphocyte-percentage',
        value: 32,
        unit: 'percent',
      }),
      '--result',
      JSON.stringify({
        analyte: 'Red cell distribution width',
        biomarkerSlug: 'red-cell-distribution-width',
        value: 12.6,
        unit: 'percent',
      }),
      '--result',
      JSON.stringify({
        analyte: 'HDL-C',
        biomarkerSlug: 'hdl-c',
        value: 62,
        unit: 'mg/dL',
      }),
      '--result',
      JSON.stringify({
        analyte: 'Triglycerides',
        biomarkerSlug: 'triglycerides',
        value: 90,
        unit: 'mg/dL',
      }),
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
    assert.equal(
      report.displaySummary.wearableBridge.features.find((feature) => feature.featureKey === 'estimated-vo2-max')
        ?.measurementMethod,
      'estimated-fitness',
    )
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
        metric_point_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

function aggregateEvidenceReceipt(input: {
  candidateId: string
  layer: 'biomarker-increment' | 'wearable-shadow-increment'
  sourceRouteId: string
}) {
  return {
    anchorCardId: 'r399_nhis_proxy_10y_acm_research',
    candidateBatchId: 'ordinary-lab-wearable-aggregate-v1',
    candidateId: input.candidateId,
    evaluation: {
      aggregateMetricDeltas: {
        aucDelta: 0.001,
        brierDelta: -0.0001,
      },
      aggregateSample: {
        evaluatedRowCount: 240,
        eventCount: 24,
        minimumCellCount: 24,
        suppressedCellCount: 0,
      },
      comparator: 'anchor-vs-anchor-plus-increment',
      evidenceTier: 'external-validation',
      sameDenominator: true,
    },
    flatteningAuthorized: false,
    layer: input.layer,
    outputBoundary: {
      aggregateOnly: true,
      coefficientsExportAllowed: false,
      localArtifactPathExportAllowed: false,
      modelParametersExportAllowed: false,
      participantIdentifiersExportAllowed: false,
      participantLevelExportAllowed: false,
      predictionsExportAllowed: false,
      productDisplayExportAllowed: false,
      rowValuesExportAllowed: false,
      sourceTextExportAllowed: false,
      splitMembershipExportAllowed: false,
    },
    productAuthorized: false,
    riskEffect: 'aggregate-estimated',
    schemaVersion: MURPH_AGE_INCREMENT_EVALUATION_CARD_SCHEMA_VERSION,
    scoreBearing: false,
    scoreContributionAuthorized: false,
    sourceRouteId: input.sourceRouteId,
  }
}

function wearableLabAggregateReceipt(input: {
  receiptId: string
  sourceRouteId: string
}) {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      coefficientsExportAllowed: false,
      localArtifactPathExportAllowed: false,
      modelParametersExportAllowed: false,
      participantIdentifiersExportAllowed: false,
      participantLevelExportAllowed: false,
      predictionsExportAllowed: false,
      productDisplayExportAllowed: false,
      rowValuesExportAllowed: false,
      sourceTextExportAllowed: false,
      splitMembershipExportAllowed: false,
    },
    denominator: {
      evaluatedRowCount: 12_400,
      eventCount: 130,
      minimumCellCount: 25,
      personYears: 96_000,
      suppressedCellCount: 0,
    },
    endpoint: {
      endpointFamily: 'all-cause-mortality',
      endpointFrozenBeforeScoring: true,
      horizonYears: 10,
      indexDateRule: 'feature-window-end-before-risk-window',
      outcomeAscertainment: 'death-registry',
      outcomeLinked: true,
      washoutDays: 365,
    },
    evaluatorFrozenBeforeExecution: true,
    evidenceTier: 'partner-aggregate',
    models: [
      {
        calibrationStatus: 'pass',
        metrics: { auc: 0.7, brier: 0.082, calibrationIntercept: 0.01, calibrationSlope: 1.01, logLoss: 0.31 },
        modelId: 'm0-anchor-only',
      },
      {
        calibrationStatus: 'pass',
        metrics: { auc: 0.75, brier: 0.064, calibrationIntercept: 0.005, calibrationSlope: 0.99, logLoss: 0.23 },
        modelId: 'm1-anchor-plus-lab-body-bp',
      },
      {
        calibrationStatus: 'pass',
        metrics: { auc: 0.752, brier: 0.0638, calibrationIntercept: 0.006, calibrationSlope: 0.98, logLoss: 0.229 },
        modelId: 'm2-coverage-device-ehr-density-control',
      },
      {
        calibrationStatus: 'pass',
        metrics: { auc: 0.755, brier: 0.063, calibrationIntercept: 0.004, calibrationSlope: 0.99, logLoss: 0.226 },
        modelId: 'm3-wearable-residual',
      },
      {
        calibrationStatus: 'pass',
        metrics: { auc: 0.758, brier: 0.0628, calibrationIntercept: 0.004, calibrationSlope: 0.99, logLoss: 0.225 },
        modelId: 'm4-wearable-plus-coverage',
      },
      {
        calibrationStatus: 'pass',
        metrics: { auc: 0.763, brier: 0.062, calibrationIntercept: 0.003, calibrationSlope: 1, logLoss: 0.222 },
        modelId: 'm5-residualized-wearable-after-controls',
      },
    ],
    negativeControls: {
      coverageOnlyBeatenByResidualWearable: true,
      deviceOrEhrDensityDominates: false,
      earlyEventSensitivityPassed: true,
      reverseCausationWashoutPassed: true,
    },
    productAuthorized: false,
    receiptId: input.receiptId,
    sameDenominator: true,
    schemaVersion: MURPH_AGE_WEARABLE_LAB_AGGREGATE_RECEIPT_SCHEMA_VERSION,
    scoreBearing: false,
    scoreContributionAuthorized: false,
    sourceRouteId: input.sourceRouteId,
  }
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

function fixtureL1GlycemiaResearchModel(): MurphAgeRiskModel {
  return {
    ...fixtureLab9ResearchModel(),
    features: [
      { coefficient: 0.055, key: 'age', kind: 'chronological-age', label: 'Age' },
      { coefficient: 0.12, key: 'male', kind: 'sex', label: 'Male', sex: 'male' },
      labFeature('hba1c', 'HbA1c', 'hba1c', 0.12, 5.4, 0.5, 'percent'),
    ],
    modelId: 'fixture-l1-glycemia-research-model',
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

function testWearableResidualParameterPack(input: {
  center: number;
  coefficient: number;
  family: MurphAgeWearableResidualParameterPack['family'];
  layerId: MurphAgeWearableResidualParameterPack['layerId'];
  metricKey: string;
  scale: number;
}): MurphAgeWearableResidualParameterPack {
  return {
    anchorCardId: 'lab5_bp_bmi_transport_research',
    calibrationIntercept: 0,
    calibrationSlope: 1,
    deploymentRights: 'research-only',
    endpoint: '10-year all-cause mortality',
    evidenceTier: 'true-external-validation',
    family: input.family,
    featureWeights: [{
      center: input.center,
      coefficient: input.coefficient,
      metricKey: input.metricKey,
      scale: input.scale,
      transform: 'center-scale',
    }],
    globalWearableCapLogit: 0.25,
    horizonYears: 10,
    intercept: 0,
    layerId: input.layerId,
    packHash: testWearablePackHash(input.family),
    schemaVersion: MURPH_AGE_WEARABLE_RESIDUAL_PARAMETER_PACK_SCHEMA_VERSION,
    sourceRouteId: 'all-of-us-fitbit-labs-ehr',
  }
}

function testWearablePackHash(family: MurphAgeWearableResidualParameterPack['family']): string {
  const hashSeedByFamily = {
    activity: 'a',
    hrv: 'b',
    'resting-heart-rate': 'c',
    sleep: 'd',
  } satisfies Record<MurphAgeWearableResidualParameterPack['family'], string>

  return `sha256:${hashSeedByFamily[family].repeat(64)}`
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
