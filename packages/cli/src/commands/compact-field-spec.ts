type CompactFieldErrorFactory = (message: string) => never

export function parseCompactFields(
  spec: string,
  optionName: string,
  invalidOption: CompactFieldErrorFactory,
): Map<string, string> {
  const fields = new Map<string, string>()

  for (const rawPart of spec.split(';')) {
    const part = rawPart.trim()
    if (part.length === 0) continue

    const separatorIndex = part.indexOf('=')
    const key = part.slice(0, separatorIndex).trim()
    const value = part.slice(separatorIndex + 1).trim()

    if (separatorIndex <= 0 || key.length === 0 || value.length === 0) {
      invalidOption(`Each --${optionName} entry must use key=value fields.`)
    }

    if (fields.has(key)) {
      invalidOption(`Duplicate --${optionName} field "${key}".`)
    }
    fields.set(key, value)
  }

  return fields
}

export function rejectUnsupportedCompactFields(
  fields: ReadonlyMap<string, string>,
  optionName: string,
  supportedFields: Iterable<string>,
  invalidOption: CompactFieldErrorFactory,
) {
  const supportedFieldList = Array.from(supportedFields)
  const supported = new Set(supportedFieldList)
  for (const key of fields.keys()) {
    if (!supported.has(key)) {
      invalidOption(
        `Unsupported --${optionName} field "${key}". Supported fields: ${supportedFieldList.join(', ')}.`,
      )
    }
  }
}

export function requireCompactString(
  fields: ReadonlyMap<string, string>,
  key: string,
  optionName: string,
  invalidOption: CompactFieldErrorFactory,
): string {
  const value = fields.get(key)
  if (value === undefined) {
    invalidOption(`--${optionName} requires ${key}=...`)
  }
  return value
}

export function compactNumber(
  fields: ReadonlyMap<string, string>,
  key: string,
  optionName: string,
  invalidOption: CompactFieldErrorFactory,
): number | undefined {
  const rawValue = fields.get(key)
  if (rawValue === undefined) return undefined

  const value = Number(rawValue)
  if (!Number.isFinite(value)) {
    invalidOption(`--${optionName} field ${key} must be a finite number.`)
  }
  return value
}

export function compactInteger(
  fields: ReadonlyMap<string, string>,
  key: string,
  optionName: string,
  invalidOption: CompactFieldErrorFactory,
): number | undefined {
  const value = compactNumber(fields, key, optionName, invalidOption)
  if (value !== undefined && !Number.isInteger(value)) {
    invalidOption(`--${optionName} field ${key} must be an integer.`)
  }
  return value
}

export function requireCompactInteger(
  fields: ReadonlyMap<string, string>,
  key: string,
  optionName: string,
  invalidOption: CompactFieldErrorFactory,
): number {
  const value = compactInteger(fields, key, optionName, invalidOption)
  if (value === undefined) {
    invalidOption(`--${optionName} requires ${key}=...`)
  }
  return value
}
