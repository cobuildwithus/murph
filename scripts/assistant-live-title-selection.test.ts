import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, it } from 'vitest'

import {
  executeAssistantRealCodexRun,
  parseAssistantRealCodexRunArgs,
  type AssistantRealCodexCommandRequest,
} from './run-assistant-real-codex-e2e.ts'

it('selects complete live titles while preserving ordinary display and ambiguous-name admission', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'murph-live-title-'))
  const configPath = path.join(root, 'vitest.config.mts')
  const fixturePath = path.join(root, 'journey.test.mjs')
  const receiptPath = path.join(root, 'receipt.txt')
  const packageConfig = fileURLToPath(new URL('../packages/assistant-engine/vitest.config.ts', import.meta.url))
  const vitestEntry = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url))
  const vitestModule = fileURLToPath(import.meta.resolve('vitest'))
  const prefix = 'selects one synthetic record after a sufficiently long shared title prefix'
  const selected = `${prefix} alpha`
  try {
    await writeFile(configPath, [
      `import config from ${JSON.stringify(packageConfig)}`,
      `export default { ...config, root: ${JSON.stringify(root)}, test: { ...config.test, globalSetup: [], include: ['journey.test.mjs'] } }`,
    ].join('\n'))
    await writeFile(fixturePath, [
      `import { it } from ${JSON.stringify(vitestModule)}`,
      "import { appendFileSync } from 'node:fs'",
      `it.each([{ testName: ${JSON.stringify(selected)} }, { testName: ${JSON.stringify(`${prefix} beta`)} }])`,
      `('$testName', { tags: ['real-codex-live'] }, ({ testName }) => appendFileSync(${JSON.stringify(receiptPath)}, testName + '\\n'))`,
    ].join('\n'))
    const requests: AssistantRealCodexCommandRequest[] = []
    const runCommand = (request: AssistantRealCodexCommandRequest) => {
      requests.push(request)
      if (request.args[0] === 'login') return { status: 0 }
      const args = request.args.slice(request.args.indexOf('vitest') + 1)
        .map((argument) => argument === 'vitest.config.ts' ? configPath
          : argument === 'test/assistant-codex-real-e2e.test.ts' ? fixturePath : argument)
      const result = spawnSync(process.execPath, [vitestEntry, ...args], {
        cwd: root, env: request.env, encoding: 'utf8', timeout: 30_000,
      })
      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(0)
      return { status: result.status, stdout: result.stdout }
    }
    const sourceEnv = { ...process.env }
    delete sourceEnv.MURPH_RUN_REAL_CODEX_E2E
    // Ordinary package invocations retain Vitest's existing title/display limit.
    const ordinary = runCommand({
      args: ['vitest', 'list', '--config', configPath, '--testNamePattern', selected, '--json'],
      command: 'pnpm', env: sourceEnv, stdio: 'capture',
    })
    expect(JSON.parse(ordinary.stdout ?? '')).toEqual([])
    requests.length = 0
    const errors: string[] = []
    const dependencies = {
      runCommand, sourceEnv, writeStderr: (value: string) => errors.push(value),
      writeStdout: () => undefined,
    }
    expect(executeAssistantRealCodexRun(parseAssistantRealCodexRunArgs([selected]), dependencies)).toBe(0)
    expect(requests.map((request) => request.stdio)).toEqual(['capture', 'ignore', 'inherit'])
    expect(await readFile(receiptPath, 'utf8')).toBe(`${selected}\n`)
    requests.length = 0
    expect(executeAssistantRealCodexRun(parseAssistantRealCodexRunArgs(['selects one synthetic']), dependencies)).toBe(2)
    expect(errors.join('')).toContain('matched 2 live journeys')
    expect(errors.join('')).toContain(selected)
    expect(errors.join('')).toContain(`${prefix} beta`)
    expect(requests.map((request) => request.stdio)).toEqual(['capture'])
    expect(await readFile(receiptPath, 'utf8')).toBe(`${selected}\n`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)
