import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import { materializeUsageInputBaseline } from './support/usage-input-baseline.ts'

describe('provider-input baseline source snapshot', () => {
  it('loads base transitive prompt and tool modules even after head changes or deletes them', async () => {
    const repository = await mkdtemp(path.join(tmpdir(), 'usage-input-baseline-'))
    const packageRoot = path.join(repository, 'packages/assistant-engine')
    const source = path.join(packageRoot, 'src')
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim()
    const roots: string[] = []
    try {
      await mkdir(path.join(source, 'assistant'), { recursive: true })
      await mkdir(path.join(source, 'assistant-codex/dynamic-tools'), { recursive: true })
      await writeFile(path.join(packageRoot, 'package.json'), '{"type":"module"}')
      await writeFile(path.join(source, 'assistant/system-prompt.js'), "export { prompt } from './group-shared-freshness.js'\n")
      await writeFile(path.join(source, 'assistant/group-shared-freshness.js'), "export const prompt = 'base prompt'\n")
      await writeFile(path.join(source, 'assistant-codex/dynamic-tool-catalog.js'), "export { tool } from './dynamic-tools/group.js'\n")
      await writeFile(path.join(source, 'assistant-codex/dynamic-tools/group.js'), "export { tool } from '../../base-only.js'\n")
      await writeFile(path.join(source, 'base-only.js'), "export const tool = 'base tool'\n")
      git('init', '--quiet')
      git('add', '.')
      const baseTree = git('write-tree')
      await writeFile(path.join(source, 'assistant/group-shared-freshness.js'), "export const prompt = 'head prompt'\n")
      await writeFile(path.join(source, 'assistant-codex/dynamic-tools/group.js'), "export const tool = 'head tool'\n")
      await rm(path.join(source, 'base-only.js'))
      git('add', '.')
      const headTree = git('write-tree')
      for (const tree of [baseTree, headTree]) roots.push(await materializeUsageInputBaseline(repository, tree))
      const [baseRoot, headRoot] = roots
      const load = (root: string, file: string) => import(pathToFileURL(path.join(root, 'src', file)).href)
      expect(await load(baseRoot!, 'assistant/system-prompt.js')).toMatchObject({ prompt: 'base prompt' })
      expect(await load(baseRoot!, 'assistant-codex/dynamic-tool-catalog.js')).toMatchObject({ tool: 'base tool' })
      expect(await load(headRoot!, 'assistant/system-prompt.js')).toMatchObject({ prompt: 'head prompt' })
      expect(await load(headRoot!, 'assistant-codex/dynamic-tool-catalog.js')).toMatchObject({ tool: 'head tool' })
      expect(await readFile(path.join(source, 'assistant/group-shared-freshness.js'), 'utf8')).toContain('head prompt')
      const before = await readdir(packageRoot)
      await expect(materializeUsageInputBaseline(repository, 'missing-revision')).rejects.toThrow()
      expect(await readdir(packageRoot)).toEqual(before)
    } finally {
      await rm(repository, { recursive: true, force: true })
    }
  })
})
