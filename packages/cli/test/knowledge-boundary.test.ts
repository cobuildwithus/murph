import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rootIndexPath = path.join(packageDir, 'src', 'index.ts')
const knowledgeContractsPath = path.join(packageDir, 'src', 'knowledge-cli-contracts.ts')

describe('cli knowledge boundary', () => {
  it('keeps knowledge contracts off the published CLI root surface', async () => {
    const source = await readFile(rootIndexPath, 'utf8')

    expect(source).not.toContain('./knowledge-cli-contracts.js')
  })

  it('keeps the package-local knowledge schema shim pointed at the query owner', async () => {
    const source = await readFile(knowledgeContractsPath, 'utf8')

    expect(source).toContain("from '@murphai/query'")
    expect(source).toContain('KnowledgeGetResult as KnowledgeShowResult')
  })
})
