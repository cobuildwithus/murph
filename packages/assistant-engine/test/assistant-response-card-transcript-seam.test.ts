import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const sourcePath = path.resolve(testDirectory, '../src/assistant-codex.ts')

describe('assistant response-card transcript seam', () => {
  it('keeps internal card authority in transcript context but out of public fallback', async () => {
    const source = await readFile(sourcePath, 'utf8')

    expect(source).toContain('renderAssistantResponseCardTranscriptText')
    expect(source).toContain(
      '? renderAssistantResponseCardTranscriptText(trailingSteerCandidate.card)',
    )
    expect(source).toContain(
      '? renderAssistantResponseCardTranscriptText(finalResponseCard)',
    )
    expect(source).toContain(
      'const semanticFinalMessage = finalResponseCard\n    ? renderAssistantResponseCardText(finalResponseCard)',
    )
  })
})
