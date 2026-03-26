import {
  assistantTranscriptEntrySchema,
  type AssistantTranscriptEntry,
} from '../../assistant-cli-contracts.js'

export interface ScannedAssistantTranscriptEntry {
  entry: AssistantTranscriptEntry
  lineNumber: number
  rawLine: string
}

export interface AssistantTranscriptScanIssue {
  kind: 'invalid-line' | 'truncated-tail'
  lineNumber: number
  message: string
  rawLine: string
}

export interface AssistantTranscriptScanResult {
  endedWithNewline: boolean
  entries: ScannedAssistantTranscriptEntry[]
  issues: AssistantTranscriptScanIssue[]
  rawByteLength: number
}

export function scanAssistantTranscriptText(
  raw: string,
): AssistantTranscriptScanResult {
  const lines = raw.split('\n')
  const entries: ScannedAssistantTranscriptEntry[] = []
  const issues: AssistantTranscriptScanIssue[] = []
  const endedWithNewline = raw.endsWith('\n')
  const lastNonEmptyLineIndex = findLastNonEmptyLineIndex(lines)

  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) {
      continue
    }

    const lineNumber = index + 1
    const parsed = parseTranscriptLine(line)
    if (parsed.ok) {
      entries.push({
        entry: parsed.entry,
        lineNumber,
        rawLine: line,
      })
      continue
    }

    const truncatedTail =
      index === lastNonEmptyLineIndex &&
      isLikelyTruncatedTail({
        endedWithNewline,
        error: parsed.error,
      })

    issues.push({
      kind: truncatedTail ? 'truncated-tail' : 'invalid-line',
      lineNumber,
      message: parsed.error.message,
      rawLine: line,
    })
  }

  return {
    endedWithNewline,
    entries,
    issues,
    rawByteLength: Buffer.byteLength(raw, 'utf8'),
  }
}

export function serializeAssistantTranscriptEntries(
  entries: readonly Pick<ScannedAssistantTranscriptEntry, 'rawLine'>[],
): string {
  if (entries.length === 0) {
    return ''
  }

  return `${entries.map((entry) => entry.rawLine).join('\n')}\n`
}

function findLastNonEmptyLineIndex(lines: readonly string[]): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if ((lines[index] ?? '').trim().length > 0) {
      return index
    }
  }

  return -1
}

function parseTranscriptLine(line: string):
  | {
      ok: true
      entry: AssistantTranscriptEntry
    }
  | {
      ok: false
      error: Error
    } {
  try {
    return {
      ok: true,
      entry: assistantTranscriptEntrySchema.parse(JSON.parse(line) as unknown),
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }
}

function isLikelyTruncatedTail(input: {
  endedWithNewline: boolean
  error: Error
}): boolean {
  if (!input.endedWithNewline) {
    return true
  }

  return /unexpected end|unterminated|string literal/u.test(input.error.message)
}
