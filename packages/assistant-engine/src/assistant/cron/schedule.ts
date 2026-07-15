import {
  formatTimeZoneDateTimeParts,
  normalizeIanaTimeZone,
  parseDailyTime,
} from '@murphai/contracts'
import type {
  AssistantCronSchedule,
  AssistantCronScheduleInput,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

const DURATION_UNITS = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
} as const

const MAX_CRON_LOOKAHEAD_MINUTES = 366 * 24 * 60
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

interface ParsedCronField {
  any: boolean
  values: Set<number>
}

interface ParsedCronExpression {
  minute: ParsedCronField
  hour: ParsedCronField
  dayOfMonth: ParsedCronField
  month: ParsedCronField
  dayOfWeek: ParsedCronField
}

type AssistantCronComputableSchedule =
  | AssistantCronSchedule
  | {
      kind: 'cron'
      expression: string
      timeZone?: string
    }
  | {
      kind: 'dailyLocal'
      localTime: string
      timeZone?: string
    }

export function buildAssistantCronSchedule(input: {
  at?: string | null
  every?: string | null
  cron?: string | null
  now?: Date
  timeZone?: string | null
}): AssistantCronScheduleInput {
  const at = normalizeNullableString(input.at)
  const every = normalizeNullableString(input.every)
  const cron = normalizeNullableString(input.cron)
  const supplied = [at, every, cron].filter(
    (value): value is string => value !== null,
  )

  if (supplied.length !== 1) {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      'Provide exactly one of --at, --every, or --cron when creating an assistant cron job.',
    )
  }

  if (at) {
    const atDate = new Date(at)
    if (Number.isNaN(atDate.getTime())) {
      throw new VaultCliError(
        'ASSISTANT_CRON_INVALID_SCHEDULE',
        'The --at timestamp must be a valid ISO 8601 timestamp with an explicit offset.',
      )
    }

    const now = input.now ?? new Date()
    if (atDate.getTime() <= now.getTime()) {
      throw new VaultCliError(
        'ASSISTANT_CRON_INVALID_SCHEDULE',
        'One-shot assistant cron jobs must be scheduled in the future.',
      )
    }

    return {
      kind: 'at',
      at: atDate.toISOString(),
    }
  }

  if (every) {
    return {
      kind: 'every',
      everyMs: parseAssistantCronEveryDuration(every),
    }
  }

  if (!cron) {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      'Expected a cron expression.',
    )
  }

  validateAssistantCronExpression(cron)

  return {
    kind: 'cron',
    expression: cron,
  }
}

export function parseAssistantCronEveryDuration(value: string): number {
  const normalized = normalizeNullableString(value)?.toLowerCase() ?? null
  if (!normalized) {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      'The --every interval must be a non-empty duration such as 30m, 2h, or 1d.',
    )
  }

  let total = 0
  let consumed = 0
  const matcher = /(\d+)(ms|s|m|h|d)/gu

  for (const match of normalized.matchAll(matcher)) {
    const start = match.index ?? 0
    if (start !== consumed) {
      throw new VaultCliError(
        'ASSISTANT_CRON_INVALID_SCHEDULE',
        'The --every interval must be a sequence of number+unit pairs such as 15m, 2h30m, or 1d.',
      )
    }

    const amount = Number.parseInt(match[1] ?? '', 10)
    const unit = match[2] as keyof typeof DURATION_UNITS
    total += amount * DURATION_UNITS[unit]
    consumed = start + (match[0]?.length ?? 0)
  }

  if (consumed !== normalized.length || total <= 0) {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      'The --every interval must be a sequence of number+unit pairs such as 15m, 2h30m, or 1d.',
    )
  }

  return total
}

export function computeAssistantCronNextRunAt(
  schedule: AssistantCronComputableSchedule,
  after: Date,
): string | null {
  switch (schedule.kind) {
    case 'at': {
      const atTime = new Date(schedule.at)
      return atTime.getTime() > after.getTime() ? atTime.toISOString() : null
    }
    case 'every':
      return new Date(after.getTime() + schedule.everyMs).toISOString()
    case 'dailyLocal':
      return findNextAssistantDailyLocalOccurrence(
        schedule.localTime,
        'timeZone' in schedule ? schedule.timeZone : undefined,
        after,
      )
    case 'cron':
      return findNextAssistantCronOccurrence(
        schedule.expression,
        after,
        'timeZone' in schedule ? schedule.timeZone : undefined,
      )
  }
}

export function findNextAssistantCronOccurrence(
  expression: string,
  after: Date,
  timeZone?: string,
): string | null {
  const parsed = parseAssistantCronExpression(expression)

  return findNextAssistantTimeZoneOccurrence({
    after,
    hours: resolveParsedCronFieldValues(parsed.hour, 0, 23),
    minutes: resolveParsedCronFieldValues(parsed.minute, 0, 59),
    timeZone,
    matchesDate(dateTime) {
      return matchesAssistantCronDate(parsed, dateTime)
    },
  })
}

export function validateAssistantCronExpression(expression: string): void {
  parseAssistantCronExpression(expression)
}

function parseAssistantCronExpression(expression: string): ParsedCronExpression {
  const fields = normalizeNullableString(expression)?.split(/\s+/u) ?? []
  if (fields.length !== 5) {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      'Cron expressions must use five fields: minute hour day-of-month month day-of-week.',
    )
  }

  return {
    minute: parseCronField(fields[0] ?? '', 0, 59, 'minute'),
    hour: parseCronField(fields[1] ?? '', 0, 23, 'hour'),
    dayOfMonth: parseCronField(fields[2] ?? '', 1, 31, 'day-of-month'),
    month: parseCronField(fields[3] ?? '', 1, 12, 'month'),
    dayOfWeek: parseCronField(fields[4] ?? '', 0, 7, 'day-of-week', {
      normalizeValue(value) {
        return value === 7 ? 0 : value
      },
    }),
  }
}

function parseCronField(
  field: string,
  minimum: number,
  maximum: number,
  label: string,
  options?: {
    normalizeValue?: (value: number) => number
  },
): ParsedCronField {
  const normalizeValue = options?.normalizeValue ?? ((value: number) => value)

  if (field === '*') {
    return {
      any: true,
      values: new Set<number>(),
    }
  }

  const values = new Set<number>()
  const parts = field.split(',')
  if (parts.length === 0) {
    throw invalidCronFieldError(label, field)
  }

  for (const rawPart of parts) {
    const part = rawPart.trim()
    if (part.length === 0) {
      throw invalidCronFieldError(label, field)
    }

    const segments = part.split('/')
    if (segments.length > 2) {
      throw invalidCronFieldError(label, field)
    }

    const [base, stepText] = segments
    const step =
      typeof stepText === 'string' && /^\d+$/u.test(stepText) ? Number(stepText) : typeof stepText === 'string' ? Number.NaN : 1

    if (!Number.isInteger(step) || step <= 0) {
      throw invalidCronFieldError(label, field)
    }

    const range = resolveCronFieldRange(base ?? '', minimum, maximum, label)
    for (let value = range.start; value <= range.end; value += step) {
      values.add(normalizeValue(value))
    }
  }

  if (values.size === 0) {
    throw invalidCronFieldError(label, field)
  }

  return {
    any: false,
    values,
  }
}

function resolveCronFieldRange(
  base: string,
  minimum: number,
  maximum: number,
  label: string,
): {
  start: number
  end: number
} {
  if (base === '*') {
    return {
      start: minimum,
      end: maximum,
    }
  }

  if (base.includes('-')) {
    const range = base.split('-')
    if (range.length !== 2 || !/^\d+$/u.test(range[0] ?? '') || !/^\d+$/u.test(range[1] ?? '')) {
      throw invalidCronFieldError(label, base)
    }

    const [startText, endText] = range
    const start = Number(startText)
    const end = Number(endText)

    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < minimum ||
      end > maximum ||
      start > end
    ) {
      throw invalidCronFieldError(label, base)
    }

    return {
      start,
      end,
    }
  }

  if (!/^\d+$/u.test(base)) {
    throw invalidCronFieldError(label, base)
  }

  const value = Number(base)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw invalidCronFieldError(label, base)
  }

  return {
    start: value,
    end: value,
  }
}

function matchesAssistantCronDate(
  expression: ParsedCronExpression,
  dateTime: {
    month: number
    day: number
    dayOfWeek: number
  },
): boolean {
  if (!matchesParsedCronField(expression.month, dateTime.month)) {
    return false
  }

  const dayOfMonthMatches = matchesParsedCronField(
    expression.dayOfMonth,
    dateTime.day,
  )
  const dayOfWeekMatches = matchesParsedCronField(
    expression.dayOfWeek,
    dateTime.dayOfWeek,
  )

  if (expression.dayOfMonth.any && expression.dayOfWeek.any) {
    return true
  }

  if (expression.dayOfMonth.any) {
    return dayOfWeekMatches
  }

  if (expression.dayOfWeek.any) {
    return dayOfMonthMatches
  }

  return dayOfMonthMatches || dayOfWeekMatches
}

function matchesParsedCronField(field: ParsedCronField, value: number): boolean {
  return field.any || field.values.has(value)
}

function resolveParsedCronFieldValues(
  field: ParsedCronField,
  minimum: number,
  maximum: number,
): number[] {
  if (!field.any) {
    return [...field.values].sort((left, right) => left - right)
  }

  return Array.from(
    { length: maximum - minimum + 1 },
    (_, index) => minimum + index,
  )
}

function invalidCronFieldError(label: string, value: string): VaultCliError {
  return new VaultCliError(
    'ASSISTANT_CRON_INVALID_SCHEDULE',
    `Invalid cron ${label} field: ${value}.`,
  )
}

function findNextAssistantDailyLocalOccurrence(
  localTime: string,
  timeZone: string | undefined,
  after: Date,
): string | null {
  const parsedTime = parseDailyTime(localTime)
  if (!parsedTime) {
    throw new VaultCliError(
      'ASSISTANT_CRON_INVALID_SCHEDULE',
      'Daily-local schedules require a valid HH:MM local time.',
    )
  }

  return findNextAssistantTimeZoneOccurrence({
    after,
    hours: [parsedTime.hour],
    minutes: [parsedTime.minute],
    timeZone,
    matchesDate() {
      return true
    },
  })
}

function findNextAssistantTimeZoneOccurrence(input: {
  after: Date
  hours: readonly number[]
  matchesDate: (dateTime: {
    month: number
    day: number
    dayOfWeek: number
  }) => boolean
  minutes: readonly number[]
  timeZone?: string | null
}): string | null {
  const timeZone = normalizeAssistantCronTimeZone(input.timeZone)
  const searchStart =
    Math.floor(input.after.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS
  const searchEnd = searchStart + MAX_CRON_LOOKAHEAD_MINUTES * MINUTE_MS
  const firstLocal = formatTimeZoneDateTimeParts(searchStart, timeZone)
  const lastLocal = formatTimeZoneDateTimeParts(
    searchEnd - MINUTE_MS,
    timeZone,
  )
  const firstLocalDay = Date.UTC(firstLocal.year, firstLocal.month - 1, firstLocal.day)
  const lastLocalDay = Date.UTC(lastLocal.year, lastLocal.month - 1, lastLocal.day)

  for (
    let localDay = firstLocalDay;
    localDay <= lastLocalDay;
    localDay += DAY_MS
  ) {
    const calendarDate = new Date(localDay)
    const dateTime = {
      day: calendarDate.getUTCDate(),
      dayOfWeek: calendarDate.getUTCDay(),
      month: calendarDate.getUTCMonth() + 1,
    }
    if (!input.matchesDate(dateTime)) {
      continue
    }

    const occurrence = findAssistantTimeZoneOccurrenceOnDate({
      afterOrAt: searchStart,
      before: searchEnd,
      day: dateTime.day,
      hours: input.hours,
      localDay,
      minutes: input.minutes,
      month: dateTime.month,
      timeZone,
      year: calendarDate.getUTCFullYear(),
    })
    if (occurrence !== null) {
      return new Date(occurrence).toISOString()
    }
  }

  return null
}

function findAssistantTimeZoneOccurrenceOnDate(input: {
  afterOrAt: number
  before: number
  day: number
  hours: readonly number[]
  localDay: number
  minutes: readonly number[]
  month: number
  timeZone: string
  year: number
}): number | null {
  const offsets = collectAssistantTimeZoneOffsets(input.timeZone, input.localDay)
  let earliest = Number.POSITIVE_INFINITY

  for (const hour of input.hours) {
    for (const minute of input.minutes) {
      const localMinute = input.localDay + hour * HOUR_MS + minute * MINUTE_MS

      for (const offset of offsets) {
        const candidate = Math.ceil((localMinute - offset) / MINUTE_MS) * MINUTE_MS
        if (
          candidate < input.afterOrAt ||
          candidate >= input.before ||
          candidate >= earliest
        ) {
          continue
        }

        const projected = formatTimeZoneDateTimeParts(candidate, input.timeZone)
        if (
          projected.year === input.year &&
          projected.month === input.month &&
          projected.day === input.day &&
          projected.hour === hour &&
          projected.minute === minute
        ) {
          earliest = candidate
        }
      }
    }
  }

  return Number.isFinite(earliest) ? earliest : null
}

function collectAssistantTimeZoneOffsets(
  timeZone: string,
  localDay: number,
): Set<number> {
  const offsets = new Set<number>()

  for (const delta of [-2 * DAY_MS, 0, 2 * DAY_MS]) {
    const instant = localDay + delta
    const projected = formatTimeZoneDateTimeParts(instant, timeZone)
    const projectedAsUtc = Date.UTC(
      projected.year,
      projected.month - 1,
      projected.day,
      projected.hour,
      projected.minute,
      projected.second,
    )
    offsets.add(projectedAsUtc - instant)
  }

  return offsets
}

function normalizeAssistantCronTimeZone(value: string | null | undefined): string {
  const normalized = normalizeIanaTimeZone(value ?? 'UTC')
  if (normalized) {
    return normalized
  }

  throw new VaultCliError(
    'ASSISTANT_CRON_INVALID_SCHEDULE',
    'Assistant cron schedules require a valid IANA timezone.',
  )
}

function normalizeNullableString(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
