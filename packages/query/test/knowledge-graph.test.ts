import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  DERIVED_KNOWLEDGE_INDEX_PATH,
  DERIVED_KNOWLEDGE_PAGES_ROOT,
  readDerivedKnowledgeGraph,
  readDerivedKnowledgeGraphWithIssues,
} from '../src/index.ts'

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

describe('readDerivedKnowledgeGraph', () => {
  it('loads derived knowledge pages with frontmatter metadata and body links', async () => {
    const vaultRoot = await createVaultRoot()
    await writeKnowledgePage(
      vaultRoot,
      'sleep-quality',
      [
        '---',
        'title: Sleep quality',
        'slug: sleep-quality',
        'pageType: concept',
        'status: active',
        'summary: What seems to improve or disrupt sleep quality.',
        '---',
        '',
        '# Sleep quality',
        '',
        'Murph noticed a recurring link to [[magnesium]].',
        '',
        '## Related',
        '',
        '- [[magnesium]]',
        '',
        '## Sources',
        '',
        '- `research/2026/04/sleep-note.md`',
        '',
      ].join('\n'),
    )

    const graph = await readDerivedKnowledgeGraph(vaultRoot)

    expect(graph.indexPath).toBe(DERIVED_KNOWLEDGE_INDEX_PATH)
    expect(graph.pagesRoot).toBe(DERIVED_KNOWLEDGE_PAGES_ROOT)
    expect(graph.nodes).toHaveLength(1)
    expect(graph.bySlug.get('sleep-quality')).toMatchObject({
      pageType: 'concept',
      relatedSlugs: ['magnesium'],
      slug: 'sleep-quality',
      sourcePaths: ['research/2026/04/sleep-note.md'],
      status: 'active',
      summary: 'What seems to improve or disrupt sleep quality.',
      title: 'Sleep quality',
    })
  })

  it('reports frontmatter parse failures separately from the loaded graph', async () => {
    const vaultRoot = await createVaultRoot()
    await writeKnowledgePage(
      vaultRoot,
      'valid-page',
      [
        '---',
        'title: Valid page',
        'slug: valid-page',
        '---',
        '',
        '# Valid page',
        '',
        'This page still loads.',
        '',
      ].join('\n'),
    )
    await writeKnowledgePage(
      vaultRoot,
      'broken-page',
      [
        '---',
        'title: Broken page',
        'slug: [',
        '---',
        '',
        '# Broken page',
        '',
      ].join('\n'),
    )

    const result = await readDerivedKnowledgeGraphWithIssues(vaultRoot)

    expect(result.graph.nodes.map((node) => node.slug)).toEqual(['valid-page'])
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toMatchObject({
      parser: 'frontmatter',
      relativePath: `${DERIVED_KNOWLEDGE_PAGES_ROOT}/broken-page.md`,
    })
  })

  it('prefers body-derived related slugs and source paths when frontmatter drifts', async () => {
    const vaultRoot = await createVaultRoot()
    await writeKnowledgePage(
      vaultRoot,
      'sleep-quality',
      [
        '---',
        'title: Sleep quality',
        'slug: sleep-quality',
        'sourcePaths:',
        '  - research/2026/04/stale-note.md',
        'relatedSlugs:',
        '  - stale-link',
        '---',
        '',
        '# Sleep quality',
        '',
        'Current notes now point to [[magnesium]].',
        '',
        '## Sources',
        '',
        '- `research/2026/04/current-note.md`',
        '',
      ].join('\n'),
    )

    const graph = await readDerivedKnowledgeGraph(vaultRoot)

    expect(graph.bySlug.get('sleep-quality')).toMatchObject({
      relatedSlugs: ['magnesium'],
      sourcePaths: ['research/2026/04/current-note.md'],
    })
  })
})

async function createVaultRoot(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-knowledge-graph-'))
  createdVaultRoots.push(vaultRoot)
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
  await writeFile(
    path.join(vaultRoot, DERIVED_KNOWLEDGE_PAGES_ROOT, `${slug}.md`),
    markdown,
    'utf8',
  )
}
