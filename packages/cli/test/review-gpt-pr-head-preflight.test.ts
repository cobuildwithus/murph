import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(packageDir, '..', '..')
const harnessRoots: string[] = []

function writeExecutable(filePath: string, contents: string) {
  writeFileSync(filePath, contents, 'utf8')
  chmodSync(filePath, 0o755)
}

function createHarness() {
  const harnessRoot = mkdtempSync(path.join(os.tmpdir(), 'murph-review-gpt-pr-guard-'))
  const binDir = path.join(harnessRoot, 'bin')
  const capturePath = path.join(harnessRoot, 'review-gpt-invocation.txt')
  harnessRoots.push(harnessRoot)
  mkdirSync(path.join(harnessRoot, 'scripts', 'chatgpt-review-presets'), {
    recursive: true,
  })
  mkdirSync(binDir, { recursive: true })
  cpSync(
    path.join(repoRoot, 'scripts', 'review-gpt-pr-head-preflight.sh'),
    path.join(harnessRoot, 'scripts', 'review-gpt-pr-head-preflight.sh'),
  )
  cpSync(
    path.join(
      repoRoot,
      'scripts',
      'chatgpt-review-presets',
      'completion-specialists.md',
    ),
    path.join(
      harnessRoot,
      'scripts',
      'chatgpt-review-presets',
      'completion-specialists.md',
    ),
  )
  writeFileSync(path.join(harnessRoot, 'tracked.txt'), 'tracked\n', 'utf8')
  writeExecutable(
    path.join(binDir, 'gh'),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == "pr view --json number --jq .number" ]]; then
  printf '%s\\n' '42'
elif [[ "$*" == "pr view 42 --json headRefOid --jq .headRefOid" ]]; then
  printf '%s\\n' "\${STUB_PR_HEAD}"
else
  printf 'unexpected gh invocation: %s\\n' "$*" >&2
  exit 2
fi
`,
  )
  writeExecutable(
    path.join(binDir, 'pnpm'),
    `#!/usr/bin/env bash
set -euo pipefail
{
  printf 'pr=%s\\n' "\${REVIEW_GPT_PR_URL:-}"
  printf 'phase=%s\\n' "\${REVIEW_GPT_REVIEW_PHASE:-}"
  printf 'args=%s\\n' "$*"
} > "\${REVIEW_GPT_TEST_CAPTURE}"
`,
  )

  execFileSync('git', ['init', '-q'], { cwd: harnessRoot })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: harnessRoot })
  execFileSync('git', ['config', 'user.email', 'test@users.noreply.github.com'], {
    cwd: harnessRoot,
  })
  execFileSync('git', ['add', '.'], { cwd: harnessRoot })
  execFileSync('git', ['commit', '-q', '-m', 'fixture'], { cwd: harnessRoot })
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: harnessRoot,
    encoding: 'utf8',
  }).trim()

  const env = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
    REVIEW_GPT_PR_REF: '',
    REVIEW_GPT_PR_URL: '',
    REVIEW_GPT_REVIEW_PHASE: '',
    REVIEW_GPT_TEST_CAPTURE: capturePath,
    STUB_PR_HEAD: head,
  }
  return { capturePath, env, harnessRoot, head }
}

function runHarness(
  harness: ReturnType<typeof createHarness>,
  args: string[],
  envOverrides: NodeJS.ProcessEnv = {},
) {
  return spawnSync('bash', ['scripts/review-gpt-pr-head-preflight.sh', '--run', ...args], {
    cwd: harness.harnessRoot,
    encoding: 'utf8',
    env: { ...harness.env, ...envOverrides },
  })
}

afterEach(() => {
  for (const harnessRoot of harnessRoots.splice(0)) {
    rmSync(harnessRoot, { force: true, recursive: true })
  }
})

describe('ReviewGPT PR context guard', () => {
  it.each([
    ['completion-specialists', 'preliminary'],
    ['pr-review', 'final'],
    ['--preset=specialist-review', 'preliminary'],
  ])('derives exact PR context for %s', (preset, expectedPhase) => {
    const harness = createHarness()
    const result = runHarness(harness, [preset, '--dry-run'])

    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(harness.capturePath, 'utf8')).toBe(
      `pr=42\nphase=${expectedPhase}\nargs=exec cobuild-review-gpt --config scripts/review-gpt.config.sh ${preset} --dry-run\n`,
    )
    expect(result.stdout).toContain(
      `ReviewGPT PR attachment preflight passed for 42 at ${harness.head}.`,
    )
  })

  it('leaves generic presets outside the PR workflow', () => {
    const harness = createHarness()
    const result = runHarness(harness, ['simplify', '--dry-run'])

    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(harness.capturePath, 'utf8')).toBe(
      'pr=\nphase=\nargs=exec cobuild-review-gpt --config scripts/review-gpt.config.sh simplify --dry-run\n',
    )
  })

  it('rejects an explicit phase that conflicts with the selected preset', () => {
    const harness = createHarness()
    const result = runHarness(harness, ['completion-specialists'], {
      REVIEW_GPT_REVIEW_PHASE: 'final',
    })

    expect(result.status).toBe(64)
    expect(result.stderr).toContain(
      'REVIEW_GPT_REVIEW_PHASE=final conflicts with the selected preliminary PR review preset',
    )
    expect(() => readFileSync(harness.capturePath, 'utf8')).toThrow()
  })

  it('rejects mixed preliminary and final presets before invoking ReviewGPT', () => {
    const harness = createHarness()
    const result = runHarness(harness, ['completion-specialists,pr-review'])

    expect(result.status).toBe(64)
    expect(result.stderr).toContain(
      'preliminary and final PR ReviewGPT presets cannot run together',
    )
    expect(() => readFileSync(harness.capturePath, 'utf8')).toThrow()
  })

  it('enforces the specialist prompt budget when options precede the positional preset', () => {
    const harness = createHarness()
    const result = runHarness(harness, [
      '--prompt',
      'x'.repeat(1_000),
      'completion-specialists',
    ])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('assembled completion-specialists prompt is')
    expect(() => readFileSync(harness.capturePath, 'utf8')).toThrow()
  })

  it.each([
    ['--minimum-marked-response-time', '5m'],
    ['--minimumMarkedResponseTime=7m30s', null],
  ])(
    'rejects the PR threshold override %s after exact-head preflight',
    (option, threshold) => {
      const harness = createHarness()
      const result = runHarness(harness, [
        option,
        ...(threshold === null ? [] : [threshold]),
        'completion-specialists',
        '--dry-run',
      ])

      expect(result.status).toBe(64)
      expect(result.stdout).toContain(
        `ReviewGPT PR attachment preflight passed for 42 at ${harness.head}.`,
      )
      expect(result.stderr).toContain(
        'PR ReviewGPT response thresholds are fixed by review phase',
      )
      expect(() => readFileSync(harness.capturePath, 'utf8')).toThrow()
    },
  )

  it('preserves package-owned threshold overrides for non-PR presets', () => {
    const harness = createHarness()
    const result = runHarness(harness, [
      '--minimum-marked-response-time',
      '1s',
      'simplify',
      '--dry-run',
    ])

    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(harness.capturePath, 'utf8')).toBe(
      'pr=\nphase=\nargs=exec cobuild-review-gpt --config scripts/review-gpt.config.sh --minimum-marked-response-time 1s simplify --dry-run\n',
    )
  })

  it.each([
    ['preliminary', '5m'],
    ['final', '7m30s'],
  ])('fixes the %s PR threshold after sourcing local config', (phase, threshold) => {
    const harness = createHarness()
    const configRoot = path.join(harness.harnessRoot, 'config')
    const localConfigDir = path.join(configRoot, 'murph')
    mkdirSync(localConfigDir, { recursive: true })
    writeFileSync(
      path.join(localConfigDir, 'review-gpt.conf'),
      'minimum_marked_response_ms="4m59s"\n',
      'utf8',
    )

    const result = spawnSync(
      'bash',
      [
        '-c',
        [
          'review_gpt_register_dir_preset() { :; }',
          'review_gpt_register_preset_group() { :; }',
          'source "$1"',
          'printf "%s\\n" "$minimum_marked_response_ms"',
        ].join('\n'),
        'review-gpt-config-test',
        path.join(repoRoot, 'scripts', 'review-gpt.config.sh'),
      ],
      {
        cwd: harness.harnessRoot,
        encoding: 'utf8',
        env: {
          ...harness.env,
          REVIEW_GPT_BROWSER_LANE: 'phlebas',
          REVIEW_GPT_PR_URL: '42',
          REVIEW_GPT_REVIEW_PHASE: phase,
          XDG_CONFIG_HOME: configRoot,
        },
      },
    )

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe(threshold)
  })

  it('counts the accepted camelCase promptFile spelling in the specialist budget', () => {
    const harness = createHarness()
    const promptPath = path.join(harness.harnessRoot, 'oversized-prompt.md')
    writeFileSync(promptPath, 'x'.repeat(1_000), 'utf8')
    const result = runHarness(harness, [
      'completion-specialists',
      '--promptFile',
      promptPath,
    ])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('assembled completion-specialists prompt is')
    expect(() => readFileSync(harness.capturePath, 'utf8')).toThrow()
  })

  it('rejects dirty or stale PR heads before invoking ReviewGPT', () => {
    const dirtyHarness = createHarness()
    writeFileSync(path.join(dirtyHarness.harnessRoot, 'untracked.txt'), 'dirty\n', 'utf8')
    const dirtyResult = runHarness(dirtyHarness, ['completion-specialists'])
    expect(dirtyResult.status).toBe(1)
    expect(dirtyResult.stderr).toContain('requires a clean worktree')
    expect(() => readFileSync(dirtyHarness.capturePath, 'utf8')).toThrow()

    const staleHarness = createHarness()
    const staleResult = runHarness(staleHarness, ['pr-review'], {
      STUB_PR_HEAD: '0000000000000000000000000000000000000000',
    })
    expect(staleResult.status).toBe(1)
    expect(staleResult.stderr).toContain('local HEAD does not match the pushed PR head')
    expect(() => readFileSync(staleHarness.capturePath, 'utf8')).toThrow()
  })
})
