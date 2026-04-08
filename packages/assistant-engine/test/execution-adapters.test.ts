import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { withAssistantPayloadFile } from '../src/assistant-cli-tools/execution-adapters.ts'

const createdVaultRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    createdVaultRoots.splice(0).map((vaultRoot) => rm(vaultRoot, { force: true, recursive: true })),
  )
})

describe('withAssistantPayloadFile', () => {
  it('stages assistant payloads under vault .runtime tmp and removes them after success', async () => {
    const vaultRoot = await createVaultRoot()
    const payload = {
      stream: 'body_weight',
      samples: [],
    }
    let inputFile = ''

    const result = await withAssistantPayloadFile(
      vaultRoot,
      'vault.samples.add',
      payload,
      async (stagedInputFile) => {
        inputFile = stagedInputFile
        expectAssistantPayloadRuntimePath(vaultRoot, stagedInputFile, 'vault-samples-add')
        expect(await readFile(stagedInputFile, 'utf8')).toBe(`${JSON.stringify(payload, null, 2)}\n`)
        const stagedFileStat = await stat(stagedInputFile)
        const stagedDirectoryStat = await stat(path.dirname(stagedInputFile))

        expect(stagedFileStat.mode & 0o777).toBe(0o600)
        expect(stagedDirectoryStat.mode & 0o777).toBe(0o700)
        return 'ok'
      },
    )

    expect(result).toBe('ok')
    expect(inputFile).not.toBe('')
    await expectPathMissing(inputFile)
    await expectPathMissing(path.dirname(inputFile))
    await expectPathMissing(path.join(vaultRoot, 'derived', 'assistant', 'payloads'))
  })

  it('removes staged payloads after the caller throws', async () => {
    const vaultRoot = await createVaultRoot()
    const payload = {
      providerId: 'prov_example',
      title: 'Example Provider',
    }
    const sentinel = new Error('boom')
    let inputFile = ''

    await expect(
      withAssistantPayloadFile(
        vaultRoot,
        'vault.provider.upsert',
        payload,
        async (stagedInputFile) => {
          inputFile = stagedInputFile
          expectAssistantPayloadRuntimePath(vaultRoot, stagedInputFile, 'vault-provider-upsert')
          throw sentinel
        },
      ),
    ).rejects.toBe(sentinel)

    expect(inputFile).not.toBe('')
    await expectPathMissing(inputFile)
    await expectPathMissing(path.dirname(inputFile))
  })
})

async function createVaultRoot(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-assistant-payload-vault-'))
  createdVaultRoots.push(vaultRoot)
  return vaultRoot
}

async function expectPathMissing(targetPath: string): Promise<void> {
  await expect(access(targetPath)).rejects.toMatchObject({ code: 'ENOENT' })
}

function expectAssistantPayloadRuntimePath(
  vaultRoot: string,
  inputFile: string,
  expectedPrefix: string,
): void {
  const relativePath = path.relative(vaultRoot, inputFile)
  const segments = relativePath.split(path.sep)

  expect(segments.slice(0, 4)).toEqual(['.runtime', 'tmp', 'assistant', 'payloads'])
  expect(segments[4]).toMatch(new RegExp(`^${expectedPrefix}-`))
  expect(segments[5]).toBe('payload.json')
}
