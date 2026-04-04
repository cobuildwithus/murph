import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  compileKnowledgePage,
  lintKnowledgePages,
  searchKnowledgePages,
  showKnowledgePage,
} from '../src/knowledge-runtime.js'

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

describe('compileKnowledgePage', () => {
  it('writes a derived knowledge page and rebuilds the markdown index', async () => {
    const vaultRoot = await createVaultRoot()
    const sourcePath = 'research/2026/04/sleep-note.md'
    await writeVaultFile(
      vaultRoot,
      sourcePath,
      '# Sleep note\n\nMagnesium seemed helpful on several recent nights.\n',
    )

    const result = await compileKnowledgePage(
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
        vault: vaultRoot,
        prompt: 'Summarize the current sleep-quality notes.',
        title: 'Sleep quality',
        sourcePaths: [sourcePath],
      },
      {
        async saveText(input) {
          await writeVaultFile(vaultRoot, input.relativePath, input.content)
        },
      },
    )

    expect(result.page).toMatchObject({
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
    expect(savedPage).toContain('compiler: assistant')
    expect(savedPage).toContain('# Sleep quality')
    expect(savedPage).not.toContain('stale-note.md')
    expect(savedPage).toContain('## Sources')
    expect(savedPage).toContain('## Related')
    expect(savedPage).toContain('`research/2026/04/sleep-note.md`')
    expect(savedPage).not.toContain('sourcePaths:')
    expect(savedPage).not.toContain('relatedSlugs:')

    const savedIndex = await readFile(
      path.join(vaultRoot, 'derived/knowledge/index.md'),
      'utf8',
    )
    expect(savedIndex).toContain('# Derived knowledge index')
    expect(savedIndex).toContain('Sleep quality')

    const shown = await showKnowledgePage({
      vault: vaultRoot,
      slug: 'sleep-quality',
    })
    expect(shown.page.markdown).toContain('# Sleep quality')
    expect(shown.page.relatedSlugs).toEqual(['magnesium'])
  })

  it('reuses existing source paths when refreshing without new source paths', async () => {
    const vaultRoot = await createVaultRoot()
    const firstSourcePath = 'research/2026/04/sleep-note.md'
    await writeVaultFile(
      vaultRoot,
      firstSourcePath,
      '# Sleep note\n\nEarlier notes linked better sleep to magnesium.\n',
    )

    await compileKnowledgePage(
      {
        body: '# Sleep quality\n\nThe first pass mostly referenced the older sleep note.\n',
        vault: vaultRoot,
        prompt: 'Summarize my current sleep-quality notes.',
        title: 'Sleep quality',
        sourcePaths: [firstSourcePath],
      },
      {
        async saveText(input: { relativePath: string; content: string }) {
          await writeVaultFile(vaultRoot, input.relativePath, input.content)
        },
      },
    )

    const refreshed = await compileKnowledgePage(
      {
        body: '# Sleep quality\n\nThe refreshed page keeps the same source set.\n',
        vault: vaultRoot,
        prompt: 'Refresh the sleep-quality page with the latest framing.',
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

    await compileKnowledgePage(
      {
        body: '# Sleep quality\n\nInitial page body.\n',
        vault: vaultRoot,
        prompt: 'Create the sleep-quality page.',
        title: 'Sleep quality',
        sourcePaths: [firstSourcePath],
      },
      { saveText },
    )

    const refreshed = await compileKnowledgePage(
      {
        body: '# Sleep quality\n\nRefreshed with the new source only.\n',
        vault: vaultRoot,
        prompt: 'Refresh from the magnesium note only.',
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
      compileKnowledgePage({
        body: '# Sleep quality\n\nBody.\n',
        vault: vaultRoot,
        prompt: 'Compile from a directory source path.',
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

    const result = await compileKnowledgePage(
      {
        body: ['# Long note', '', longParagraph, ''].join('\n'),
        vault: vaultRoot,
        prompt: 'Summarize the long note.',
        title: 'Long note',
        sourcePaths: [sourcePath],
      },
      {
        async saveText(input) {
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

  it('rejects derived or runtime paths as knowledge compile sources', async () => {
    const vaultRoot = await createVaultRoot()
    await writeVaultFile(
      vaultRoot,
      'derived/knowledge/pages/existing.md',
      '# Existing\n',
    )

    await expect(
      compileKnowledgePage(
        {
          body: '# Existing\n\nBody.\n',
          vault: vaultRoot,
          prompt: 'Compile from a forbidden source path.',
          sourcePaths: ['derived/knowledge/pages/existing.md'],
        },
      ),
    ).rejects.toMatchObject({
      code: 'knowledge_forbidden_source_path',
    })
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
      showKnowledgePage({
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

  it('reports metadata drift and forbidden body source sections during lint', async () => {
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
          code: 'forbidden_source_path',
          slug: 'sleep-quality',
          severity: 'error',
        }),
        expect.objectContaining({
          code: 'source_paths_drift',
          slug: 'sleep-quality',
          severity: 'warning',
        }),
        expect.objectContaining({
          code: 'related_slugs_drift',
          slug: 'sleep-quality',
          severity: 'warning',
        }),
      ]),
    )
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
