import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  DERIVED_KNOWLEDGE_LOG_PATH,
  type DerivedKnowledgeGraph,
  type DerivedKnowledgeNode,
} from '@murphai/query'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import {
  assertKnowledgeSourcePathAllowed,
  requireUniqueKnowledgePageBySlug,
  tailKnowledgeLog,
} from '../src/knowledge/service.ts'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map(async (targetPath) => {
      await rm(targetPath, { recursive: true, force: true })
    }),
  )
})

describe('knowledge service helpers', () => {
  it('rejects duplicate slugs with action-specific guidance and page-path context', () => {
    const graph = createKnowledgeGraph([
      createKnowledgeNode({
        relativePath: 'derived/knowledge/pages/sleep.md',
        slug: 'sleep',
      }),
      createKnowledgeNode({
        relativePath: 'derived/knowledge/pages/sleep-duplicate.md',
        slug: 'sleep',
      }),
    ])

    let thrown: unknown
    try {
      requireUniqueKnowledgePageBySlug(graph, 'sleep', 'upsert')
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(VaultCliError)
    expect(thrown).toMatchObject({
      code: 'knowledge_duplicate_slug',
      context: {
        slug: 'sleep',
        pagePaths: [
          'derived/knowledge/pages/sleep.md',
          'derived/knowledge/pages/sleep-duplicate.md',
        ],
      },
      message: expect.stringContaining('cannot be upserted safely'),
    })
  })

  it('allows only vault-relative knowledge source paths outside derived and runtime roots', () => {
    expect(() => assertKnowledgeSourcePathAllowed('journal/notes.md')).not.toThrow()
    expect(() => assertKnowledgeSourcePathAllowed('notes\\sleep.md')).not.toThrow()

    expectKnowledgeSourcePathError('/absolute/path.md', 'knowledge_invalid_source_path')
    expectKnowledgeSourcePathError('../escape.md', 'knowledge_invalid_source_path')
    expectKnowledgeSourcePathError('C:/vault/file.md', 'knowledge_invalid_source_path')
    expectKnowledgeSourcePathError('derived/knowledge/pages/sleep.md', 'knowledge_forbidden_source_path')
    expectKnowledgeSourcePathError('.runtime/cache/file.md', 'knowledge_forbidden_source_path')
    expectKnowledgeSourcePathError('assistant-state/memory.md', 'knowledge_forbidden_source_path')
  })

  it('tails knowledge log entries newest-first, clamps the limit, and treats a missing log as empty', async () => {
    const vaultRoot = await createTempDirectory('murph-knowledge-service-')
    const markdown = [
      '# Derived knowledge log',
      '',
      '_Append-only record of assistant-authored derived wiki writes._',
      '',
      '## [2026-04-07T09:00:00.000Z] upsert | Sleep',
      '',
      '- slug: `sleep`',
      '',
      '## [2026-04-08T10:00:00.000Z] upsert | Hydration',
      '',
      '- slug: `hydration`',
    ].join('\n')

    const latestOnly = await tailKnowledgeLog(
      { vault: vaultRoot, limit: 0 },
      {
        readTextFile: async () => markdown,
      },
    )
    expect(latestOnly).toEqual({
      count: 1,
      entries: [
        {
          action: 'upsert',
          block: ['## [2026-04-08T10:00:00.000Z] upsert | Hydration', '', '- slug: `hydration`'].join('\n'),
          occurredAt: '2026-04-08T10:00:00.000Z',
          title: 'Hydration',
        },
      ],
      limit: 1,
      logPath: DERIVED_KNOWLEDGE_LOG_PATH,
      vault: vaultRoot,
    })

    const missingLog = await tailKnowledgeLog(
      { vault: vaultRoot, limit: 5 },
      {
        readTextFile: async () => {
          const error = new Error('missing') as NodeJS.ErrnoException
          error.code = 'ENOENT'
          throw error
        },
      },
    )
    expect(missingLog).toEqual({
      count: 0,
      entries: [],
      limit: 5,
      logPath: DERIVED_KNOWLEDGE_LOG_PATH,
      vault: vaultRoot,
    })
  })
})

function expectKnowledgeSourcePathError(sourcePath: string, code: string): void {
  let thrown: unknown
  try {
    assertKnowledgeSourcePathAllowed(sourcePath)
  } catch (error) {
    thrown = error
  }

  expect(thrown).toMatchObject({
    code,
  })
}

async function createTempDirectory(prefix: string): Promise<string> {
  const directoryPath = await mkdtemp(path.join(tmpdir(), prefix))
  cleanupPaths.push(directoryPath)
  return directoryPath
}

function createKnowledgeGraph(nodes: DerivedKnowledgeNode[]): DerivedKnowledgeGraph {
  return {
    bySlug: new Map(nodes.map((node) => [node.slug, node])),
    indexPath: 'derived/knowledge/index.md',
    nodes,
    pagesRoot: 'derived/knowledge/pages',
  }
}

function createKnowledgeNode(
  overrides: Partial<DerivedKnowledgeNode> = {},
): DerivedKnowledgeNode {
  return {
    attributes: {},
    body: 'Body text.',
    compiledAt: '2026-04-08T10:00:00.000Z',
    librarySlugs: [],
    pageType: 'concept',
    relativePath: 'derived/knowledge/pages/example.md',
    relatedSlugs: [],
    slug: 'example',
    sourcePaths: ['journal/example.md'],
    status: 'active',
    summary: 'Body text.',
    title: 'Example',
    ...overrides,
  }
}
