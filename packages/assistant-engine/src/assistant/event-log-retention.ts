import { open } from 'node:fs/promises'

import {
  assistantDiagnosticEventSchema,
  assistantRuntimeEventSchema,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  isMissingFileError,
  parseAssistantJsonLinesWithTailSalvage,
  writeTextFileAtomic,
} from './shared.js'
import type { AssistantStatePaths } from './store/paths.js'

const ASSISTANT_RUNTIME_EVENT_RETENTION = {
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  maxBytes: 1024 * 1024,
  maxEvents: 2000,
} as const

const ASSISTANT_DIAGNOSTIC_EVENT_RETENTION = {
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  maxBytes: 512 * 1024,
} as const
const EVENT_LOG_READ_WINDOW_MULTIPLIER = 8
const EVENT_LOG_MIN_READ_WINDOW_BYTES = 4 * 1024 * 1024

type JsonLineRetentionPolicy = {
  maxAgeMs: number
  maxBytes: number
  maxEvents?: number
}

type JsonLineRetentionResult = {
  malformedLineCount: number
  originalBytes: number
  originalEventCount: number
  readBytes: number
  readWasTruncated: boolean
  retainedBytes: number
  retainedEventCount: number
  salvagedTailLineCount: number
}

export type AssistantEventLogRetentionResult = {
  diagnosticEvents: JsonLineRetentionResult | null
  runtimeEvents: JsonLineRetentionResult | null
}

export async function compactAssistantEventLogsAtPaths(input: {
  now?: Date
  paths: AssistantStatePaths
}): Promise<AssistantEventLogRetentionResult> {
  const now = input.now ?? new Date()
  const [runtimeEvents, diagnosticEvents] = await Promise.all([
    compactOptionalJsonLinesFile({
      filePath: input.paths.runtimeEventsPath,
      now,
      parse: (value) => assistantRuntimeEventSchema.parse(value),
      policy: ASSISTANT_RUNTIME_EVENT_RETENTION,
      resolveTimestamp: (value) => value.at,
    }),
    compactOptionalJsonLinesFile({
      filePath: input.paths.diagnosticEventsPath,
      now,
      parse: (value) => assistantDiagnosticEventSchema.parse(value),
      policy: ASSISTANT_DIAGNOSTIC_EVENT_RETENTION,
      resolveTimestamp: (value) => value.at,
    }),
  ])

  return {
    diagnosticEvents,
    runtimeEvents,
  }
}

async function compactOptionalJsonLinesFile<T>(input: {
  filePath: string
  now: Date
  parse: (value: unknown) => T
  policy: JsonLineRetentionPolicy
  resolveTimestamp: (value: T) => string
}): Promise<JsonLineRetentionResult | null> {
  try {
    return await compactJsonLinesFile(input)
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }
    throw error
  }
}

async function compactJsonLinesFile<T>(input: {
  filePath: string
  now: Date
  parse: (value: unknown) => T
  policy: JsonLineRetentionPolicy
  resolveTimestamp: (value: T) => string
}): Promise<JsonLineRetentionResult> {
  const { originalBytes, raw, readBytes, readWasTruncated } =
    await readJsonLinesTail(input.filePath, input.policy)
  const parsed = parseAssistantJsonLinesWithTailSalvage(raw, input.parse)
  const minEventMs = input.now.getTime() - input.policy.maxAgeMs
  const retainedByAge = parsed.values.filter((value) => {
    const eventMs = Date.parse(input.resolveTimestamp(value))
    return Number.isFinite(eventMs) && eventMs >= minEventMs
  })
  const retainedByCount =
    typeof input.policy.maxEvents === 'number'
      ? retainedByAge.slice(-input.policy.maxEvents)
      : retainedByAge
  const retainedByBytes = retainNewestJsonLinesByBytes(
    retainedByCount,
    input.policy.maxBytes,
  )
  const retainedText =
    retainedByBytes.map((value) => JSON.stringify(value)).join('\n') +
    (retainedByBytes.length > 0 ? '\n' : '')

  await writeTextFileAtomic(input.filePath, retainedText)

  return {
    malformedLineCount: parsed.malformedLineCount,
    originalBytes,
    originalEventCount: parsed.values.length,
    readBytes,
    readWasTruncated,
    retainedBytes: Buffer.byteLength(retainedText, 'utf8'),
    retainedEventCount: retainedByBytes.length,
    salvagedTailLineCount: parsed.salvagedTailLineCount,
  }
}

async function readJsonLinesTail(
  filePath: string,
  policy: JsonLineRetentionPolicy,
): Promise<{
  originalBytes: number
  raw: string
  readBytes: number
  readWasTruncated: boolean
}> {
  const file = await open(filePath, 'r')
  try {
    const stats = await file.stat()
    const originalBytes = stats.size
    const maxReadBytes = Math.max(
      policy.maxBytes * EVENT_LOG_READ_WINDOW_MULTIPLIER,
      EVENT_LOG_MIN_READ_WINDOW_BYTES,
    )
    const readBytes = Math.min(originalBytes, maxReadBytes)
    if (readBytes === 0) {
      return {
        originalBytes,
        raw: '',
        readBytes,
        readWasTruncated: false,
      }
    }

    const buffer = Buffer.alloc(readBytes)
    const offset = originalBytes - readBytes
    const result = await file.read(buffer, 0, readBytes, offset)
    const raw = buffer.subarray(0, result.bytesRead).toString('utf8')
    const readWasTruncated = offset > 0
    return {
      originalBytes,
      raw: readWasTruncated ? dropLeadingPartialJsonLine(raw) : raw,
      readBytes: result.bytesRead,
      readWasTruncated,
    }
  } finally {
    await file.close()
  }
}

function dropLeadingPartialJsonLine(raw: string): string {
  const newlineIndex = raw.indexOf('\n')
  return newlineIndex === -1 ? '' : raw.slice(newlineIndex + 1)
}

function retainNewestJsonLinesByBytes<T>(
  values: readonly T[],
  maxBytes: number,
): T[] {
  const retained: T[] = []
  let totalBytes = 0

  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index]!
    const lineBytes = Buffer.byteLength(`${JSON.stringify(value)}\n`, 'utf8')
    if (lineBytes > maxBytes) {
      continue
    }
    if (retained.length > 0 && totalBytes + lineBytes > maxBytes) {
      break
    }
    retained.push(value)
    totalBytes += lineBytes
  }

  return retained.reverse()
}
