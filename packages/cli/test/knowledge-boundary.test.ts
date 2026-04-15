import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  knowledgeGetResultSchema,
  knowledgeIndexRebuildResultSchema,
  knowledgeLintResultSchema,
  knowledgeListResultSchema,
  knowledgeLogTailResultSchema,
  knowledgeSearchResultSchema,
  knowledgeUpsertResultSchema,
} from '@murphai/query'

import { vaultCliCommandDescriptors } from '../src/vault-cli-command-manifest.ts'

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rootIndexPath = path.join(packageDir, 'src', 'index.ts')

describe('cli knowledge boundary', () => {
  it('keeps knowledge contracts off the published CLI root surface', async () => {
    const source = await readFile(rootIndexPath, 'utf8')

    expect(source).not.toContain('./knowledge-cli-contracts.js')
  })

  it('uses query-owned knowledge schemas directly in the command manifest', () => {
    const knowledgeDescriptor = vaultCliCommandDescriptors.find(
      (descriptor) => descriptor.id === 'knowledge',
    )

    if (
      !knowledgeDescriptor
      || !('leafCommands' in knowledgeDescriptor)
      || !knowledgeDescriptor.leafCommands
    ) {
      throw new Error('The knowledge command descriptor is missing its leaf commands.')
    }

    const outputsByPath = new Map(
      knowledgeDescriptor.leafCommands.map((leafCommand) => [
        leafCommand.path.join(' '),
        'output' in leafCommand ? leafCommand.output : undefined,
      ]),
    )

    expect(outputsByPath.get('knowledge upsert')).toBe(knowledgeUpsertResultSchema)
    expect(outputsByPath.get('knowledge list')).toBe(knowledgeListResultSchema)
    expect(outputsByPath.get('knowledge search')).toBe(knowledgeSearchResultSchema)
    expect(outputsByPath.get('knowledge show')).toBe(knowledgeGetResultSchema)
    expect(outputsByPath.get('knowledge lint')).toBe(knowledgeLintResultSchema)
    expect(outputsByPath.get('knowledge log tail')).toBe(knowledgeLogTailResultSchema)
    expect(outputsByPath.get('knowledge index rebuild')).toBe(knowledgeIndexRebuildResultSchema)
  })
})
