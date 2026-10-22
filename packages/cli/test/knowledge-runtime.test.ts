import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  getKnowledgePage,
  lintKnowledgePages,
  upsertKnowledgePage,
} from '@murphai/assistant-engine/knowledge'

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
