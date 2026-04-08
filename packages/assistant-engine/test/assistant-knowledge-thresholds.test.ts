import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { DerivedKnowledgeGraph, DerivedKnowledgeNode } from '@murphai/query'
import { DERIVED_KNOWLEDGE_PAGES_ROOT } from '@murphai/query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildKnowledgeMarkdown } from '../src/knowledge/documents.ts'

const tempRoots: string[] = []

afterEach(async () => {
  vi.resetModules()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.doUnmock('@murphai/query')
  vi.doUnmock('@murphai/vault-usecases/runtime')

  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('assistant knowledge threshold coverage', () => {
  it('covers lint warning branches while keeping valid related pages and source paths clean', async () => {
    const vaultRoot = await createKnowledgeVaultRoot('assistant-knowledge-thresholds-')
    await writeVaultFile(vaultRoot, 'journal/evidence.md', 'Hydration evidence.\n')

    const graph = createKnowledgeGraph([
      createKnowledgeNode({
        body: '   ',
        librarySlugs: ['known-library'],
        pageType: null,
        relatedSlugs: ['present-page'],
        relativePath: 'derived/knowledge/pages/mismatch.md',
        slug: 'empty-page',
        sourcePaths: [],
        status: null,
        summary: null,
        title: 'Empty page',
      }),
      createKnowledgeNode({
        librarySlugs: ['missing-library'],
        relatedSlugs: ['empty-page'],
        relativePath: 'derived/knowledge/pages/present-page.md',
        slug: 'present-page',
        sourcePaths: ['journal/evidence.md'],
        title: 'Present page',
      }),
    ])

    vi.doMock('@murphai/query', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@murphai/query')>()
      return {
        ...actual,
        readDerivedKnowledgeGraphWithIssues: vi.fn(async () => ({
          graph,
          issues: [],
        })),
        readHealthLibraryGraphWithIssues: vi.fn(async () => ({
          graph: {
            bySlug: new Map([['known-library', {}]]),
          },
          issues: [],
        })),
      }
    })

    const { lintKnowledgePages } = await import('../src/knowledge/service.ts')
    const result = await lintKnowledgePages({ vault: vaultRoot })

    expect(result.ok).toBe(false)
    expect(result.problemCount).toBe(7)
    expect(result.problems.map((problem) => problem.code)).toEqual([
      'empty_body',
      'missing_page_type',
      'missing_sources',
      'missing_status',
      'missing_summary',
      'slug_path_mismatch',
      'invalid_library_slug',
    ])
  })

  it('rejects upserts with unknown library slugs before writing files', async () => {
    const vaultRoot = await createKnowledgeVaultRoot('assistant-knowledge-library-')
    const saveText = vi.fn()

    vi.doMock('@murphai/query', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@murphai/query')>()
      return {
        ...actual,
        readDerivedKnowledgeGraphWithIssues: vi.fn(async () => ({
          graph: createKnowledgeGraph([]),
          issues: [],
        })),
        readHealthLibraryGraphWithIssues: vi.fn(async () => ({
          graph: {
            bySlug: new Map(),
          },
          issues: [],
        })),
      }
    })

    const { upsertKnowledgePage } = await import('../src/knowledge/service.ts')

    await expect(
      upsertKnowledgePage(
        {
          body: 'Hydration notes.',
          librarySlugs: ['missing-library'],
          slug: 'hydration',
          vault: vaultRoot,
        },
        {
          saveText,
        },
      ),
    ).rejects.toMatchObject({
      code: 'knowledge_invalid_library_slug',
      context: {
        invalidLibrarySlugs: ['missing-library'],
      },
    })

    expect(saveText).not.toHaveBeenCalled()
  })

  it('surfaces duplicate slugs during lint aggregation for every conflicting page', async () => {
    const vaultRoot = await createKnowledgeVaultRoot('assistant-knowledge-duplicates-')
    const graph = createKnowledgeGraph([
      createKnowledgeNode({
        relativePath: 'derived/knowledge/pages/duplicate-a.md',
        slug: 'duplicate',
        sourcePaths: [],
      }),
      createKnowledgeNode({
        relativePath: 'derived/knowledge/pages/duplicate-b.md',
        slug: 'duplicate',
        sourcePaths: [],
      }),
    ])

    vi.doMock('@murphai/query', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@murphai/query')>()
      return {
        ...actual,
        readDerivedKnowledgeGraphWithIssues: vi.fn(async () => ({
          graph,
          issues: [],
        })),
        readHealthLibraryGraphWithIssues: vi.fn(async () => ({
          graph: {
            bySlug: new Map(),
          },
          issues: [],
        })),
      }
    })

    const { lintKnowledgePages } = await import('../src/knowledge/service.ts')
    const result = await lintKnowledgePages({ vault: vaultRoot })

    expect(
      result.problems.filter((problem) => problem.code === 'duplicate_slug'),
    ).toEqual([
      expect.objectContaining({
        pagePath: 'derived/knowledge/pages/duplicate-a.md',
        slug: 'duplicate',
      }),
      expect.objectContaining({
        pagePath: 'derived/knowledge/pages/duplicate-b.md',
        slug: 'duplicate',
      }),
    ])
  })

  it('rejects directory source paths after validating a non-empty library slug list', async () => {
    const vaultRoot = await createKnowledgeVaultRoot('assistant-knowledge-source-errors-')
    await mkdir(path.join(vaultRoot, 'journal', 'directory-source'), {
      recursive: true,
    })

    vi.doMock('@murphai/query', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@murphai/query')>()
      return {
        ...actual,
        readDerivedKnowledgeGraphWithIssues: vi.fn(async () => ({
          graph: createKnowledgeGraph([]),
          issues: [],
        })),
        readHealthLibraryGraphWithIssues: vi.fn(async () => ({
          graph: {
            bySlug: new Map([['known-library', {}]]),
          },
          issues: [],
        })),
      }
    })

    const { upsertKnowledgePage } = await import('../src/knowledge/service.ts')

    await expect(
      upsertKnowledgePage({
        body: 'Hydration notes.',
        librarySlugs: ['known-library'],
        slug: 'hydration',
        sourcePaths: ['journal/directory-source'],
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'knowledge_source_unreadable',
      context: {
        cause: 'Path is not a file.',
        sourcePath: 'journal/directory-source',
      },
    })
  })

  it('uses the default file reader and integrated runtime writer when dependencies are omitted', async () => {
    const vaultRoot = await createKnowledgeVaultRoot('assistant-knowledge-runtime-')
    await writeKnowledgePage(
      vaultRoot,
      'hydration',
      buildKnowledgeMarkdown({
        body: 'Hydration helps recovery.',
        compiledAt: '2026-04-08T12:00:00.000Z',
        librarySlugs: [],
        pageType: 'concept',
        relatedSlugs: [],
        slug: 'hydration',
        sourcePaths: ['journal/hydration.md'],
        status: 'active',
        summary: 'Hydration helps recovery.',
        title: 'Hydration',
      }),
    )

    const applyCanonicalWriteBatch = vi.fn(async () => undefined)
    const loadIntegratedRuntime = vi.fn(async () => ({
      core: {
        applyCanonicalWriteBatch,
      },
    }))

    vi.doMock('@murphai/vault-usecases/runtime', () => ({
      loadIntegratedRuntime,
    }))

    const { getKnowledgePage, rebuildKnowledgeIndex } = await import('../src/knowledge/service.ts')

    const pageResult = await getKnowledgePage({
      slug: 'hydration',
      vault: vaultRoot,
    })
    expect(pageResult.page.markdown).toContain('# Hydration')

    const rebuildResult = await rebuildKnowledgeIndex({
      vault: vaultRoot,
    })
    expect(rebuildResult).toMatchObject({
      pageCount: 1,
      pageTypes: ['concept'],
      rebuilt: true,
    })
    expect(loadIntegratedRuntime).toHaveBeenCalledTimes(1)
    expect(applyCanonicalWriteBatch).toHaveBeenCalledWith({
      operationType: 'knowledge_index.rebuild',
      summary: 'Rebuilt the derived knowledge index.',
      textWrites: [
        expect.objectContaining({
          overwrite: true,
          relativePath: 'derived/knowledge/index.md',
        }),
      ],
      vaultRoot: vaultRoot,
    })
  })
})

async function createKnowledgeVaultRoot(prefix: string): Promise<string> {
  const vaultRoot = await createTempDirectory(prefix)
  await mkdir(path.join(vaultRoot, DERIVED_KNOWLEDGE_PAGES_ROOT), {
    recursive: true,
  })
  return vaultRoot
}

async function createTempDirectory(prefix: string): Promise<string> {
  const directoryPath = await mkdtemp(path.join(tmpdir(), prefix))
  tempRoots.push(directoryPath)
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
