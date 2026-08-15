export function stableJsonStringify(value: unknown): string {
  if (value === null) {
    return 'null'
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`
  }

  switch (typeof value) {
    case 'boolean':
    case 'number':
    case 'string':
      return JSON.stringify(value)
    case 'object': {
      const record = value as Record<string, unknown>
      const entries = Object.keys(record)
        .sort()
        .flatMap((key) =>
          record[key] === undefined
            ? []
            : [`${JSON.stringify(key)}:${stableJsonStringify(record[key])}`],
        )
      return `{${entries.join(',')}}`
    }
    default:
      return 'null'
  }
}
