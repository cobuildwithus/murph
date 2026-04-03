export function formatRelativeTime(value: string): string {
  const parsed = Date.parse(value)

  if (Number.isNaN(parsed)) {
    return 'Unknown'
  }

  const deltaMs = parsed - Date.now()
  const absoluteMs = Math.abs(deltaMs)
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (absoluteMs < 60_000) {
    return 'just now'
  }

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ]

  for (const [unit, size] of units) {
    if (absoluteMs >= size) {
      return formatter.format(Math.round(deltaMs / size), unit)
    }
  }

  return 'just now'
}

export function formatAbsoluteTime(value: string): string {
  const parsed = Date.parse(value)

  if (Number.isNaN(parsed)) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(parsed))
}
