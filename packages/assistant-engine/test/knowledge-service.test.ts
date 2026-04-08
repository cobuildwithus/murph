import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  DERIVED_KNOWLEDGE_LOG_PATH,
  DERIVED_KNOWLEDGE_PAGES_ROOT,
  type DerivedKnowledgeGraph,
  type DerivedKnowledgeNode,
} from '@murphai/query'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import { buildKnowledgeMarkdown } from '../src/knowledge/documents.ts'
import {
  assertKnowledgeSourcePathAllowed,
  getKnowledgePage,
  lintKnowledgePages,
  listKnowledgePages,
  requireUniqueKnowledgePageBySlug,
  rebuildKnowledgeIndex,
  searchKnowledgePages,
  tailKnowledgeLog,
  upsertKnowledgePage,
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

    expect(() => requireUniqueKnowledgePageBySlug(graph, 'sleep', 'get')).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining('cannot be shown safely'),
      }),
    )
    expect(() => requireUniqueKnowledgePageBySlug(graph, 'sleep', 'reload')).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining('cannot be reloaded safely'),
      }),
    )
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

    await expect(
      tailKnowledgeLog(
        { vault: vaultRoot, limit: 5 },
        {
          readTextFile: async () => {
            throw new Error('permission denied')
          },
        },
      ),
    ).rejects.toThrow('permission denied')
  })

  it('upserts a page into the vault, merges existing sources, and appends the knowledge log', async () => {
    const vaultRoot = await createKnowledgeVaultRoot('murph-knowledge-upsert-')
    await writeVaultFile(vaultRoot, 'journal/existing.md', 'Existing evidence.\n')
    await writeVaultFile(vaultRoot, 'journal/new.md', 'New evidence.\n')
    await writeKnowledgePage(
      vaultRoot,
      'hydration',
      buildKnowledgeMarkdown({
        body: 'Hydration helps.',
        compiledAt: '2026-04-07T09:00:00.000Z',
        librarySlugs: [],
        pageType: 'concept',
        relatedSlugs: [],
        slug: 'hydration',
        sourcePaths: ['journal/existing.md'],
        status: 'active',
        summary: 'Hydration helps.',
        title: 'Hydration',
      }),
    )

    const result = await upsertKnowledgePage(
      {
        body: 'Hydration supports recovery and references [[sleep]].',
        slug: 'hydration',
        sourcePaths: ['journal/new.md'],
        vault: vaultRoot,
      },
      {
        now: () => new Date('2026-04-08T12:00:00.000Z'),
        readTextFile: async (filePath) => await readFile(filePath, 'utf8'),
        saveText: async ({ relativePath, content }) => {
          await writeVaultFile(vaultRoot, relativePath, content)
        },
      },
    )

    expect(result).toMatchObject({
      bodyLength: 'Hydration supports recovery and references [[sleep]].'.length,
      indexPath: 'derived/knowledge/index.md',
      page: {
        pagePath: 'derived/knowledge/pages/hydration.md',
        relatedSlugs: ['sleep'],
        slug: 'hydration',
        sourcePaths: ['journal/existing.md', 'journal/new.md'],
        title: 'Hydration',
      },
      savedAt: '2026-04-08T12:00:00.000Z',
      vault: vaultRoot,
    })

    const savedPage = await readFile(
      path.join(vaultRoot, DERIVED_KNOWLEDGE_PAGES_ROOT, 'hydration.md'),
      'utf8',
    )
    expect(savedPage).toContain('compiledAt: 2026-04-08T12:00:00.000Z')
    expect(savedPage).toContain('- journal/existing.md')
    expect(savedPage).toContain('- journal/new.md')
    expect(savedPage).toContain('- sleep')

    const savedLog = await readFile(path.join(vaultRoot, DERIVED_KNOWLEDGE_LOG_PATH), 'utf8')
    expect(savedLog).toContain('## [2026-04-08T12:00:00.000Z] upsert | Hydration')
    expect(savedLog).toContain('- slug: `hydration`')
  })

  it('lists, searches, gets, and rebuilds knowledge pages with normalized filters', async () => {
    const vaultRoot = await createKnowledgeVaultRoot('murph-knowledge-read-')
    await writeKnowledgePage(
      vaultRoot,
      'hydration',
      [
        '---',
        'title: Hydration',
        'slug: hydration',
        'pageType: concept-note',
        'status: active',
        'summary: Hydration helps recovery.',
        'sourcePaths:',
        '  - journal/hydration.md',
        '---',
        '',
        '# Hydration',
        '',
        'Hydration helps recovery and sleep.',
        '',
      ].join('\n'),
    )
    await writeKnowledgePage(
      vaultRoot,
      'magnesium',
      [
        '---',
        'title: Magnesium',
        'slug: magnesium',
        'pageType: supplement',
        'status: archived',
        'summary: Supplement notes.',
        'sourcePaths:',
        '  - journal/magnesium.md',
        '---',
        '',
        '# Magnesium',
        '',
        'Archived notes.',
        '',
      ].join('\n'),
    )
    await writeVaultFile(vaultRoot, 'journal/hydration.md', 'Hydration source.\n')
    await writeVaultFile(vaultRoot, 'journal/magnesium.md', 'Magnesium source.\n')

    const listResult = await listKnowledgePages({
      pageType: ' concept note ',
      status: 'ACTIVE',
      vault: vaultRoot,
    })
    expect(listResult).toMatchObject({
      pageCount: 1,
      pageType: 'concept-note',
      status: 'active',
      pages: [
        expect.objectContaining({
          slug: 'hydration',
          title: 'Hydration',
        }),
      ],
    })

    const searchResult = await searchKnowledgePages({
      limit: 1,
      pageType: 'concept note',
      query: ' recovery ',
      vault: vaultRoot,
    })
    expect(searchResult).toMatchObject({
      pageType: 'concept-note',
      status: null,
      total: 1,
      vault: vaultRoot,
    })
    expect(searchResult.hits[0]).toMatchObject({
      slug: 'hydration',
      title: 'Hydration',
    })

    const getResult = await getKnowledgePage(
      {
        slug: ' Hydration ',
        vault: vaultRoot,
      },
      {
        readTextFile: async (filePath) => await readFile(filePath, 'utf8'),
      },
    )
    expect(getResult.page).toMatchObject({
      slug: 'hydration',
      title: 'Hydration',
    })
    expect(getResult.page.markdown).toContain('# Hydration')

    const writes: Array<{ content: string; relativePath: string }> = []
    const rebuildResult = await rebuildKnowledgeIndex(
      {
        vault: vaultRoot,
      },
      {
        now: () => new Date('2026-04-08T18:00:00.000Z'),
        saveText: async ({ relativePath, content }) => {
          writes.push({ content, relativePath })
        },
      },
    )
    expect(rebuildResult).toEqual({
      indexPath: 'derived/knowledge/index.md',
      pageCount: 2,
      pageTypes: ['concept-note', 'supplement'],
      rebuilt: true,
      vault: vaultRoot,
    })
    expect(writes).toHaveLength(1)
    expect(writes[0]?.relativePath).toBe('derived/knowledge/index.md')
    expect(writes[0]?.content).toContain('[Hydration](pages/hydration.md)')
    expect(writes[0]?.content).toContain('[Magnesium](pages/magnesium.md)')
  })

  it('reports lint problems for invalid source paths, missing files, and missing related pages', async () => {
    const vaultRoot = await createKnowledgeVaultRoot('murph-knowledge-lint-')
    await writeKnowledgePage(
      vaultRoot,
      'hydration',
      [
        '---',
        'title: Hydration',
        'slug: hydration',
        'pageType: concept',
        'status: active',
        'relatedSlugs:',
        '  - sleep',
        'sourcePaths:',
        '  - ../outside.md',
        '  - derived/knowledge/index.md',
        '  - journal/missing.md',
        '---',
        '',
        '# Hydration',
        '',
        'Hydration body.',
        '',
      ].join('\n'),
    )

    const result = await lintKnowledgePages({ vault: vaultRoot })

    expect(result.ok).toBe(false)
    expect(result.pageCount).toBe(1)
    expect(result.problems.map((problem) => problem.code)).toEqual([
      'forbidden_source_path',
      'invalid_source_path',
      'missing_source_path',
      'missing_related_page',
    ])
  })

  it('sorts equally-severe lint problems by page path before code', async () => {
    const vaultRoot = await createKnowledgeVaultRoot('murph-knowledge-lint-sort-')
    await writeKnowledgePage(
      vaultRoot,
      'zeta',
      [
        '---',
        'title: Zeta',
        'slug: zeta',
        'pageType: concept',
        'status: active',
        'sourcePaths:',
        '  - derived/knowledge/index.md',
        '---',
        '',
        '# Zeta',
        '',
      ].join('\n'),
    )
    await writeKnowledgePage(
      vaultRoot,
      'alpha',
      [
        '---',
        'title: Alpha',
        'slug: alpha',
        'pageType: concept',
        'status: active',
        'sourcePaths:',
        '  - derived/knowledge/index.md',
        '---',
        '',
        '# Alpha',
        '',
      ].join('\n'),
    )

    const result = await lintKnowledgePages({ vault: vaultRoot })

    const orderedErrorPaths = result.problems
      .filter((problem) => problem.severity === 'error')
      .map((problem) => problem.pagePath)
    expect(orderedErrorPaths).toEqual([
      'derived/knowledge/pages/alpha.md',
      'derived/knowledge/pages/alpha.md',
      'derived/knowledge/pages/zeta.md',
      'derived/knowledge/pages/zeta.md',
    ])
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

async function createKnowledgeVaultRoot(prefix: string): Promise<string> {
  const vaultRoot = await createTempDirectory(prefix)
  await mkdir(path.join(vaultRoot, DERIVED_KNOWLEDGE_PAGES_ROOT), {
    recursive: true,
  })
  return vaultRoot
}

async function writeKnowledgePage(
  vaultRoot: string,
  slug: string,
  markdown: string,
): Promise<void> {
  await writeVaultFile(
    vaultRoot,
    path.posix.join(DERIVED_KNOWLEDGE_PAGES_ROOT, `${slug}.md`),
    markdown,
  )
}

async function writeVaultFile(
  vaultRoot: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content, 'utf8')
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
