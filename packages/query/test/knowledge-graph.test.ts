import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  DERIVED_KNOWLEDGE_INDEX_PATH,
  DERIVED_KNOWLEDGE_PAGES_ROOT,
  extractKnowledgeRelatedSlugs,
  normalizeKnowledgeSlug,
  normalizeKnowledgeTag,
  readDerivedKnowledgeGraph,
  readDerivedKnowledgeGraphWithIssues,
  renderDerivedKnowledgeIndex,
  searchDerivedKnowledgeGraph,
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
  it('loads derived knowledge pages from canonical body metadata', async () => {
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
        'relatedSlugs:',
        '  - magnesium',
        'sourcePaths:',
        '  - research/2026/04/sleep-note.md',
        '---',
        '',
        '# Sleep quality',
        '',
        'Murph noticed a recurring link to [[magnesium]].',
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

  it('searches derived knowledge pages by title, summary, body, and filters', async () => {
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
        'summary: Magnesium seemed to help sleep continuity.',
        'relatedSlugs:',
        '  - magnesium',
        'sourcePaths:',
        '  - research/2026/04/sleep-note.md',
        '---',
        '',
        '# Sleep quality',
        '',
        'Murph noticed fewer wakeups when [[magnesium]] showed up in recent notes.',
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
        'summary: Supplement notes and forms.',
        '---',
        '',
        '# Magnesium',
        '',
        'Reference page for the supplement itself.',
        '',
      ].join('\n'),
    )

    const graph = await readDerivedKnowledgeGraph(vaultRoot)
    const search = searchDerivedKnowledgeGraph(graph, 'sleep magnesium')

    expect(search.format).toBe('murph.knowledge-search.v1')
    expect(search.total).toBeGreaterThanOrEqual(1)
    expect(search.hits[0]).toMatchObject({
      slug: 'sleep-quality',
      matchedTerms: ['magnesium', 'sleep'],
      pageType: 'concept',
      status: 'active',
    })

    const filtered = searchDerivedKnowledgeGraph(graph, 'magnesium', {
      status: 'archived',
      pageType: 'supplement',
    })
    expect(filtered.hits).toHaveLength(1)
    expect(filtered.hits[0]?.slug).toBe('magnesium')
  })

  it('exports query-owned knowledge helpers for normalization and index rendering', async () => {
    const vaultRoot = await createVaultRoot()
    await writeKnowledgePage(
      vaultRoot,
      'sleep-quality',
      [
        '---',
        'title: Sleep quality',
        'slug: sleep-quality',
        'pageType: sleep-pattern',
        'status: active',
        'summary: What seems to improve or disrupt sleep quality.',
        'relatedSlugs:',
        '  - magnesium',
        'sourcePaths:',
        '  - research/2026/04/sleep-note.md',
        '---',
        '',
        '# Sleep quality',
        '',
        'Murph noticed a recurring link to [[magnesium]].',
        '',
      ].join('\n'),
    )

    const graph = await readDerivedKnowledgeGraph(vaultRoot)

    expect(normalizeKnowledgeSlug('  Sleep quality  ')).toBe('sleep-quality')
    expect(normalizeKnowledgeTag(' Sleep Pattern ')).toBe('sleep-pattern')
    expect(
      extractKnowledgeRelatedSlugs(
        '# Sleep quality\n\nSee [[magnesium]] and [[magnesium]].',
        'sleep-quality',
      ),
    ).toEqual(['magnesium'])

    const index = renderDerivedKnowledgeIndex(graph, '2026-04-03T00:00:00.000Z')
    expect(index).toContain('# Derived knowledge index')
    expect(index).toContain('## Sleep Pattern')
    expect(index).toContain('[Sleep quality](pages/sleep-quality.md)')
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

  it('keeps canonical frontmatter metadata when generated sections drift', async () => {
    const vaultRoot = await createVaultRoot()
    await writeKnowledgePage(
      vaultRoot,
      'sleep-quality',
      [
        '---',
        'title: Sleep quality',
        'slug: sleep-quality',
        'relatedSlugs:',
        '  - magnesium',
        'sourcePaths:',
        '  - research/2026/04/current-note.md',
        '---',
        '',
        '# Sleep quality',
        '',
        'Older draft text still points to [[stale-link]].',
        '',
        '## Sources',
        '',
        '- `research/2026/04/stale-note.md`',
        '',
      ].join('\n'),
    )

    const graph = await readDerivedKnowledgeGraph(vaultRoot)

    expect(graph.bySlug.get('sleep-quality')).toMatchObject({
      relatedSlugs: ['magnesium'],
      sourcePaths: ['research/2026/04/current-note.md'],
    })
  })

  it('ignores legacy frontmatter metadata aliases now that the page schema is canonical', async () => {
    const vaultRoot = await createVaultRoot()
    await writeKnowledgePage(
      vaultRoot,
      'sleep-quality',
      [
        '---',
        'title: Sleep quality',
        'slug: sleep-quality',
        'sources:',
        '  - research/2026/04/legacy-note.md',
        'related:',
        '  - magnesium',
        '---',
        '',
        '# Sleep quality',
        '',
        'This page predates the body-owned metadata sections.',
        '',
      ].join('\n'),
    )

    const graph = await readDerivedKnowledgeGraph(vaultRoot)

    expect(graph.bySlug.get('sleep-quality')).toMatchObject({
      relatedSlugs: [],
      sourcePaths: [],
      title: 'Sleep quality',
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
