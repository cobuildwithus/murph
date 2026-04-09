import { readFile, rm } from 'node:fs/promises'

import { afterEach, describe, expect, it } from 'vitest'

import {
  appendAssistantCliOutputChunk,
  prepareAssistantCliExecutionRequest,
  redactAssistantCliProcessOutput,
} from '../src/assistant-cli-tools/policy-wrappers.ts'
import { assistantCliMaxOutputChars } from '../src/assistant-cli-tools/shared.ts'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((target) =>
      rm(target, {
        recursive: true,
        force: true,
      }),
    ),
  )
})

describe('assistant CLI policy wrappers', () => {
  it('blocks explicit vault overrides and blocked command paths before launch', async () => {
    await expect(
      prepareAssistantCliExecutionRequest({
        args: ['status', '--vault', '/tmp/override'],
        vault: '/tmp/active-vault',
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CLI_COMMAND_BLOCKED',
      message:
        'The provider-turn CLI executor does not allow an explicit `--vault` override.',
    })

    await expect(
      prepareAssistantCliExecutionRequest({
        args: ['--format', 'json', 'assistant', 'run'],
        vault: '/tmp/active-vault',
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CLI_COMMAND_BLOCKED',
      context: {
        commandPath: 'assistant run',
      },
    })

    await expect(
      prepareAssistantCliExecutionRequest({
        args: ['run'],
        vault: '/tmp/active-vault',
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CLI_COMMAND_BLOCKED',
      context: {
        commandPath: 'run',
      },
    })
  })

  it('injects default format json, preserves builtin text surfaces, and redacts paths', async () => {
    const defaulted = await prepareAssistantCliExecutionRequest({
      args: ['status'],
      vault: '/tmp/active-vault',
    })

    expect(defaulted.args).toEqual([
      'status',
      '--format',
      'json',
      '--vault',
      '/tmp/active-vault',
    ])
    expect(defaulted.redactedArgv).toEqual([
      'status',
      '--format',
      'json',
      '--vault',
      '<REDACTED_PATH>',
    ])
    expect(defaulted.stdinText).toBe('')
    expect(defaulted.cleanupPath).toBeNull()

    const builtinSurface = await prepareAssistantCliExecutionRequest({
      args: ['--llms-full'],
      vault: '/tmp/active-vault',
    })
    expect(builtinSurface.args).toEqual(['--llms-full'])

    const explicitFormat = await prepareAssistantCliExecutionRequest({
      args: ['status', '--format', 'text'],
      vault: '/tmp/active-vault',
    })
    expect(explicitFormat.args).toEqual([
      'status',
      '--format',
      'text',
      '--vault',
      '/tmp/active-vault',
    ])

    expect(
      redactAssistantCliProcessOutput(
        'vault: /Users/example/vault\npayload=@/Users/example/request.json\nother=/Users/example/output.json\n',
      ),
    ).toBe(
      'vault: <HOME_DIR>/vault\npayload=@<HOME_DIR>/request.json\nother=<HOME_DIR>/output.json',
    )
  })

  it('materializes stdin payloads for --input=- and leaves ordinary stdin untouched', async () => {
    const staged = await prepareAssistantCliExecutionRequest({
      args: ['samples', 'add', '--input=-'],
      stdin: '{"samples":[]}\n',
      vault: '/tmp/active-vault',
    })

    const stagedArg = staged.args.find((token) => token.startsWith('--input=@'))
    expect(stagedArg).toBeTruthy()
    expect(staged.stdinText).toBe('')
    expect(staged.cleanupPath).not.toBeNull()
    expect(staged.redactedArgv.find((token) => token.startsWith('--input=@'))).toBe(
      '--input=@<REDACTED_PATH>',
    )

    if (staged.cleanupPath) {
      cleanupPaths.push(staged.cleanupPath)
    }

    const stagedPath = stagedArg?.replace('--input=@', '')
    expect(stagedPath).toBeTruthy()
    expect(await readFile(stagedPath!, 'utf8')).toBe('{"samples":[]}\n')

    const passthrough = await prepareAssistantCliExecutionRequest({
      args: ['samples', 'add'],
      stdin: '{"samples":[]}\n',
      vault: '/tmp/active-vault',
    })
    expect(passthrough.stdinText).toBe('{"samples":[]}\n')
    expect(passthrough.cleanupPath).toBeNull()
  })

  it('caps appended CLI output at the configured max length', () => {
    expect(
      appendAssistantCliOutputChunk(
        'abc',
        'def',
      ),
    ).toBe('abcdef')

    const existing = 'x'.repeat(assistantCliMaxOutputChars - 2)
    expect(appendAssistantCliOutputChunk(existing, 'abcd')).toBe(
      `${existing}ab`,
    )
    expect(
      appendAssistantCliOutputChunk(
        'x'.repeat(assistantCliMaxOutputChars),
        'ignored',
      ),
    ).toBe('x'.repeat(assistantCliMaxOutputChars))
  })
})
