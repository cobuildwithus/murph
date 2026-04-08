import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, test } from 'vitest'

import type { AssistantOperatorDefaults } from '@murphai/operator-config/operator-config'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import {
  normalizeReviewGptPrompt,
  normalizeReviewGptPromptTitleSource,
  normalizeReviewGptResponse,
  redactPromptArgs,
  resolveReviewGptWorkspaceRoot,
  runReviewGptPrompt,
} from '../src/review-gpt-runtime.js'

const cleanupPaths: string[] = []
const originalCwd = process.cwd()
const packageDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(packageDir, '..', '..', '..')
const plusPlanDefaults: AssistantOperatorDefaults = {
  identityId: null,
  selfDeliveryTargets: null,
  backend: null,
  failoverRoutes: null,
  account: {
    source: 'codex-auth-json',
    kind: 'account',
    planCode: 'plus',
    planName: 'Plus',
    quota: null,
  },
}

afterEach(async () => {
  process.chdir(originalCwd)

  await Promise.all(
    cleanupPaths.splice(0).map(async (targetPath) => {
      await rm(targetPath, {
        force: true,
        recursive: true,
      })
    }),
  )
})

async function createReviewGptWorkspace(): Promise<{
  root: string
  nestedVault: string
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'murph-review-gpt-workspace-'))
  cleanupPaths.push(root)

  await mkdir(path.join(root, 'scripts'), { recursive: true })
  await mkdir(path.join(root, 'nested', 'vault'), { recursive: true })
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'test-review-gpt-workspace',
        scripts: {
          'review:gpt': 'cobuild-review-gpt --config scripts/review-gpt.config.sh',
        },
      },
      null,
      2,
    ),
    'utf8',
  )
  await writeFile(
    path.join(root, 'scripts', 'review-gpt.config.sh'),
    '#!/usr/bin/env bash\n',
    'utf8',
  )

  return {
    root,
    nestedVault: path.join(root, 'nested', 'vault'),
  }
}

test('review-gpt prompt helpers normalize whitespace and reject empty values', () => {
  assert.equal(
    normalizeReviewGptPrompt(' \r\n Research mitochondrial updates. \r\n'),
    'Research mitochondrial updates.',
  )
  assert.equal(
    normalizeReviewGptPromptTitleSource(' Research\n\nweekly   updates\t now '),
    'Research weekly updates now',
  )
  assert.equal(
    normalizeReviewGptResponse('\n\nFinal answer with trailing spaces.  \n'),
    'Final answer with trailing spaces.',
  )
  assert.throws(
    () => normalizeReviewGptPrompt(' \n\t '),
    (error) =>
      error instanceof VaultCliError && error.code === 'invalid_prompt',
  )
  assert.throws(
    () => normalizeReviewGptResponse('   \n'),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'research_empty_response',
  )
})

test('redactPromptArgs only scrubs prompt payloads and leaves other flags intact', () => {
  assert.deepEqual(
    redactPromptArgs([
      'review:gpt',
      '--prompt',
      'secret text',
      '--model',
      'gpt-5.4-pro',
      '--prompt',
      'second prompt',
    ]),
    [
      'review:gpt',
      '--prompt',
      '<redacted-prompt>',
      '--model',
      'gpt-5.4-pro',
      '--prompt',
      '<redacted-prompt>',
    ],
  )
})

test('resolveReviewGptWorkspaceRoot prefers the vault ancestry before cwd fallbacks', async () => {
  const vaultWorkspace = await createReviewGptWorkspace()
  const cwdWorkspace = await createReviewGptWorkspace()
  process.chdir(cwdWorkspace.root)

  assert.equal(
    resolveReviewGptWorkspaceRoot({
      prompt: 'Research sleep quality trends.',
      vault: vaultWorkspace.nestedVault,
    }),
    vaultWorkspace.root,
  )
})

test('resolveReviewGptWorkspaceRoot falls back to cwd, then the repo workspace root', async () => {
  const cwdWorkspace = await createReviewGptWorkspace()
  process.chdir(cwdWorkspace.root)

  assert.equal(
    await realpath(
      resolveReviewGptWorkspaceRoot({
        prompt: 'Research fasting glucose range.',
        vault: path.join(tmpdir(), 'missing-review-gpt-vault'),
      }),
    ),
    await realpath(cwdWorkspace.root),
  )

  process.chdir(tmpdir())

  assert.equal(
    await realpath(
      resolveReviewGptWorkspaceRoot({
        prompt: 'Research ApoB cutoffs.',
        vault: path.join(tmpdir(), 'missing-review-gpt-vault-2'),
      }),
    ),
    await realpath(repoRoot),
  )
})

test('runReviewGptPrompt returns warnings and normalizes optional blank inputs before invocation', async () => {
  const recorded = {
    invocation: null as null | {
      command: string
      args: string[]
      cwd: string
      env: NodeJS.ProcessEnv | undefined
    },
    removed: [] as string[],
    warningInput: null as null | {
      mode: 'gpt-pro' | 'deep-research'
      defaults: {
        backend: null
        account: {
          planName: string
        }
      }
    },
  }

  const result = await runReviewGptPrompt(
    {
      vault: '/vaults/primary',
      prompt: '  Think through a cleaner migration plan.  ',
      mode: 'gpt-pro',
      chat: '   ',
      browserPath: '\n',
      timeout: '',
      waitTimeout: '25m',
    },
    {
      env: {
        REVIEW_GPT_TEST_ENV: '1',
      },
      resolveAssistantDefaults: async () => plusPlanDefaults,
      resolveWorkspaceRoot: () => '/repo',
      createTempDirectory: async () => '/tmp/murph-review-gpt-success',
      readTextFile: async () => '  Final answer.  ',
      removePath: async (targetPath) => {
        recorded.removed.push(targetPath)
      },
      runProcess: async (input) => {
        recorded.invocation = {
          command: input.command,
          args: [...input.args],
          cwd: input.cwd,
          env: input.env,
        }
        return {
          stdout: '',
          stderr: '',
        }
      },
    },
    {
      buildWarnings: (input) => {
        recorded.warningInput = input as typeof recorded.warningInput
        return ['Use a Pro plan for faster GPT Pro access.']
      },
    },
  )

  assert.deepEqual(recorded.warningInput, {
    mode: 'gpt-pro',
    defaults: plusPlanDefaults,
  })
  assert.deepEqual(recorded.invocation, {
    command: 'pnpm',
    args: [
      'review:gpt',
      '--no-zip',
      '--send',
      '--wait',
      '--response-file',
      '/tmp/murph-review-gpt-success/response.md',
      '--prompt',
      'Think through a cleaner migration plan.',
      '--model',
      'gpt-5.4-pro',
      '--thinking',
      'extended',
      '--timeout',
      '40m',
      '--wait-timeout',
      '25m',
    ],
    cwd: '/repo',
    env: {
      REVIEW_GPT_TEST_ENV: '1',
    },
  })
  assert.deepEqual(recorded.removed, ['/tmp/murph-review-gpt-success'])
  assert.deepEqual(result, {
    chat: null,
    mode: 'gpt-pro',
    model: 'gpt-5.4-pro',
    prompt: 'Think through a cleaner migration plan.',
    response: 'Final answer.',
    responseLength: 'Final answer.'.length,
    thinking: 'extended',
    warnings: ['Use a Pro plan for faster GPT Pro access.'],
  })
})

test('runReviewGptPrompt removes the temp directory when response parsing fails', async () => {
  const removedPaths: string[] = []

  await assert.rejects(
    () =>
      runReviewGptPrompt(
        {
          vault: '/vaults/primary',
          prompt: 'Research hydration timing.',
          mode: 'deep-research',
        },
        {
          resolveAssistantDefaults: async () => null,
          resolveWorkspaceRoot: () => '/repo',
          createTempDirectory: async () => '/tmp/murph-review-gpt-failure',
          readTextFile: async () => '   ',
          removePath: async (targetPath) => {
            removedPaths.push(targetPath)
          },
          runProcess: async () => ({
            stdout: '',
            stderr: '',
          }),
        },
      ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'research_empty_response',
  )

  assert.deepEqual(removedPaths, ['/tmp/murph-review-gpt-failure'])
})
