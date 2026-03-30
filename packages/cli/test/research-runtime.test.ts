import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'vitest'
import {
  buildResearchMarkdown,
  buildResearchRelativePath,
  buildReviewGptCommand,
  deriveResearchTitle,
  resolveReviewGptWorkspaceRoot,
  runDeepthinkPrompt,
  runResearchPrompt,
} from '../src/research-runtime.js'

test('buildReviewGptCommand selects Deep Research mode with explicit send + wait prompt-only flow', () => {
  const command = buildReviewGptCommand({
    prompt: 'Research longevity biotech updates.',
    responseFile: '/tmp/research-response.md',
    mode: 'deep-research',
    chat: 'https://chatgpt.com/c/69abc',
    browserPath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    timeout: '40m',
    waitTimeout: '30m',
  })

  assert.equal(command.command, 'pnpm')
  assert.deepEqual(command.args, [
    'review:gpt',
    '--no-zip',
    '--send',
    '--wait',
    '--response-file',
    '/tmp/research-response.md',
    '--prompt',
    'Research longevity biotech updates.',
    '--deep-research',
    '--chat',
    'https://chatgpt.com/c/69abc',
    '--browser-path',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '--timeout',
    '40m',
    '--wait-timeout',
    '30m',
  ])
})

test('buildReviewGptCommand defaults the overall timeout to 40m and leaves wait-timeout unset', () => {
  const command = buildReviewGptCommand({
    prompt: 'Research ApoB trends.',
    responseFile: '/tmp/research-response.md',
    mode: 'deep-research',
  })

  assert.deepEqual(command.args, [
    'review:gpt',
    '--no-zip',
    '--send',
    '--wait',
    '--response-file',
    '/tmp/research-response.md',
    '--prompt',
    'Research ApoB trends.',
    '--deep-research',
    '--timeout',
    '40m',
  ])
})

test('runResearchPrompt waits for review:gpt, saves a markdown note path, and returns the captured response', async () => {
  const fixedNow = new Date('2026-03-24T23:02:59.123Z')
  const recorded = {
    command: null as null | {
      command: string
      args: string[]
      cwd: string
    },
    saved: null as null | {
      vault: string
      relativePath: string
      content: string
      summary: string
    },
    removedPath: null as null | string,
  }

  const result = await runResearchPrompt(
    {
      vault: '/vaults/primary',
      prompt: '  Research weekly cholesterol updates and emphasize practical interventions.  ',
      title: 'Cholesterol weekly research roundup',
      chat: '69abc',
    },
    {
      now: () => fixedNow,
      resolveAssistantDefaults: async () => null,
      resolveWorkspaceRoot: () => '/repo',
      createTempDirectory: async () => '/tmp/murph-research-case',
      readTextFile: async (filePath) => {
        assert.equal(filePath, path.join('/tmp/murph-research-case', 'response.md'))
        return '## Findings\n\n- New evidence here.'
      },
      runProcess: async (input) => {
        recorded.command = {
          command: input.command,
          args: [...input.args],
          cwd: input.cwd,
        }
        return {
          stdout: 'ok',
          stderr: '',
        }
      },
      saveNote: async (input) => {
        recorded.saved = input
      },
      removePath: async (filePath) => {
        recorded.removedPath = filePath
      },
    },
  )

  assert.deepEqual(recorded.command, {
    command: 'pnpm',
    args: [
      'review:gpt',
      '--no-zip',
      '--send',
      '--wait',
      '--response-file',
      '/tmp/murph-research-case/response.md',
      '--prompt',
      'Research weekly cholesterol updates and emphasize practical interventions.',
      '--deep-research',
      '--chat',
      '69abc',
      '--timeout',
      '40m',
    ],
    cwd: '/repo',
  })
  assert.deepEqual(recorded.saved, {
    vault: '/vaults/primary',
    relativePath:
      'research/2026/03/2026-03-24-230259123-cholesterol-weekly-research-roundup.md',
    content: buildResearchMarkdown({
      title: 'Cholesterol weekly research roundup',
      prompt: 'Research weekly cholesterol updates and emphasize practical interventions.',
      response: '## Findings\n\n- New evidence here.',
      savedAt: '2026-03-24T23:02:59.123Z',
      mode: 'deep-research',
      chat: '69abc',
      model: null,
      thinking: null,
    }),
    summary: 'Saved Deep Research note "Cholesterol weekly research roundup".',
  })
  assert.equal(recorded.removedPath, '/tmp/murph-research-case')
  assert.deepEqual(result, {
    vault: '/vaults/primary',
    mode: 'deep-research',
    title: 'Cholesterol weekly research roundup',
    prompt: 'Research weekly cholesterol updates and emphasize practical interventions.',
    notePath:
      'research/2026/03/2026-03-24-230259123-cholesterol-weekly-research-roundup.md',
    savedAt: '2026-03-24T23:02:59.123Z',
    response: '## Findings\n\n- New evidence here.',
    responseLength: '## Findings\n\n- New evidence here.'.length,
    chat: '69abc',
    model: null,
    thinking: null,
    warnings: [],
  })
})

test('runDeepthinkPrompt targets GPT Pro defaults, derives a title from the prompt, and warns on non-Pro plans', async () => {
  const fixedNow = new Date('2026-03-24T01:02:03.004Z')
  let recordedArgs: string[] | null = null
  let recordedSave: { relativePath: string; summary: string } | null = null

  const result = await runDeepthinkPrompt(
    {
      vault: '/vaults/primary',
      prompt: 'Think through whether adding more zone-2 cardio is worth the tradeoff for recovery this month.',
    },
    {
      now: () => fixedNow,
      resolveAssistantDefaults: async () => ({
        provider: 'codex-cli',
        codexCommand: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: null,
        identityId: null,
        sandbox: 'workspace-write',
        approvalPolicy: 'on-request',
        profile: null,
        oss: false,
        selfDeliveryTargets: null,
        baseUrl: null,
        apiKeyEnv: null,
        providerName: null,
        headers: null,
        account: {
          source: 'codex-auth-json',
          kind: 'account',
          planCode: 'plus',
          planName: 'Plus',
          quota: null,
        },
      }),
      resolveWorkspaceRoot: () => '/repo',
      createTempDirectory: async () => '/tmp/murph-deepthink-case',
      readTextFile: async () => 'Answer text',
      runProcess: async (input) => {
        recordedArgs = [...input.args]
        return {
          stdout: '',
          stderr: '',
        }
      },
      saveNote: async (input) => {
        recordedSave = {
          relativePath: input.relativePath,
          summary: input.summary,
        }
      },
      removePath: async () => {},
    },
  )

  assert.deepEqual(recordedArgs, [
    'review:gpt',
    '--no-zip',
    '--send',
    '--wait',
    '--response-file',
    '/tmp/murph-deepthink-case/response.md',
    '--prompt',
    'Think through whether adding more zone-2 cardio is worth the tradeoff for recovery this month.',
    '--model',
    'gpt-5.4-pro',
    '--thinking',
    'extended',
    '--timeout',
    '40m',
  ])
  assert.deepEqual(recordedSave, {
    relativePath:
      'research/2026/03/2026-03-24-010203004-think-through-whether-adding-more-zone-2-cardio-is-worth-the-tradeoff-for-rec.md',
    summary:
      'Saved GPT Pro note "Think through whether adding more zone-2 cardio is worth the tradeoff for rec...".',
  })
  assert.equal(result.mode, 'gpt-pro')
  assert.equal(result.model, 'gpt-5.4-pro')
  assert.equal(result.thinking, 'extended')
  assert.equal(
    result.title,
    'Think through whether adding more zone-2 cardio is worth the tradeoff for rec...',
  )
  assert.deepEqual(result.warnings, [
    'Deepthink targets GPT Pro and may fail because the saved assistant account is Plus, not Pro.',
  ])
})

test('runDeepthinkPrompt skips warnings when the saved assistant account is Pro', async () => {
  const result = await runDeepthinkPrompt(
    {
      vault: '/vaults/primary',
      prompt: 'Think through a recovery tradeoff.',
    },
    {
      now: () => new Date('2026-03-24T01:02:03.004Z'),
      resolveAssistantDefaults: async () => ({
        provider: 'codex-cli',
        codexCommand: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: null,
        identityId: null,
        sandbox: 'workspace-write',
        approvalPolicy: 'on-request',
        profile: null,
        oss: false,
        selfDeliveryTargets: null,
        baseUrl: null,
        apiKeyEnv: null,
        providerName: null,
        headers: null,
        account: {
          source: 'codex-auth-json',
          kind: 'account',
          planCode: 'pro',
          planName: 'Pro',
          quota: null,
        },
      }),
      resolveWorkspaceRoot: () => '/repo',
      createTempDirectory: async () => '/tmp/murph-deepthink-pro-case',
      readTextFile: async () => 'Answer text',
      runProcess: async () => ({
        stdout: '',
        stderr: '',
      }),
      saveNote: async () => {},
      removePath: async () => {},
    },
  )

  assert.deepEqual(result.warnings, [])
})

test('runResearchPrompt warns on saved Free-tier accounts', async () => {
  const result = await runResearchPrompt(
    {
      vault: '/vaults/primary',
      prompt: 'Research current LDL guidance.',
    },
    {
      now: () => new Date('2026-03-24T05:06:07.008Z'),
      resolveAssistantDefaults: async () => ({
        provider: 'codex-cli',
        codexCommand: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: null,
        identityId: null,
        sandbox: 'workspace-write',
        approvalPolicy: 'on-request',
        profile: null,
        oss: false,
        selfDeliveryTargets: null,
        baseUrl: null,
        apiKeyEnv: null,
        providerName: null,
        headers: null,
        account: {
          source: 'codex-auth-json',
          kind: 'account',
          planCode: 'free',
          planName: 'Free',
          quota: null,
        },
      }),
      resolveWorkspaceRoot: () => '/repo',
      createTempDirectory: async () => '/tmp/murph-research-free-case',
      readTextFile: async () => 'Research response',
      runProcess: async () => ({
        stdout: '',
        stderr: '',
      }),
      saveNote: async () => {},
      removePath: async () => {},
    },
  )

  assert.deepEqual(result.warnings, [
    'Research uses Deep Research and may be unavailable or more limited on the saved Free account.',
  ])
})

test('runResearchPrompt preserves multiline prompts when sending and saving research requests', async () => {
  const prompts: string[] = []
  let savedContent = ''

  await runResearchPrompt(
    {
      vault: '/vaults/primary',
      prompt: 'Line one about ApoB.\n\nLine two with follow-up instructions.',
      title: 'Multiline research test',
    },
    {
      now: () => new Date('2026-03-24T05:06:07.008Z'),
      resolveAssistantDefaults: async () => null,
      resolveWorkspaceRoot: () => '/repo',
      createTempDirectory: async () => '/tmp/murph-multiline-case',
      readTextFile: async () => 'Response body',
      runProcess: async (input) => {
        const promptIndex = input.args.indexOf('--prompt')
        prompts.push(String(input.args[promptIndex + 1] ?? ''))
        return {
          stdout: '',
          stderr: '',
        }
      },
      saveNote: async (input) => {
        savedContent = input.content
      },
      removePath: async () => {},
    },
  )

  assert.deepEqual(prompts, ['Line one about ApoB.\n\nLine two with follow-up instructions.'])
  assert.match(savedContent, /Line one about ApoB\.\n\nLine two with follow-up instructions\./u)
})

test('workspace root resolution finds the nearest package.json with review:gpt wired', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'murph-research-root-'))

  try {
    await mkdir(path.join(root, 'scripts'), { recursive: true })
    await mkdir(path.join(root, 'nested', 'deeper'), { recursive: true })
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        scripts: {
          'review:gpt': 'cobuild-review-gpt --config scripts/review-gpt.config.sh',
        },
      }),
      'utf8',
    )
    await writeFile(
      path.join(root, 'scripts', 'review-gpt.config.sh'),
      '#!/usr/bin/env bash\n',
      'utf8',
    )

    const resolved = resolveReviewGptWorkspaceRoot({
      prompt: 'Research something',
      vault: path.join(root, 'nested', 'deeper', 'vault'),
    })

    assert.equal(resolved, root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('helper utilities build stable research titles and note paths', () => {
  assert.equal(
    deriveResearchTitle('  Short prompt about ApoB changes  '),
    'Short prompt about ApoB changes',
  )
  assert.equal(
    buildResearchRelativePath(
      new Date('2026-03-24T06:34:29.000Z'),
      'ApoB monthly review',
    ),
    'research/2026/03/2026-03-24-063429000-apob-monthly-review.md',
  )
})
