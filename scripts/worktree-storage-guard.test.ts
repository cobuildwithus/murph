import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const roots: string[] = []

type Harness = {
  fakeBin: string
  primary: string
  root: string
  state: string
}

function runGit(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
  return result.stdout.trim()
}

function executable(filePath: string, contents: string): void {
  writeFileSync(filePath, contents)
  chmodSync(filePath, 0o755)
}

function createHarness(): Harness {
  const root = mkdtempSync(path.join(os.tmpdir(), 'murph-worktree-guard-test-'))
  roots.push(root)
  const primary = path.join(root, 'primary')
  const fakeBin = path.join(root, 'bin')
  const state = path.join(root, 'guard-state')
  mkdirSync(path.join(primary, 'scripts'), { recursive: true })
  mkdirSync(path.join(primary, '.githooks'), { recursive: true })
  mkdirSync(fakeBin, { recursive: true })
  for (const name of ['worktree-storage-guard', 'create-worktree', 'install-git-hooks']) {
    executable(
      path.join(primary, 'scripts', name),
      readFileSync(path.join(sourceRoot, 'scripts', name), 'utf8'),
    )
  }
  executable(
    path.join(primary, '.githooks', 'pre-commit'),
    readFileSync(path.join(sourceRoot, '.githooks', 'pre-commit'), 'utf8'),
  )
  writeFileSync(path.join(primary, 'tracked.txt'), 'baseline\n')
  executable(
    path.join(fakeBin, 'df'),
    `#!/usr/bin/env bash
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n'
printf 'testfs 100000000 10000000 90000000 10%% /\\n'
`,
  )
  runGit(primary, ['init', '-b', 'main'])
  runGit(primary, ['config', 'user.name', 'Worktree Guard Test'])
  runGit(primary, ['config', 'user.email', 'worktree-guard@users.noreply.github.com'])
  runGit(primary, ['add', '.'])
  runGit(primary, ['commit', '-m', 'baseline'])
  return { fakeBin, primary, root, state }
}

function runScript(
  harness: Harness,
  script: 'worktree-storage-guard' | 'create-worktree' | 'install-git-hooks',
  args: string[] = [],
  overrides: NodeJS.ProcessEnv = {},
) {
  return spawnSync('bash', [path.join('scripts', script), ...args], {
    cwd: harness.primary,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${harness.fakeBin}${path.delimiter}${process.env.PATH ?? ''}`,
      MURPH_WORKTREE_GUARD_STATE_DIR: harness.state,
      MURPH_WORKTREE_MAX_LIVE: '2',
      MURPH_WORKTREE_MIN_FREE_GIB: '1',
      MURPH_WORKTREE_MIN_FREE_PERCENT: '20',
      ...overrides,
    },
  })
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { force: true, recursive: true })
})

describe('worktree storage guard', () => {
  it('runs from both repository commit entrypoints', () => {
    expect(readFileSync(path.join(sourceRoot, '.githooks', 'pre-commit'), 'utf8')).toContain(
      '"$guard_root/scripts/worktree-storage-guard"',
    )
    expect(readFileSync(path.join(sourceRoot, 'scripts', 'committer'), 'utf8')).toContain(
      'scripts/install-git-hooks',
    )
    const packageJson = JSON.parse(
      readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'),
    )
    expect(packageJson.scripts.prepare).toBe(
      'if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then scripts/install-git-hooks; fi',
    )
  })

  it('requires isolated state for a custom ratchet maximum', () => {
    const harness = createHarness()
    const result = runScript(harness, 'worktree-storage-guard', [], {
      MURPH_WORKTREE_GUARD_STATE_DIR: undefined,
      MURPH_WORKTREE_MAX_LIVE: '2',
    })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('custom maximum requires isolated state')
  })

  it('uses the primary checkout hook to reject commits from raw legacy worktrees', () => {
    const harness = createHarness()
    try {
      executable(path.join(harness.primary, '.githooks', 'pre-commit'), '#!/bin/sh\nexit 0\n')
      executable(path.join(harness.primary, 'scripts', 'worktree-storage-guard'), '#!/bin/sh\nexit 0\n')
      runGit(harness.primary, ['add', '.githooks/pre-commit', 'scripts/worktree-storage-guard'])
      runGit(harness.primary, ['commit', '-m', 'legacy hooks'])
      const legacyHead = runGit(harness.primary, ['rev-parse', 'HEAD'])

      executable(
        path.join(harness.primary, '.githooks', 'pre-commit'),
        readFileSync(path.join(sourceRoot, '.githooks', 'pre-commit'), 'utf8'),
      )
      executable(
        path.join(harness.primary, 'scripts', 'worktree-storage-guard'),
        readFileSync(path.join(sourceRoot, 'scripts', 'worktree-storage-guard'), 'utf8'),
      )
      runGit(harness.primary, ['add', '.githooks/pre-commit', 'scripts/worktree-storage-guard'])
      runGit(harness.primary, ['commit', '-m', 'guard rollout'])

      const install = runScript(harness, 'install-git-hooks', [], {
        MURPH_WORKTREE_MAX_LIVE: '3',
      })
      expect(install.status, install.stderr).toBe(0)

      const legacy = path.join(harness.root, 'legacy')
      runGit(harness.primary, ['worktree', 'add', '-b', 'legacy-task', legacy, legacyHead])
      runGit(legacy, ['config', 'core.hooksPath', '.githooks'])
      expect(runGit(legacy, ['config', '--get', 'core.hooksPath'])).toBe(
        path.join(realpathSync(harness.primary), '.githooks'),
      )
      writeFileSync(path.join(legacy, 'tracked.txt'), 'legacy change\n')
      runGit(legacy, ['add', 'tracked.txt'])
      const commit = spawnSync('git', ['commit', '-m', 'must be blocked'], {
        cwd: legacy,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${harness.fakeBin}${path.delimiter}${process.env.PATH ?? ''}`,
          MURPH_WORKTREE_GUARD_STATE_DIR: harness.state,
          MURPH_WORKTREE_MAX_LIVE: '3',
          MURPH_WORKTREE_MIN_FREE_GIB: '1',
          MURPH_WORKTREE_MIN_FREE_PERCENT: '20',
        },
      })
      expect(commit.status).toBe(1)
      expect(commit.stderr).toContain('bypassed scripts/create-worktree')
    } finally {
      rmSync(harness.root, { recursive: true, force: true })
    }
  })

  it('ratchets a legacy worktree count downward and refuses later growth', () => {
    const harness = createHarness()
    const paths = ['one', 'two', 'three'].map((name) => path.join(harness.root, name))
    paths.forEach((target, index) => {
      runGit(harness.primary, ['worktree', 'add', '-b', `task-${index}`, target])
    })

    const baseline = runScript(harness, 'worktree-storage-guard')
    expect(baseline.status, baseline.stderr).toBe(0)
    expect(baseline.stdout).toContain('regular=3 data=0 ceiling=3')
    expect(runScript(harness, 'worktree-storage-guard', ['--reserve-worktree']).status).toBe(1)

    runGit(harness.primary, ['worktree', 'remove', paths[2]])
    expect(runScript(harness, 'worktree-storage-guard').status).toBe(0)
    expect(readFileSync(path.join(harness.state, 'regular-worktree-ceiling'), 'utf8')).toBe('2\n')

    runGit(harness.primary, ['worktree', 'add', '-b', 'task-reintroduced', paths[2]])
    const reintroducedAdmin = runGit(paths[2], [
      'rev-parse',
      '--path-format=absolute',
      '--git-dir',
    ])
    writeFileSync(path.join(reintroducedAdmin, 'murph-storage-guard-authorized'), '')
    const growth = runScript(harness, 'worktree-storage-guard')
    expect(growth.status).toBe(1)
    expect(growth.stderr).toContain('exceeds the ratcheted ceiling of 2')
  })

  it.each([
    {
      available: '10000000',
      capacity: '80%',
      name: 'absolute free-space',
      total: '50000000',
    },
    {
      available: '30000000',
      capacity: '85%',
      name: 'percentage free-space',
      total: '200000000',
    },
  ])('fails closed when the $name floor alone is missed', ({ available, capacity, total }) => {
    const harness = createHarness()
    executable(
      path.join(harness.fakeBin, 'df'),
      `#!/usr/bin/env bash
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n'
printf '%s\\n' 'testfs ${total} 1 ${available} ${capacity} /'
`,
    )
    const result = runScript(harness, 'worktree-storage-guard', [], {
      MURPH_WORKTREE_MIN_FREE_GIB: '20',
      MURPH_WORKTREE_MIN_FREE_PERCENT: '20',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('require at least 20 GiB and 20% free')
  })

  it('initializes authorization even when the first disk-floor check fails', () => {
    const harness = createHarness()
    executable(
      path.join(harness.fakeBin, 'df'),
      `#!/usr/bin/env bash
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n'
printf '%s\\n' 'testfs 200000000 1 30000000 85% /'
`,
    )
    const first = runScript(harness, 'worktree-storage-guard', [], {
      MURPH_WORKTREE_MIN_FREE_GIB: '20',
      MURPH_WORKTREE_MIN_FREE_PERCENT: '20',
      MURPH_WORKTREE_MAX_LIVE: '3',
    })
    expect(first.status).toBe(1)
    expect(first.stderr).toContain('only 15% free')

    executable(
      path.join(harness.fakeBin, 'df'),
      `#!/usr/bin/env bash
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n'
printf '%s\\n' 'testfs 100000000 1 90000000 10% /'
`,
    )
    runGit(harness.primary, [
      'worktree',
      'add',
      '-b',
      'raw-after-low-disk',
      path.join(harness.root, 'raw-after-low-disk'),
    ])
    const second = runScript(harness, 'worktree-storage-guard', [], {
      MURPH_WORKTREE_MAX_LIVE: '3',
    })
    expect(second.status).toBe(1)
    expect(second.stderr).toContain('bypassed scripts/create-worktree')
  })

  it('checks the prospective target filesystem before creating a worktree', () => {
    const harness = createHarness()
    const externalParent = path.join(harness.root, 'external-parent')
    mkdirSync(externalParent)
    executable(
      path.join(harness.fakeBin, 'df'),
      `#!/usr/bin/env bash
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n'
for candidate in "$@"; do
  [[ "$candidate" == -* ]] && continue
  if [[ "$candidate" == *external-parent* ]]; then
    printf '%s\\n' 'external volume 200000000 1 30000000 85% /Volumes/External SSD'
  else
    printf '%s\\n' 'primary 100000000 1 90000000 10% /primary'
  fi
done
`,
    )
    const target = path.join(externalParent, 'new-worktree')
    const result = runScript(
      harness,
      'create-worktree',
      ['-b', 'external-low-disk', target],
      {
        MURPH_WORKTREE_MIN_FREE_GIB: '20',
        MURPH_WORKTREE_MIN_FREE_PERCENT: '20',
        MURPH_WORKTREE_MAX_LIVE: '3',
      },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('only 15% free')
    expect(existsSync(target)).toBe(false)
  })

  it('rejects raw worktree creation even while the numeric budget has room', () => {
    const harness = createHarness()
    expect(
      runScript(harness, 'worktree-storage-guard', [], {
        MURPH_WORKTREE_MAX_LIVE: '3',
      }).status,
    ).toBe(0)

    runGit(harness.primary, [
      'worktree',
      'add',
      '-b',
      'raw-task',
      path.join(harness.root, 'raw'),
    ])
    const result = runScript(harness, 'worktree-storage-guard', [], {
      MURPH_WORKTREE_MAX_LIVE: '3',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('bypassed scripts/create-worktree')
  })

  it('rejects raw worktrees whose Git administrative paths are relative', () => {
    const harness = createHarness()
    expect(
      runScript(harness, 'worktree-storage-guard', [], {
        MURPH_WORKTREE_MAX_LIVE: '3',
      }).status,
    ).toBe(0)
    runGit(harness.primary, ['config', 'worktree.useRelativePaths', 'true'])
    const raw = path.join(harness.root, 'nested', 'deeper', 'raw')
    mkdirSync(path.dirname(raw), { recursive: true })
    runGit(harness.primary, ['worktree', 'add', '-b', 'relative-raw-task', raw])

    const result = runScript(harness, 'worktree-storage-guard', [], {
      MURPH_WORKTREE_MAX_LIVE: '3',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('bypassed scripts/create-worktree')
  })

  it('does not wedge when a checkout hook fails after worktree registration', () => {
    const harness = createHarness()
    const postCheckout = path.join(harness.primary, '.githooks', 'post-checkout')
    executable(postCheckout, '#!/bin/sh\nexit 23\n')
    const target = path.join(harness.root, 'partial')

    const creation = runScript(harness, 'create-worktree', [
      '-b',
      'partial-hook-failure',
      target,
    ])
    expect(creation.status).toBe(23)
    expect(runGit(harness.primary, ['worktree', 'list', '--porcelain'])).toContain(target)
    rmSync(postCheckout)

    const guard = runScript(harness, 'worktree-storage-guard')
    expect(guard.status, guard.stderr).toBe(0)
  })

  it('ignores a stale advisory-lock file after its owner exits', () => {
    const harness = createHarness()
    mkdirSync(harness.state, { recursive: true })
    writeFileSync(path.join(harness.state, 'lock'), 'stale lock contents\n')

    expect(runScript(harness, 'worktree-storage-guard').status).toBe(0)
    expect(runScript(harness, 'worktree-storage-guard').status).toBe(0)
  })

  it('creates explicitly locked data worktrees without consuming the regular budget', () => {
    const harness = createHarness()
    const regularOne = path.join(harness.root, 'regular-one')
    const regularTwo = path.join(harness.root, 'regular-two')
    const data = path.join(harness.root, 'data')

    expect(
      runScript(harness, 'create-worktree', ['-b', 'regular-task-one', regularOne]).status,
    ).toBe(0)
    expect(
      runScript(harness, 'create-worktree', ['-b', 'regular-task-two', regularTwo]).status,
    ).toBe(0)
    expect(
      runScript(harness, 'create-worktree', [
        '--data-research',
        'supplement label parsing',
        '-b',
        'data-task',
        data,
      ]).status,
    ).toBe(0)

    const listing = runGit(harness.primary, ['worktree', 'list', '--porcelain'])
    expect(listing).toContain('locked data/research: supplement label parsing')
    const check = runScript(harness, 'worktree-storage-guard')
    expect(check.status, check.stderr).toBe(0)
    expect(check.stdout).toContain('regular=2 data=1 ceiling=2')
    expect(runGit(harness.primary, ['show', 'main:tracked.txt'])).toBe('baseline')
    for (const branch of ['regular-task-one', 'regular-task-two', 'data-task']) {
      expect(runGit(harness.primary, ['rev-parse', '--verify', `refs/heads/${branch}`])).toMatch(
        /^[0-9a-f]{40,64}$/,
      )
    }

    executable(
      path.join(harness.fakeBin, 'df'),
      `#!/usr/bin/env bash
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n'
printf '%s\\n' 'testfs 200000000 1 30000000 85% /'
`,
    )
    const lowDisk = runScript(harness, 'worktree-storage-guard', [], {
      MURPH_WORKTREE_MIN_FREE_GIB: '20',
      MURPH_WORKTREE_MIN_FREE_PERCENT: '20',
    })
    expect(lowDisk.status).toBe(1)
    expect(lowDisk.stderr).toContain('only 15% free')
  })
})
