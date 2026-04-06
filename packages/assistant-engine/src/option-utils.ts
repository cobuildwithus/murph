import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

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
