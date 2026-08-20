import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

type Harness = {
  branch: string
  fakeBin: string
  head: string
  primary: string
  root: string
  target: string
}

function runGit(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(
      `Git harness command failed (${args.join(' ')}): ${result.stderr}`,
    )
  }
  return result.stdout.trim()
}

function writeExecutable(filePath: string, contents: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, contents)
  chmodSync(filePath, 0o755)
}

function createHarness(): Harness {
  const root = mkdtempSync(path.join(os.tmpdir(), 'murph-retire-worktree-test-'))
  const primary = path.join(root, 'primary')
  const target = path.join(root, 'task-worktree')
  const fakeBin = path.join(root, 'fake-bin')
  const branch = 'codex/experiment-lifecycle-cards'

  mkdirSync(primary, { recursive: true })
  mkdirSync(path.join(primary, 'agent-docs', 'exec-plans', 'active'), {
    recursive: true,
  })
  mkdirSync(path.join(primary, 'scripts'), { recursive: true })
  writeFileSync(
    path.join(primary, 'agent-docs', 'exec-plans', 'active', 'README.md'),
    '# Active plans\n',
  )
  writeFileSync(path.join(primary, '.gitignore'), 'node_modules/\n.next/\n')
  const sourceScript = path.join(repoRoot, 'scripts', 'retire-worktree')
  writeExecutable(
    path.join(primary, 'scripts', 'retire-worktree'),
    readFileSync(sourceScript, 'utf8'),
  )
  writeExecutable(
    path.join(fakeBin, 'gh'),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "\${RETIRE_TEST_PR_JSON:?}"
`,
  )
  writeExecutable(
    path.join(fakeBin, 'lsof'),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${RETIRE_TEST_LSOF_EMPTY:-}" == '1' ]]; then
  exit 0
fi
if [[ -n "\${RETIRE_TEST_LSOF_TARGET:-}" ]]; then
  printf 'p999\\nn%s\\n' "$RETIRE_TEST_LSOF_TARGET"
else
  printf 'p1\\nn/\\n'
fi
`,
  )
  writeExecutable(
    path.join(fakeBin, 'uname'),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ -n "\${RETIRE_TEST_UNAME:-}" ]]; then
  printf '%s\\n' "$RETIRE_TEST_UNAME"
else
  command -p uname "$@"
fi
`,
  )

  runGit(primary, ['init', '-b', 'main'])
  mkdirSync(path.join(primary, '.disabled-hooks'))
  runGit(primary, ['config', 'core.hooksPath', '.disabled-hooks'])
  runGit(primary, ['config', 'user.name', 'Retirement Harness'])
  runGit(primary, [
    'config',
    'user.email',
    'retirement-harness@users.noreply.github.com',
  ])
  runGit(primary, ['add', '.'])
  runGit(primary, ['commit', '-m', 'baseline'])
  runGit(primary, [
    'update-ref',
    'refs/remotes/origin/main',
    runGit(primary, ['rev-parse', 'HEAD']),
  ])
  runGit(primary, ['worktree', 'add', '-b', branch, target])
  writeFileSync(path.join(target, 'task-change.txt'), 'task change\n')
  runGit(target, ['add', 'task-change.txt'])
  runGit(target, ['commit', '-m', 'task change'])
  const canonicalTarget = realpathSync(target)

  return {
    branch,
    fakeBin,
    head: runGit(canonicalTarget, ['rev-parse', 'HEAD']),
    primary,
    root,
    target: canonicalTarget,
  }
}

function terminalPullRequest(harness: Harness): Record<string, string | null> {
  return {
    headRefName: harness.branch,
    headRefOid: harness.head,
    state: 'MERGED',
    mergedAt: '2026-07-16T00:00:00Z',
    closedAt: '2026-07-16T00:00:00Z',
  }
}

function runRetirement(
  harness: Harness,
  pullRequests: Array<Record<string, string | null>>,
  args: string[] = [harness.target],
  envOverrides: NodeJS.ProcessEnv = {},
) {
  return spawnSync('bash', ['scripts/retire-worktree', ...args], {
    cwd: harness.primary,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${harness.fakeBin}${path.delimiter}${process.env.PATH ?? ''}`,
      RETIRE_TEST_PR_JSON: JSON.stringify(pullRequests),
      RETIRE_TEST_LSOF_TARGET: '',
      ...envOverrides,
    },
  })
}

async function stopOwnedProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const handleExit = () => resolve()
    child.once('exit', handleExit)
    if (child.exitCode !== null || child.signalCode !== null) {
      child.off('exit', handleExit)
      resolve()
      return
    }
    child.kill('SIGTERM')
  })
}

describe('retire-worktree', () => {
  it(
    'dry-runs, removes terminal and contained task worktrees, and preserves their branches',
    () => {
      const harness = createHarness()
      try {
        mkdirSync(path.join(harness.target, 'node_modules'), { recursive: true })
        writeFileSync(
          path.join(harness.target, 'node_modules', 'ignored-cache.txt'),
          'ignored build cache\n',
        )
        const mergedPullRequests = [terminalPullRequest(harness)]
        const closedPullRequests = [
          {
            ...terminalPullRequest(harness),
            state: 'CLOSED',
            mergedAt: null,
          },
        ]
        const dryRun = runRetirement(harness, closedPullRequests, [
          '--dry-run',
          harness.target,
        ])
        expect(dryRun.status, dryRun.stderr).toBe(0)
        expect(dryRun.stdout).toContain('eligible; branch will be preserved')
        expect(existsSync(harness.target)).toBe(true)

        const removal = runRetirement(harness, mergedPullRequests)
        expect(removal.status, removal.stderr).toBe(0)
        expect(removal.stdout).toContain('branch preserved')
        expect(existsSync(harness.target)).toBe(false)
        expect(
          runGit(harness.primary, [
            'show-ref',
            '--verify',
            `refs/heads/${harness.branch}`,
          ]),
        ).toContain(harness.head)

        const ancestorTarget = path.join(harness.root, 'ancestor-worktree')
        const ancestorBranch = 'ancestor-retirement-harness'
        runGit(harness.primary, [
          'worktree',
          'add',
          '-b',
          ancestorBranch,
          ancestorTarget,
          'main',
        ])
        const canonicalAncestorTarget = realpathSync(ancestorTarget)
        const ancestorHarness: Harness = {
          ...harness,
          branch: ancestorBranch,
          head: runGit(canonicalAncestorTarget, ['rev-parse', 'HEAD']),
          target: canonicalAncestorTarget,
        }
        const ancestorRemoval = runRetirement(ancestorHarness, [])
        expect(ancestorRemoval.status, ancestorRemoval.stderr).toBe(0)
        expect(existsSync(canonicalAncestorTarget)).toBe(false)
        expect(
          runGit(harness.primary, [
            'show-ref',
            '--verify',
            `refs/heads/${ancestorBranch}`,
          ]),
        ).toContain(ancestorHarness.head)
      } finally {
        rmSync(harness.root, { recursive: true, force: true })
      }
    },
    180_000,
  )

  it('refuses dirty targets and exact-head mismatches', () => {
    const harness = createHarness()
    try {
      writeFileSync(path.join(harness.target, 'untracked.txt'), 'preserve me\n')
      const dirty = runRetirement(harness, [terminalPullRequest(harness)])
      expect(dirty.status).toBe(1)
      expect(dirty.stderr).toContain('tracked or untracked changes')
      expect(existsSync(harness.target)).toBe(true)

      rmSync(path.join(harness.target, 'untracked.txt'))
      const wrongHead = runRetirement(harness, [
        { ...terminalPullRequest(harness), headRefOid: '0'.repeat(40) },
      ])
      expect(wrongHead.status).toBe(1)
      expect(wrongHead.stderr).toContain(
        'target HEAD has no terminal PR and is not contained in origin/main',
      )
      expect(existsSync(harness.target)).toBe(true)
    } finally {
      rmSync(harness.root, { recursive: true, force: true })
    }
  })

  it('retires a clean inactive no-PR worktree only through the explicit mode', () => {
    const harness = createHarness()
    try {
      const ordinary = runRetirement(harness, [])
      expect(ordinary.status).toBe(1)
      expect(ordinary.stderr).toContain(
        'target HEAD has no terminal PR and is not contained in origin/main',
      )
      expect(existsSync(harness.target)).toBe(true)

      const removal = runRetirement(harness, [], [
        '--inactive-no-pr',
        harness.target,
      ])
      expect(removal.status, removal.stderr).toBe(0)
      expect(removal.stdout).toContain('branch preserved')
      expect(existsSync(harness.target)).toBe(false)
      expect(
        runGit(harness.primary, [
          'show-ref',
          '--verify',
          `refs/heads/${harness.branch}`,
        ]),
      ).toContain(harness.head)
    } finally {
      rmSync(harness.root, { recursive: true, force: true })
    }
  })

  it('retires only an explicitly authorized detached HEAD contained in origin/main', () => {
    const harness = createHarness()
    try {
      runGit(harness.primary, ['worktree', 'remove', harness.target])
      const detachedTarget = path.join(harness.root, 'detached-benchmark')
      runGit(harness.primary, ['worktree', 'add', '--detach', detachedTarget, 'main'])
      const detachedHarness: Harness = {
        ...harness,
        branch: '',
        head: runGit(detachedTarget, ['rev-parse', 'HEAD']),
        target: realpathSync(detachedTarget),
      }

      const ordinary = runRetirement(detachedHarness, [])
      expect(ordinary.status).toBe(1)
      expect(ordinary.stderr).toContain('use --contained-detached')

      const removal = runRetirement(detachedHarness, [], [
        '--contained-detached',
        detachedHarness.target,
      ])
      expect(removal.status, removal.stderr).toBe(0)
      expect(removal.stdout).toContain('no branch changed')
      expect(existsSync(detachedHarness.target)).toBe(false)
    } finally {
      rmSync(harness.root, { recursive: true, force: true })
    }
  })

  it('refuses to retire a worktree referenced by a primary dependency symlink', () => {
    const harness = createHarness()
    try {
      mkdirSync(path.join(harness.primary, 'node_modules'), { recursive: true })
      symlinkSync(harness.target, path.join(harness.primary, 'node_modules', 'linked-task'))

      const result = runRetirement(harness, [terminalPullRequest(harness)])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('primary dependency link resolves through the target')
      expect(result.stderr).toContain('node_modules/linked-task')
      expect(existsSync(harness.target)).toBe(true)
    } finally {
      rmSync(harness.root, { recursive: true, force: true })
    }
  })

  it('moves an eligible checkout to a visible quarantine before recursive removal', () => {
    const harness = createHarness()
    try {
      const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim()
      writeExecutable(
        path.join(harness.fakeBin, 'git'),
        `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == 'worktree' && "\${2:-}" == 'remove' ]]; then
  exit 1
fi
exec "\${RETIRE_TEST_REAL_GIT:?}" "$@"
`,
      )

      const result = runRetirement(
        harness,
        [terminalPullRequest(harness)],
        [harness.target],
        { RETIRE_TEST_REAL_GIT: realGit },
      )
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('remains visibly quarantined')
      expect(existsSync(harness.target)).toBe(false)
      const quarantine = readdirSync(harness.root).find((entry) =>
        entry.startsWith('task-worktree.retiring-'),
      )
      expect(quarantine).toBeDefined()
      expect(
        runGit(harness.primary, ['worktree', 'list', '--porcelain']),
      ).toContain(path.join(harness.root, quarantine!))
    } finally {
      rmSync(harness.root, { recursive: true, force: true })
    }
  })

  it('refuses open PRs and active-task references', () => {
    const harness = createHarness()
    try {
      const openPullRequest = {
        ...terminalPullRequest(harness),
        state: 'OPEN',
        mergedAt: null,
        closedAt: null,
      }
      const open = runRetirement(harness, [openPullRequest])
      expect(open.status).toBe(1)
      expect(open.stderr).toContain('target branch still has an open PR')

      const explicitOpen = runRetirement(
        harness,
        [openPullRequest],
        ['--inactive-no-pr', harness.target],
      )
      expect(explicitOpen.status).toBe(1)
      expect(explicitOpen.stderr).toContain('target branch still has an open PR')

      writeFileSync(
        path.join(
          harness.primary,
          'agent-docs',
          'exec-plans',
          'active',
          'task.md',
        ),
        `Branch: ${harness.branch}\n`,
      )
      const active = runRetirement(harness, [terminalPullRequest(harness)])
      expect(active.status).toBe(1)
      expect(active.stderr).toContain('still referenced by active task coordination')
      expect(existsSync(harness.target)).toBe(true)

      rmSync(
        path.join(
          harness.primary,
          'agent-docs',
          'exec-plans',
          'active',
          'task.md',
        ),
      )
      writeFileSync(
        path.join(
          harness.primary,
          'agent-docs',
          'exec-plans',
          'active',
          'task.md',
        ),
        'Plan: Experiment lifecycle cards\n',
      )
      const normalizedActive = runRetirement(
        harness,
        [],
        ['--inactive-no-pr', harness.target],
      )
      expect(normalizedActive.status).toBe(1)
      expect(normalizedActive.stderr).toContain(
        'still referenced by active task coordination',
      )
      expect(existsSync(harness.target)).toBe(true)
      rmSync(
        path.join(
          harness.primary,
          'agent-docs',
          'exec-plans',
          'active',
          'task.md',
        ),
      )
      writeFileSync(
        path.join(
          harness.target,
          'agent-docs',
          'exec-plans',
          'active',
          'target-task.md',
        ),
        `Branch: ${harness.branch}\n`,
      )
      runGit(harness.target, ['add', '.'])
      runGit(harness.target, ['commit', '-m', 'target active plan'])
      harness.head = runGit(harness.target, ['rev-parse', 'HEAD'])

      const targetActive = runRetirement(harness, [
        terminalPullRequest(harness),
      ])
      expect(targetActive.status).toBe(1)
      expect(targetActive.stderr).toContain(
        'still referenced by active task coordination',
      )
      expect(existsSync(harness.target)).toBe(true)
    } finally {
      rmSync(harness.root, { recursive: true, force: true })
    }
  })

  it('revalidates terminal PR state immediately before removal', () => {
    const harness = createHarness()
    try {
      const ghCallCount = path.join(harness.root, 'gh-call-count')
      const openPullRequest = {
        ...terminalPullRequest(harness),
        state: 'OPEN',
        mergedAt: null,
        closedAt: null,
      }
      writeExecutable(
        path.join(harness.fakeBin, 'gh'),
        `#!/usr/bin/env bash
set -euo pipefail
call_count=0
if [[ -f "\${RETIRE_TEST_GH_CALL_COUNT:?}" ]]; then
  read -r call_count < "\${RETIRE_TEST_GH_CALL_COUNT}"
fi
call_count=$((call_count + 1))
printf '%s\n' "$call_count" > "\${RETIRE_TEST_GH_CALL_COUNT}"
if [[ "$call_count" -eq 1 ]]; then
  printf '%s\n' "\${RETIRE_TEST_PR_JSON:?}"
else
  printf '%s\n' "\${RETIRE_TEST_PR_JSON_SECOND:?}"
fi
`,
      )

      const result = runRetirement(
        harness,
        [terminalPullRequest(harness)],
        [harness.target],
        {
          RETIRE_TEST_GH_CALL_COUNT: ghCallCount,
          RETIRE_TEST_PR_JSON_SECOND: JSON.stringify([openPullRequest]),
        },
      )

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('target branch still has an open PR')
      expect(readFileSync(ghCallCount, 'utf8').trim()).toBe('2')
      expect(existsSync(harness.target)).toBe(true)
    } finally {
      rmSync(harness.root, { recursive: true, force: true })
    }
  })

  it('refuses the current checkout and a target used as a process working directory', async () => {
    const harness = createHarness()
    let child: ChildProcess | undefined
    try {
      const current = runRetirement(
        harness,
        [terminalPullRequest(harness)],
        [harness.primary],
      )
      expect(current.status).toBe(1)
      expect(current.stderr).toContain('target is the current worktree')

      const emptyProcessSnapshot = runRetirement(
        harness,
        [terminalPullRequest(harness)],
        [harness.target],
        { RETIRE_TEST_LSOF_EMPTY: '1', RETIRE_TEST_UNAME: 'Darwin' },
      )
      expect(emptyProcessSnapshot.status).toBe(1)
      expect(emptyProcessSnapshot.stderr).toContain(
        'process working directories could not be inspected',
      )
      expect(existsSync(harness.target)).toBe(true)

      child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        cwd: harness.target,
        stdio: 'ignore',
      })
      await new Promise((resolve) => setTimeout(resolve, 100))

      const inUse = runRetirement(
        harness,
        [terminalPullRequest(harness)],
        [harness.target],
        process.platform === 'linux'
          ? {}
          : { RETIRE_TEST_LSOF_TARGET: harness.target },
      )
      expect(inUse.status).toBe(1)
      expect(inUse.stderr).toContain(
        'a process has a working directory inside the target',
      )
      expect(existsSync(harness.target)).toBe(true)
    } finally {
      if (child) await stopOwnedProcess(child)
      rmSync(harness.root, { recursive: true, force: true })
    }
  })
})
