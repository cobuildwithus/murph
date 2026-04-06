import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  getKnowledgePage,
  lintKnowledgePages,
  searchKnowledgePages,
  tailKnowledgeLog,
  upsertKnowledgePage,
} from '@murphai/vault-inbox/knowledge'

const createdVaultRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    createdVaultRoots.splice(0).map(async (vaultRoot) => {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      })
    }),
  )
})

describe('upsertKnowledgePage', () => {
  it('writes a derived knowledge page and rebuilds the markdown index', async () => {
    const vaultRoot = await createVaultRoot()
    const sourcePath = 'research/2026/04/sleep-note.md'
    await writeVaultFile(
      vaultRoot,
      'bank/library/sleep-architecture.md',
      [
        '---',
        'title: Sleep architecture',
        'slug: sleep-architecture',
        'entityType: biomarker',
        '---',
        '',
        '# Sleep architecture',
        '',
        'Stable reference page.',
        '',
      ].join('\n'),
    )
    await writeVaultFile(
      vaultRoot,
      sourcePath,
      '# Sleep note\n\nMagnesium seemed helpful on several recent nights.\n',
    )

    const result = await upsertKnowledgePage(
      {
        body: [
          '# Temporary heading',
          '',
          'Magnesium looked helpful in the recent notes.',
          '',
          '## Sources',
          '',
          '- `research/2026/04/stale-note.md`',
          '',
          '## Related',
          '',
          '- [[magnesium]]',
          '',
        ].join('\n'),
        librarySlugs: ['sleep-architecture'],
        vault: vaultRoot,
        title: 'Sleep quality',
        sourcePaths: [sourcePath],
      },
      {
        async saveText(input: { relativePath: string; content: string }) {
          await writeVaultFile(vaultRoot, input.relativePath, input.content)
        },
      },
    )

    expect(result.page).toMatchObject({
      librarySlugs: ['sleep-architecture'],
      pagePath: 'derived/knowledge/pages/sleep-quality.md',
      pageType: 'concept',
      relatedSlugs: ['magnesium'],
      slug: 'sleep-quality',
      sourcePaths: [sourcePath],
      status: 'active',
      title: 'Sleep quality',
    })
    expect(result.indexPath).toBe('derived/knowledge/index.md')

    const savedPage = await readFile(
      path.join(vaultRoot, 'derived/knowledge/pages/sleep-quality.md'),
      'utf8',
    )
    expect(savedPage).toContain('slug: sleep-quality')
    expect(savedPage).toContain('sourcePaths:')
    expect(savedPage).toContain('relatedSlugs:')
    expect(savedPage).toContain('# Sleep quality')
    expect(savedPage).not.toContain('stale-note.md')
    expect(savedPage).toContain('## Sources')
    expect(savedPage).toContain('## Related')
    expect(savedPage).toContain('`research/2026/04/sleep-note.md`')

    const savedIndex = await readFile(
      path.join(vaultRoot, 'derived/knowledge/index.md'),
      'utf8',
    )
    expect(savedIndex).toContain('# Derived knowledge index')
    expect(savedIndex).toContain('Sleep quality')

    const savedLog = await readFile(
      path.join(vaultRoot, 'derived/knowledge/log.md'),
      'utf8',
    )
    expect(savedLog).toContain('# Derived knowledge log')
    expect(savedLog).toContain('upsert | Sleep quality')
    expect(savedLog).toContain('librarySlugs: `sleep-architecture`')

    const shown = await getKnowledgePage({
      vault: vaultRoot,
      slug: 'sleep-quality',
    })
    expect(shown.page.markdown).toContain('# Sleep quality')
    expect(shown.page.librarySlugs).toEqual(['sleep-architecture'])
    expect(shown.page.relatedSlugs).toEqual(['magnesium'])

    const tailed = await tailKnowledgeLog({
      vault: vaultRoot,
      limit: 5,
    })
    expect(tailed.entries[0]).toMatchObject({
      action: 'upsert',
      title: 'Sleep quality',
    })
    expect(tailed.entries[0]?.block).toContain('librarySlugs: `sleep-architecture`')
    expect(tailed.entries[0]?.block).toContain('slug: `sleep-quality`')
  })

  it('reuses existing source paths when refreshing without new source paths', async () => {
    const vaultRoot = await createVaultRoot()
    const firstSourcePath = 'research/2026/04/sleep-note.md'
    await writeVaultFile(
      vaultRoot,
      firstSourcePath,
      '# Sleep note\n\nEarlier notes linked better sleep to magnesium.\n',
    )

    await upsertKnowledgePage(
      {
        body: '# Sleep quality\n\nThe first pass mostly referenced the older sleep note.\n',
        vault: vaultRoot,
        title: 'Sleep quality',
        sourcePaths: [firstSourcePath],
      },
      {
        async saveText(input: { relativePath: string; content: string }) {
          await writeVaultFile(vaultRoot, input.relativePath, input.content)
        },
      },
    )

    const refreshed = await upsertKnowledgePage(
      {
        body: '# Sleep quality\n\nThe refreshed page keeps the same source set.\n',
        vault: vaultRoot,
        slug: 'sleep-quality',
      },
      {
        async saveText(input: { relativePath: string; content: string }) {
          await writeVaultFile(vaultRoot, input.relativePath, input.content)
        },
      },
    )

    expect(refreshed.page.sourcePaths).toEqual([firstSourcePath])

    const savedPage = await readFile(
      path.join(vaultRoot, 'derived/knowledge/pages/sleep-quality.md'),
      'utf8',
    )
    expect(savedPage).toContain('`research/2026/04/sleep-note.md`')
  })

  it('preserves existing source paths when explicit new sources are provided on refresh', async () => {
    const vaultRoot = await createVaultRoot()
    const firstSourcePath = 'research/2026/04/sleep-note.md'
    const secondSourcePath = 'research/2026/04/magnesium-note.md'
    await writeVaultFile(vaultRoot, firstSourcePath, '# Sleep note\n')
    await writeVaultFile(vaultRoot, secondSourcePath, '# Magnesium note\n')

    const saveText = async (input: { relativePath: string; content: string }) => {
      await writeVaultFile(vaultRoot, input.relativePath, input.content)
    }

    await upsertKnowledgePage(
      {
        body: '# Sleep quality\n\nInitial page body.\n',
        vault: vaultRoot,
        title: 'Sleep quality',
        sourcePaths: [firstSourcePath],
      },
      { saveText },
    )

    const refreshed = await upsertKnowledgePage(
      {
        body: '# Sleep quality\n\nRefreshed with the new source only.\n',
        vault: vaultRoot,
        slug: 'sleep-quality',
        sourcePaths: [secondSourcePath],
      },
      { saveText },
    )

    expect(refreshed.page.sourcePaths).toEqual([firstSourcePath, secondSourcePath])
  })

  it('rejects directory source paths', async () => {
    const vaultRoot = await createVaultRoot()
    await writeVaultFile(vaultRoot, 'research/2026/04/sleep-note.md', '# Sleep note\n')
    await mkdir(path.join(vaultRoot, 'research/2026/04/folder-source'), {
      recursive: true,
    })

    await expect(
      upsertKnowledgePage({
        body: '# Sleep quality\n\nBody.\n',
        vault: vaultRoot,
        sourcePaths: ['research/2026/04/folder-source'],
      }),
    ).rejects.toMatchObject({
      code: 'knowledge_source_unreadable',
    })
  })

  it('stores truncated summaries without the local truncation marker', async () => {
    const vaultRoot = await createVaultRoot()
    const sourcePath = 'research/2026/04/long-note.md'
    const longParagraph = Array.from(
      { length: 80 },
      (_, index) => `detail-${index.toString().padStart(2, '0')}`,
    ).join(' ')
    await writeVaultFile(
      vaultRoot,
      sourcePath,
      '# Long note\n\nA longer note backs the generated summary.\n',
    )

    const result = await upsertKnowledgePage(
      {
        body: ['# Long note', '', longParagraph, ''].join('\n'),
        vault: vaultRoot,
        title: 'Long note',
        sourcePaths: [sourcePath],
      },
      {
        async saveText(input: { relativePath: string; content: string }) {
          await writeVaultFile(vaultRoot, input.relativePath, input.content)
        },
      },
    )

    const summary = result.page.summary ?? ''
    expect(summary).toBeTruthy()
    expect(summary).not.toContain('[truncated locally]')
    expect(summary.length).toBeLessThanOrEqual(220)
    expect(summary).toMatch(/\.\.\.$/u)

    const savedPage = await readFile(
      path.join(vaultRoot, 'derived/knowledge/pages/long-note.md'),
      'utf8',
    )
    expect(savedPage).not.toContain('[truncated locally]')
  })

  it('rejects derived or runtime paths as knowledge upsert sources', async () => {
    const vaultRoot = await createVaultRoot()
    await writeVaultFile(
      vaultRoot,
      'derived/knowledge/pages/existing.md',
      '# Existing\n',
    )

    await expect(
      upsertKnowledgePage(
        {
          body: '# Existing\n\nBody.\n',
          vault: vaultRoot,
          sourcePaths: ['derived/knowledge/pages/existing.md'],
        },
      ),
    ).rejects.toMatchObject({
      code: 'knowledge_forbidden_source_path',
    })
  })

  it('flags directory-valued source paths during lint', async () => {
    const vaultRoot = await createVaultRoot()
    await mkdir(path.join(vaultRoot, 'research/2026/04/folder-source'), {
      recursive: true,
    })
    await writeVaultFile(
      vaultRoot,
      'derived/knowledge/pages/sleep-quality.md',
      [
        '---',
        'title: Sleep quality',
        'slug: sleep-quality',
        'pageType: concept',
        'status: active',
        'sourcePaths:',
        '  - research/2026/04/folder-source',
        '---',
        '',
        '# Sleep quality',
        '',
        'Body text.',
        '',
      ].join('\n'),
    )

    const lint = await lintKnowledgePages({
      vault: vaultRoot,
    })

    expect(lint.problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing_source_path',
          slug: 'sleep-quality',
          severity: 'error',
        }),
      ]),
    )
  })

  it('searches the derived knowledge wiki without recompiling pages', async () => {
    const vaultRoot = await createVaultRoot()
    await writeVaultFile(
      vaultRoot,
      'derived/knowledge/pages/sleep-quality.md',
      [
        '---',
        'title: Sleep quality',
        'slug: sleep-quality',
        'pageType: concept',
        'status: active',
        'summary: Magnesium seemed to help recent sleep continuity.',
        '---',
        '',
        '# Sleep quality',
        '',
        'Magnesium looked helpful for fewer wakeups.',
        '',
        '## Sources',
        '',
        '- `research/2026/04/sleep-note.md`',
        '',
      ].join('\n'),
    )

    const result = await searchKnowledgePages({
      vault: vaultRoot,
      query: 'sleep magnesium',
    })

    expect(result.format).toBe('murph.knowledge-search.v1')
    expect(result.vault).toBe(vaultRoot)
    expect(result.hits[0]).toMatchObject({
      slug: 'sleep-quality',
      matchedTerms: ['magnesium', 'sleep'],
      pageType: 'concept',
      status: 'active',
    })
  })

  it('fails closed when duplicate slugs exist in derived knowledge pages', async () => {
    const vaultRoot = await createVaultRoot()
    const pageBody = [
      '---',
      'title: Sleep quality',
      'slug: sleep-quality',
      'pageType: concept',
      'status: active',
      'summary: Duplicate page.',
      '---',
      '',
      '# Sleep quality',
      '',
      'Duplicate content.',
      '',
      '## Sources',
      '',
      '- `research/2026/04/sleep-note.md`',
      '',
    ].join('\n')
    await writeVaultFile(vaultRoot, 'research/2026/04/sleep-note.md', '# Note\n')
    await writeVaultFile(vaultRoot, 'derived/knowledge/pages/sleep-quality.md', pageBody)
    await writeVaultFile(vaultRoot, 'derived/knowledge/pages/sleep-quality-copy.md', pageBody)

    await expect(
      getKnowledgePage({
        vault: vaultRoot,
        slug: 'sleep-quality',
      }),
    ).rejects.toMatchObject({
      code: 'knowledge_duplicate_slug',
    })
  })

  it('reports missing related pages and missing source files during lint', async () => {
    const vaultRoot = await createVaultRoot()
    await writeVaultFile(
      vaultRoot,
      'derived/knowledge/pages/sleep-quality.md',
      [
        '---',
        'title: Sleep quality',
        'slug: sleep-quality',
        'pageType: concept',
        'status: active',
        'relatedSlugs:',
        '  - magnesium',
        'sourcePaths:',
        '  - research/2026/04/missing-note.md',
        '---',
        '',
        '# Sleep quality',
        '',
        'Needs follow-up on [[magnesium]].',
        '',
        '## Sources',
        '',
        '- `research/2026/04/missing-note.md`',
        '',
      ].join('\n'),
    )

    const lint = await lintKnowledgePages({
      vault: vaultRoot,
    })

    expect(lint.ok).toBe(false)
    expect(lint.problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing_related_page',
          slug: 'sleep-quality',
        }),
        expect.objectContaining({
          code: 'missing_source_path',
          slug: 'sleep-quality',
          severity: 'error',
        }),
        ]),
    )
  })

  it('rejects unknown bank/library links during upsert and lints stale ones', async () => {
    const vaultRoot = await createVaultRoot()
    await writeVaultFile(
      vaultRoot,
      'research/2026/04/sleep-note.md',
      '# Sleep note\n',
    )

    await expect(
      upsertKnowledgePage({
        body: '# Sleep quality\n\nBody.\n',
        vault: vaultRoot,
        title: 'Sleep quality',
        librarySlugs: ['missing-library-page'],
        sourcePaths: ['research/2026/04/sleep-note.md'],
      }),
    ).rejects.toMatchObject({
      code: 'knowledge_invalid_library_slug',
    })

    await writeVaultFile(
      vaultRoot,
      'derived/knowledge/pages/sleep-quality.md',
      [
        '---',
        'title: Sleep quality',
        'slug: sleep-quality',
        'pageType: concept',
        'status: active',
        'librarySlugs:',
        '  - missing-library-page',
        'sourcePaths:',
        '  - research/2026/04/sleep-note.md',
        '---',
        '',
        '# Sleep quality',
        '',
        'Body.',
        '',
      ].join('\n'),
    )

    const lint = await lintKnowledgePages({
      vault: vaultRoot,
    })

    expect(lint.problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid_library_slug',
          slug: 'sleep-quality',
          severity: 'warning',
        }),
      ]),
    )
  })

  it('allows stale library links to be cleared during upsert and tolerates malformed unrelated library pages', async () => {
    const vaultRoot = await createVaultRoot()
    await writeVaultFile(
      vaultRoot,
      'research/2026/04/sleep-note.md',
      '# Sleep note\n',
    )
    await writeVaultFile(
      vaultRoot,
      'bank/library/sleep-architecture.md',
      [
        '---',
        'title: Sleep architecture',
        'slug: sleep-architecture',
        'entityType: biomarker',
        '---',
        '',
        '# Sleep architecture',
        '',
      ].join('\n'),
    )
    await writeVaultFile(
      vaultRoot,
      'bank/library/broken.md',
      [
        '---',
        'title: Broken',
        'slug: broken',
        '',
        '# Broken',
      ].join('\n'),
    )
    await writeVaultFile(
      vaultRoot,
      'derived/knowledge/pages/sleep-quality.md',
      [
        '---',
        'title: Sleep quality',
        'slug: sleep-quality',
        'pageType: concept',
        'status: active',
        'librarySlugs:',
        '  - missing-library-page',
        'sourcePaths:',
        '  - research/2026/04/sleep-note.md',
        '---',
        '',
        '# Sleep quality',
        '',
        'Body.',
        '',
      ].join('\n'),
    )

    const cleared = await upsertKnowledgePage(
      {
        body: '# Sleep quality\n\nUpdated body.\n',
        clearLibrarySlugs: true,
        vault: vaultRoot,
        slug: 'sleep-quality',
      },
      {
        async saveText(input: { relativePath: string; content: string }) {
          await writeVaultFile(vaultRoot, input.relativePath, input.content)
        },
      },
    )

    expect(cleared.page.librarySlugs).toEqual([])

    const replaced = await upsertKnowledgePage(
      {
        body: '# Sleep quality\n\nUpdated again.\n',
        clearLibrarySlugs: true,
        librarySlugs: ['sleep-architecture'],
        vault: vaultRoot,
        slug: 'sleep-quality',
      },
      {
        async saveText(input: { relativePath: string; content: string }) {
          await writeVaultFile(vaultRoot, input.relativePath, input.content)
        },
      },
    )

    expect(replaced.page.librarySlugs).toEqual(['sleep-architecture'])

    const lint = await lintKnowledgePages({
      vault: vaultRoot,
    })

    expect(lint.problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'library_parse_frontmatter',
          pagePath: 'bank/library/broken.md',
          severity: 'warning',
          slug: null,
        }),
      ]),
    )
  })

  it('ignores stale generated sections and lints only canonical frontmatter metadata', async () => {
    const vaultRoot = await createVaultRoot()
    await writeVaultFile(
      vaultRoot,
      'research/2026/04/current-note.md',
      '# Current note\n',
    )
    await writeVaultFile(
      vaultRoot,
      'derived/knowledge/pages/magnesium.md',
      [
        '---',
        'title: Magnesium',
        'slug: magnesium',
        'pageType: concept',
        'status: active',
        '---',
        '',
        '# Magnesium',
        '',
        'Support page.',
        '',
      ].join('\n'),
    )
    await writeVaultFile(
      vaultRoot,
      'derived/knowledge/pages/sleep-quality.md',
      [
        '---',
        'title: Sleep quality',
        'slug: sleep-quality',
        'pageType: concept',
        'status: active',
        'summary: Sleep continuity notes.',
        'sourcePaths:',
        '  - research/2026/04/current-note.md',
        'relatedSlugs:',
        '  - magnesium',
        '---',
        '',
        '# Sleep quality',
        '',
        'Body still points at [[stale-link]].',
        '',
        '## Sources',
        '',
        '- `derived/knowledge/pages/old.md`',
        '',
      ].join('\n'),
    )

    const lint = await lintKnowledgePages({
      vault: vaultRoot,
    })

    expect(lint.problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing_sources',
          slug: 'magnesium',
          severity: 'warning',
        }),
      ]),
    )
    expect(
      lint.problems.some(
        (problem: { code: string }) => problem.code === 'forbidden_source_path',
      ),
    ).toBe(false)
    expect(
      lint.problems.some(
        (problem: { code: string }) => problem.code === 'source_paths_drift',
      ),
    ).toBe(false)
    expect(
      lint.problems.some(
        (problem: { code: string }) => problem.code === 'related_slugs_drift',
      ),
    ).toBe(false)
  })
})

async function createVaultRoot(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-knowledge-runtime-'))
  createdVaultRoots.push(vaultRoot)
  return vaultRoot
}

async function writeVaultFile(
  vaultRoot: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath)
  await mkdir(path.dirname(absolutePath), {
    recursive: true,
  })
  await writeFile(absolutePath, content, 'utf8')
}
