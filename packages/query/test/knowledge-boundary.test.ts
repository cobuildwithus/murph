import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJsonPath = path.join(packageDir, 'package.json')
const rootIndexPath = path.join(packageDir, 'src', 'index.ts')
const knowledgeGraphPath = path.join(packageDir, 'src', 'knowledge-graph.ts')

describe('query knowledge boundary', () => {
  it('keeps knowledge search and contract helpers off duplicate public subpaths', async () => {
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
      exports?: Record<string, unknown>
    }

    expect(Object.keys(packageJson.exports ?? {})).not.toContain('./knowledge-contracts')
    expect(Object.keys(packageJson.exports ?? {})).not.toContain('./knowledge-search')
  })

  it('keeps the root barrel as the public knowledge owner', async () => {
    const source = await readFile(rootIndexPath, 'utf8')

    expect(source).toContain('./knowledge-search.ts')
    expect(source).toContain('./knowledge-contracts.ts')
  })

  it('keeps graph loading independent from search-only contracts', async () => {
    const source = await readFile(knowledgeGraphPath, 'utf8')

    expect(source).not.toContain('./knowledge-search.ts')
    expect(source).not.toMatch(/\bDerivedKnowledgeSearch(?:Filters|Hit|Result)\b/u)
  })
})
