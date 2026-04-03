import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  compileKnowledgePage,
  lintKnowledgePages,
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
        vault: vaultRoot,
        prompt: 'Summarize the current sleep-quality notes.',
        title: 'Sleep quality',
        sourcePaths: [sourcePath],
      },
      {
        async runProcess(input) {
          const responseFile = readArgValue(input.args, '--response-file')
          expect(input.command).toBe('pnpm')
          expect(responseFile).toBeTruthy()
          await writeFile(
            responseFile!,
            [
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
            'utf8',
          )

          return {
            stdout: '',
            stderr: '',
          }
        },
        async saveText(input) {
          await writeVaultFile(vaultRoot, input.relativePath, input.content)
        },
        async resolveAssistantDefaults() {
          return null
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
    expect(savedPage).toContain('compiler: review:gpt')
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

    const shown = await showKnowledgePage({
      vault: vaultRoot,
      slug: 'sleep-quality',
    })
    expect(shown.page.markdown).toContain('# Sleep quality')
    expect(shown.page.relatedSlugs).toEqual(['magnesium'])
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
        'sourcePaths:',
        '  - research/2026/04/missing-note.md',
        'relatedSlugs:',
        '  - magnesium',
        '---',
        '',
        '# Sleep quality',
        '',
        'Needs follow-up.',
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

function readArgValue(args: readonly string[], flag: string): string | null {
  const index = args.indexOf(flag)
  if (index === -1 || index + 1 >= args.length) {
    return null
  }

  return args[index + 1] ?? null
}
