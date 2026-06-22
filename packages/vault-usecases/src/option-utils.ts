import {
  experimentMeasurementAnchorsSchema,
  experimentPlannedMeasurementsSchema,
  type ExperimentAnalysisPlan,
  type ExperimentMeasurementAnchor,
  type ExperimentPlannedMeasurement,
} from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

type MeasurementAnchorInput = ExperimentAnalysisPlan['measurementAnchors']
type PlannedMeasurementInput = ExperimentAnalysisPlan['plannedMeasurements']

export function normalizeRepeatedOption(
  value: readonly string[] | undefined,
): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const entries = [
    ...new Set(
      value
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  ]

  return entries.length > 0 ? entries : undefined
}

function rejectCommaDelimitedEntries(
  value: readonly string[] | undefined,
  optionName: string,
) {
  if (!Array.isArray(value)) {
    return
  }

  for (const entry of value) {
    if (entry.includes(',')) {
      throw new VaultCliError(
        'invalid_option',
        `Comma-delimited values are not supported for --${optionName}. Repeat the flag instead.`,
      )
    }
  }
}

export function normalizeRepeatableFlagOption(
  value: readonly string[] | undefined,
  optionName: string,
): string[] | undefined {
  rejectCommaDelimitedEntries(value, optionName)
  return normalizeRepeatedOption(value)
}

export function normalizeRepeatableTextFlagOption(
  value: readonly string[] | undefined,
): string[] | undefined {
  return normalizeRepeatedOption(value)
}

export function normalizeRepeatableEnumFlagOption<TValue extends string>(
  value: readonly string[] | undefined,
  optionName: string,
  supportedValues: readonly TValue[],
): TValue[] | undefined {
  const entries = normalizeRepeatableFlagOption(value, optionName)

  if (!entries) {
    return undefined
  }

  const supportedValueSet = new Set<string>(supportedValues)
  const invalidValues = entries.filter((entry) => !supportedValueSet.has(entry))

  if (invalidValues.length > 0) {
    const invalidLabel = invalidValues.length === 1 ? 'value' : 'values'
    const invalidSummary = invalidValues.map((entry) => `"${entry}"`).join(', ')
    throw new VaultCliError(
      'invalid_option',
      `Unsupported ${invalidLabel} for --${optionName}: ${invalidSummary}. Supported values: ${supportedValues.join(', ')}.`,
    )
  }

  return entries as TValue[]
}

export function normalizeExperimentMeasurementAnchorFlagOption(
  values: readonly string[] | undefined,
  existing: MeasurementAnchorInput | undefined,
): ExperimentMeasurementAnchor[] | undefined {
  const entries = normalizeRepeatedOption(values)
  if (!entries) {
    return undefined
  }

  const next = new Map<string, ExperimentMeasurementAnchor>()
  for (const anchor of existing ?? []) {
    next.set(measurementAnchorKey(anchor), anchor)
  }
  for (const entry of entries) {
    const anchor = parseMeasurementAnchorOption(entry)
    const key = measurementAnchorKey(anchor)
    const existingAnchor = next.get(key)
    next.set(key, existingAnchor ? mergeMeasurementAnchor(existingAnchor, anchor) : anchor)
  }

  return experimentMeasurementAnchorsSchema.parse([...next.values()])
}

export function normalizeExperimentPlannedMeasurementFlagOption(
  values: readonly string[] | undefined,
  existing: PlannedMeasurementInput | undefined,
): ExperimentPlannedMeasurement[] | undefined {
  const entries = normalizeRepeatedOption(values)
  if (!entries) {
    return undefined
  }

  const next = new Map<string, ExperimentPlannedMeasurement>()
  for (const measurement of existing ?? []) {
    next.set(plannedMeasurementKey(measurement), measurement)
  }
  for (const entry of entries) {
    const measurement = parsePlannedMeasurementOption(entry)
    next.set(plannedMeasurementKey(measurement), measurement)
  }

  return experimentPlannedMeasurementsSchema.parse([...next.values()])
}

function parseMeasurementAnchorOption(entry: string): ExperimentMeasurementAnchor {
  const fields = parseKeyValueList(entry, 'analysis-anchor')
  const role = requireField(fields, 'role', 'analysis-anchor')
  const kind = requireField(fields, 'kind', 'analysis-anchor')
  const recordId = normalizeInternalRecordIdField(
    requireField(fields, 'recordId', 'analysis-anchor'),
    'analysis-anchor',
  )
  const biomarkerKeys = parseBiomarkerKeys(fields, 'analysis-anchor')
  const observedOn = fields.get('observedOn')

  return experimentMeasurementAnchorsSchema.element.parse({
    role,
    kind,
    recordId,
    biomarkerKeys,
    observedOn,
  })
}

function parsePlannedMeasurementOption(entry: string): ExperimentPlannedMeasurement {
  const fields = parseKeyValueList(entry, 'planned-measurement')
  const role = requireField(fields, 'role', 'planned-measurement')
  const kind = requireField(fields, 'kind', 'planned-measurement')
  const biomarkerKeys = parseBiomarkerKeys(fields, 'planned-measurement')
  const window = fields.get('targetWindow') ?? fields.get('window')
  if (!window) {
    throw new VaultCliError(
      'invalid_option',
      '--planned-measurement requires window=YYYY-MM-DD..YYYY-MM-DD.',
    )
  }

  const [start, end, extra] = window.split('..')
  if (!start || !end || extra !== undefined) {
    throw new VaultCliError(
      'invalid_option',
      '--planned-measurement window must use YYYY-MM-DD..YYYY-MM-DD.',
    )
  }

  return experimentPlannedMeasurementsSchema.element.parse({
    role,
    kind,
    biomarkerKeys,
    targetWindow: { start, end },
  })
}

function parseKeyValueList(entry: string, optionName: string) {
  const fields = new Map<string, string>()
  for (const part of entry.split(',')) {
    const trimmed = part.trim()
    if (trimmed.length === 0) {
      continue
    }

    const delimiterIndex = trimmed.indexOf('=')
    if (delimiterIndex <= 0 || delimiterIndex === trimmed.length - 1) {
      throw new VaultCliError(
        'invalid_option',
        `--${optionName} entries must use comma-separated key=value fields.`,
      )
    }

    fields.set(
      trimmed.slice(0, delimiterIndex).trim(),
      trimmed.slice(delimiterIndex + 1).trim(),
    )
  }

  return fields
}

function requireField(fields: ReadonlyMap<string, string>, key: string, optionName: string) {
  const value = fields.get(key)
  if (!value) {
    throw new VaultCliError(
      'invalid_option',
      `--${optionName} requires ${key}=...`,
    )
  }

  return value
}

function parseBiomarkerKeys(fields: ReadonlyMap<string, string>, optionName: string) {
  const raw = fields.get('biomarkerKeys') ?? fields.get('biomarkerKey')
  if (!raw) {
    throw new VaultCliError(
      'invalid_option',
      `--${optionName} requires biomarkerKeys=biomarker:key[|biomarker:other].`,
    )
  }

  return raw
    .split(/[|;]/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function normalizeInternalRecordIdField(value: string, optionName: string) {
  const normalized = value.trim()
  if (
    /[\\/@]/u.test(normalized) ||
    normalized.includes('://') ||
    normalized.includes('..') ||
    !/^(?:evt|sample|batch|metric_sample)_[A-Za-z0-9][A-Za-z0-9_-]*$|^sample-summary:[0-9]{4}-[0-9]{2}-[0-9]{2}:[A-Za-z0-9_-]+:[A-Za-z0-9_.%/-]+$|^sample-summary:[A-Za-z0-9_-]+:[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(normalized)
  ) {
    throw new VaultCliError(
      'invalid_option',
      `--${optionName} recordId must be an internal canonical event or sample record id.`,
    )
  }

  return normalized
}

function mergeMeasurementAnchor(
  existing: ExperimentMeasurementAnchor,
  next: ExperimentMeasurementAnchor,
): ExperimentMeasurementAnchor {
  if (
    existing.observedOn !== undefined &&
    next.observedOn !== undefined &&
    existing.observedOn !== next.observedOn
  ) {
    throw new VaultCliError(
      'invalid_option',
      '--analysis-anchor repeated for the same role/kind/recordId must not use conflicting observedOn dates.',
    )
  }

  return experimentMeasurementAnchorsSchema.element.parse({
    ...existing,
    biomarkerKeys: [...new Set([...existing.biomarkerKeys, ...next.biomarkerKeys])],
    observedOn: existing.observedOn ?? next.observedOn,
  })
}

function measurementAnchorKey(anchor: ExperimentMeasurementAnchor) {
  return [anchor.role, anchor.kind, anchor.recordId].join('\u0000')
}

function plannedMeasurementKey(measurement: ExperimentPlannedMeasurement) {
  return [
    measurement.role,
    measurement.kind,
    measurement.targetWindow.start,
    measurement.targetWindow.end,
    [...measurement.biomarkerKeys].sort().join('|'),
  ].join('\u0000')
}
