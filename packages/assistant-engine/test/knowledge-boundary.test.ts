import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as knowledge from '../src/knowledge.ts'

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rootIndexPath = path.join(packageDir, 'src', 'index.ts')
const knowledgeEntryPath = path.join(packageDir, 'src', 'knowledge.ts')

describe('assistant-engine knowledge boundary', () => {
  it('keeps knowledge off the ambient root barrel', async () => {
    const source = await readFile(rootIndexPath, 'utf8')

    expect(source).not.toContain('./knowledge.js')
  })

  it('keeps helper and contract shims off the knowledge entrypoint', async () => {
    const source = await readFile(knowledgeEntryPath, 'utf8')

    expect(Object.keys(knowledge)).not.toContain('assertKnowledgeSourcePathAllowed')
    expect(source).not.toContain('./knowledge/documents.js')
    expect(source).not.toContain('assertKnowledgeSourcePathAllowed')
    expect(source).not.toContain('@murphai/query')
  })
})
