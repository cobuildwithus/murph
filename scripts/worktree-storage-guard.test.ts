import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
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
  tempRoot: string
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
  const tempRoot = path.join(root, 'temp')
  mkdirSync(path.join(primary, 'scripts'), { recursive: true })
  mkdirSync(path.join(primary, '.githooks'), { recursive: true })
  mkdirSync(fakeBin, { recursive: true })
  mkdirSync(tempRoot)
  for (const name of [
    'worktree-storage-guard',
    'create-worktree',
    'install-git-hooks',
    'committer',
  ]) {
    executable(
      path.join(primary, 'scripts', name),
      readFileSync(path.join(sourceRoot, 'scripts', name), 'utf8'),
    )
  }
  executable(
    path.join(primary, '.githooks', 'pre-commit'),
    readFileSync(path.join(sourceRoot, '.githooks', 'pre-commit'), 'utf8'),
  )
  writeFileSync(
    path.join(primary, 'scripts', 'repo-tools.config.sh'),
    `cobuild_repo_tool_bin() {
  printf '%s\\n' "\${MURPH_TEST_COMMITTER_BIN:?}"
}
`,
  )
  executable(
    path.join(fakeBin, 'cobuild-committer'),
    '#!/usr/bin/env bash\nset -euo pipefail\nexec git commit "$@"\n',
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
  return { fakeBin, primary, root, state, tempRoot }
}

function guardEnvironment(
  harness: Harness,
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${harness.fakeBin}${path.delimiter}${process.env.PATH ?? ''}`,
    MURPH_WORKTREE_GUARD_STATE_DIR: harness.state,
    MURPH_WORKTREE_MAX_LIVE: '2',
    MURPH_WORKTREE_MIN_FREE_GIB: '1',
    MURPH_WORKTREE_TEMP_ROOTS: harness.tempRoot,
    ...overrides,
  }
}

function runScript(
  harness: Harness,
  script: 'worktree-storage-guard' | 'create-worktree' | 'install-git-hooks' | 'committer',
  args: string[] = [],
  overrides: NodeJS.ProcessEnv = {},
) {
  return spawnSync('bash', [path.join('scripts', script), ...args], {
    cwd: harness.primary,
    encoding: 'utf8',
    env: guardEnvironment(harness, overrides),
  })
}

function installLegacyWorktreeEntrypoints(primary: string): void {
  const currentInstall = readFileSync(path.join(sourceRoot, 'scripts', 'install-git-hooks'), 'utf8')
  const currentCreate = readFileSync(path.join(sourceRoot, 'scripts', 'create-worktree'), 'utf8')
  const currentHook = readFileSync(path.join(sourceRoot, '.githooks', 'pre-commit'), 'utf8')
  const legacyInstall = currentInstall.replace(
    'MURPH_WORKTREE_GUARD_CURRENT_WORKTREE="$repo_root" \\\n  "$primary_worktree/scripts/worktree-storage-guard"',
    '"$primary_worktree/scripts/worktree-storage-guard"',
  )
  const legacyHook = currentHook.replace(
    'MURPH_WORKTREE_GUARD_CURRENT_WORKTREE="$repo_root" \\\n  "$guard_root/scripts/worktree-storage-guard"',
    '"$guard_root/scripts/worktree-storage-guard"',
  )
  if (
    legacyInstall.includes('MURPH_WORKTREE_GUARD_CURRENT_WORKTREE') ||
    legacyHook.includes('MURPH_WORKTREE_GUARD_CURRENT_WORKTREE')
  ) {
    throw new Error('legacy worktree fixture did not remove the current-worktree hint')
  }
  executable(
    path.join(primary, 'scripts', 'install-git-hooks'),
    legacyInstall,
  )
  executable(
    path.join(primary, 'scripts', 'create-worktree'),
    currentCreate.replaceAll('--current-worktree "$repo_root" ', ''),
  )
  executable(
    path.join(primary, 'scripts', 'worktree-storage-guard'),
    `#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd -P)"
common_dir="$(git -C "$repo_root" rev-parse --path-format=absolute --git-common-dir)"
state_dir="\${MURPH_WORKTREE_GUARD_STATE_DIR:-$common_dir/murph-worktree-storage-guard}"
authorization_initialized="$state_dir/authorization-initialized"
mkdir -p "$state_dir"
admin_dirs=()
unauthorized_count=0
while IFS= read -r candidate; do
  [[ -n "$candidate" && -f "$candidate/.git" ]] || continue
  admin_dir="$(git -C "$candidate" rev-parse --path-format=absolute --git-dir)"
  admin_dirs+=("$admin_dir")
  if [[ -f "$authorization_initialized" && ! -f "$admin_dir/murph-storage-guard-authorized" ]]; then
    unauthorized_count=$((unauthorized_count + 1))
  fi
done < <(git -C "$repo_root" worktree list --porcelain | awk '$1 == "worktree" { print substr($0, 10) }')
if (( unauthorized_count > 0 )); then
  printf 'worktree storage guard: %d worktree(s) bypassed scripts/create-worktree\\n' "$unauthorized_count" >&2
  exit 1
fi
if [[ ! -f "$authorization_initialized" ]]; then
  if (( \${#admin_dirs[@]} > 0 )); then
    for admin_dir in "\${admin_dirs[@]}"; do
      : >"$admin_dir/murph-storage-guard-authorized"
    done
  fi
  : >"$authorization_initialized"
fi
`,
  )
  executable(
    path.join(primary, '.githooks', 'pre-commit'),
    legacyHook,
  )
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { force: true, recursive: true })
})

describe('worktree storage guard', () => {
  it('defaults the regular worktree ceiling to 100', () => {
    expect(readFileSync(path.join(sourceRoot, 'scripts', 'worktree-storage-guard'), 'utf8')).toContain(
      'MURPH_WORKTREE_MAX_LIVE:-100',
    )
  })

  it('runs from both repository commit entrypoints', () => {
    const preCommit = readFileSync(path.join(sourceRoot, '.githooks', 'pre-commit'), 'utf8')
    expect(preCommit).toContain('"$guard_root/scripts/worktree-storage-guard"')
    expect(preCommit).toContain('MURPH_WORKTREE_GUARD_CURRENT_WORKTREE="$repo_root"')
    expect(
      readFileSync(path.join(sourceRoot, 'scripts', 'install-git-hooks'), 'utf8'),
    ).toContain('MURPH_WORKTREE_GUARD_CURRENT_WORKTREE="$repo_root"')
    expect(readFileSync(path.join(sourceRoot, 'scripts', 'create-worktree'), 'utf8')).toContain(
      '--current-worktree "$repo_root"',
    )
    expect(readFileSync(path.join(sourceRoot, 'scripts', 'committer'), 'utf8')).toContain(
      'scripts/install-git-hooks',
    )
    const packageJson = JSON.parse(
      readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'),
    )
    expect(packageJson.scripts.prepare).toBe(
      'if [ -z "${CI:-}" ] && [ -z "${VERCEL:-}" ] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then scripts/install-git-hooks; fi',
    )
  })

  it('runs prepare hook setup locally and skips it in hosted automation', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'murph-prepare-hook-test-'))
    roots.push(root)
    const marker = path.join(root, 'hook-installed')
    mkdirSync(path.join(root, 'scripts'))
    executable(
      path.join(root, 'scripts', 'install-git-hooks'),
      `#!/usr/bin/env bash
set -euo pipefail
touch hook-installed
`,
    )
    runGit(root, ['init', '-b', 'main'])

    const packageJson = JSON.parse(readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'))
    const { CI: _ci, VERCEL: _vercel, ...baseEnvironment } = process.env
    const runPrepare = (overrides: NodeJS.ProcessEnv = {}) =>
      spawnSync('bash', ['-c', packageJson.scripts.prepare], {
        cwd: root,
        encoding: 'utf8',
        env: { ...baseEnvironment, ...overrides },
      })

    const local = runPrepare()
    expect(local.status, local.stderr).toBe(0)
    expect(existsSync(marker)).toBe(true)

    rmSync(marker)
    const github = runPrepare({ CI: '1' })
    expect(github.status, github.stderr).toBe(0)
    expect(existsSync(marker)).toBe(false)

    const vercel = runPrepare({ VERCEL: '1' })
    expect(vercel.status, vercel.stderr).toBe(0)
    expect(existsSync(marker)).toBe(false)
  })

  it('avoids process substitution in the install-time guard', () => {
    const guard = readFileSync(
      path.join(sourceRoot, 'scripts', 'worktree-storage-guard'),
      'utf8',
    )

    expect(guard).not.toContain('< <(')
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

  it('composes scoped authorization with sanctioned creation budgets', () => {
    const harness = createHarness()
    const result = runScript(harness, 'worktree-storage-guard', [
      '--current-worktree',
      harness.primary,
      '--reserve-worktree',
      '--target-path',
      path.join(harness.root, 'target'),
    ])
    expect(result.status, result.stderr).toBe(0)
  })

  it('fails closed on malformed local ceiling state', () => {
    const harness = createHarness()
    mkdirSync(harness.state, { recursive: true })
    const stateFile = path.join(harness.state, 'regular-worktree-ceiling')
    writeFileSync(stateFile, 'not-a-number\n')

    const result = runScript(harness, 'worktree-storage-guard')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('invalid local ceiling state')
    expect(readFileSync(stateFile, 'utf8')).toBe('not-a-number\n')
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

  it('promotes an older local ceiling when the configured maximum increases', () => {
    const harness = createHarness()
    const paths = ['one', 'two', 'three'].map((name) => path.join(harness.root, name))

    expect(runScript(harness, 'create-worktree', ['-b', 'task-one', paths[0]]).status).toBe(0)
    expect(runScript(harness, 'create-worktree', ['-b', 'task-two', paths[1]]).status).toBe(0)
    expect(readFileSync(path.join(harness.state, 'regular-worktree-ceiling'), 'utf8')).toBe(
      '2\n',
    )

    const promoted = runScript(
      harness,
      'create-worktree',
      ['-b', 'task-three', paths[2]],
      { MURPH_WORKTREE_MAX_LIVE: '3' },
    )
    expect(promoted.status, promoted.stderr).toBe(0)
    expect(readFileSync(path.join(harness.state, 'regular-worktree-ceiling'), 'utf8')).toBe(
      '3\n',
    )

    const check = runScript(harness, 'worktree-storage-guard', [], {
      MURPH_WORKTREE_MAX_LIVE: '3',
    })
    expect(check.status, check.stderr).toBe(0)
    expect(check.stdout).toContain('regular=3 data=0 ceiling=3')
  })

  it('keeps created worktrees out of Spotlight indexing without dirtying Git', () => {
    const harness = createHarness()
    const target = path.join(harness.root, 'spotlight-excluded')
    const excludeFile = path.join(
      runGit(harness.primary, [
        'rev-parse',
        '--path-format=absolute',
        '--git-common-dir',
      ]),
      'info',
      'exclude',
    )
    writeFileSync(excludeFile, '/custom-local-only')
    writeFileSync(path.join(harness.primary, 'custom-local-only'), 'ignored\n')

    const creation = runScript(harness, 'create-worktree', [
      '-b',
      'spotlight-excluded-task',
      target,
    ])

    expect(creation.status, creation.stderr).toBe(0)
    expect(existsSync(path.join(target, '.metadata_never_index'))).toBe(true)
    expect(runGit(target, ['check-ignore', '.metadata_never_index'])).toBe(
      '.metadata_never_index',
    )
    expect(runGit(harness.primary, ['check-ignore', 'custom-local-only'])).toBe(
      'custom-local-only',
    )
    expect(
      readFileSync(excludeFile, 'utf8')
        .split('\n')
        .filter((rule) => rule === '/.metadata_never_index'),
    ).toHaveLength(1)
    expect(runGit(target, ['status', '--porcelain'])).toBe('')
  })

  it('ratchets unmanaged temporary clones to zero and rejects new paths', () => {
    const harness = createHarness()
    const origin = 'https://example.test/example/murph.git'
    runGit(harness.primary, ['remote', 'add', 'origin', origin])
    const legacyClone = path.join(harness.tempRoot, 'murph-legacy-clone')
    runGit(harness.root, ['clone', harness.primary, legacyClone])

    const baseline = runScript(harness, 'worktree-storage-guard')
    expect(baseline.status, baseline.stderr).toBe(0)
    expect(baseline.stdout).toContain('unmanaged_temp=1')

    rmSync(legacyClone, { force: true, recursive: true })
    const ratcheted = runScript(harness, 'worktree-storage-guard')
    expect(ratcheted.status, ratcheted.stderr).toBe(0)
    expect(ratcheted.stdout).toContain('unmanaged_temp=0')

    runGit(harness.root, ['clone', harness.primary, legacyClone])
    const growth = runScript(harness, 'worktree-storage-guard')
    expect(growth.status).toBe(1)
    expect(growth.stderr).toContain('new unmanaged temporary checkout')
  })

  it('fails closed when unmanaged-checkout fingerprinting fails', () => {
    const harness = createHarness()
    runGit(harness.primary, [
      'remote',
      'add',
      'origin',
      'https://example.test/example/murph.git',
    ])
    runGit(harness.root, [
      'clone',
      harness.primary,
      path.join(harness.tempRoot, 'murph-hash-failure'),
    ])
    executable(path.join(harness.fakeBin, 'node'), '#!/bin/sh\nexit 23\n')

    const result = runScript(harness, 'worktree-storage-guard')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('could not fingerprint unmanaged temporary checkouts')
    expect(existsSync(path.join(harness.state, 'unmanaged-temp-checkouts'))).toBe(false)
  })

  it('rejects standalone temporary pnpm stores', () => {
    const harness = createHarness()
    mkdirSync(path.join(harness.tempRoot, 'murph-task-pnpm-store'))

    const result = runScript(harness, 'worktree-storage-guard')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('standalone temporary pnpm store')
  })

  it('does not classify a registered temporary worktree as unmanaged', () => {
    const harness = createHarness()
    runGit(harness.primary, [
      'remote',
      'add',
      'origin',
      'https://example.test/example/murph.git',
    ])
    const target = path.join(harness.tempRoot, 'murph-pnpm-store-hardening')
    const creation = runScript(harness, 'create-worktree', [
      '-b',
      'registered-temp-task',
      target,
    ])
    expect(creation.status, creation.stderr).toBe(0)

    const guard = runScript(harness, 'worktree-storage-guard')
    expect(guard.status, guard.stderr).toBe(0)
    expect(guard.stdout).toContain('unmanaged_temp=0')
  })

  it('uses a fixed free-space floor regardless of disk percentage', () => {
    const harness = createHarness()
    executable(
      path.join(harness.fakeBin, 'df'),
      `#!/usr/bin/env bash
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n'
printf '%s\\n' 'testfs 200000000 1 30000000 85% /'
`,
    )
    const result = runScript(harness, 'worktree-storage-guard', [], {
      MURPH_WORKTREE_MIN_FREE_GIB: '20',
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('free=28GiB')
  })

  it('fails closed when the fixed free-space floor is missed', () => {
    const harness = createHarness()
    executable(
      path.join(harness.fakeBin, 'df'),
      `#!/usr/bin/env bash
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n'
printf '%s\\n' 'testfs 50000000 1 10000000 80% /'
`,
    )
    const result = runScript(harness, 'worktree-storage-guard', [], {
      MURPH_WORKTREE_MIN_FREE_GIB: '20',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('only 9 GiB free; require at least 20 GiB free')
  })

  it('initializes authorization even when the first disk-floor check fails', () => {
    const harness = createHarness()
    executable(
      path.join(harness.fakeBin, 'df'),
      `#!/usr/bin/env bash
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n'
printf '%s\\n' 'testfs 200000000 1 10000000 95% /'
`,
    )
    const first = runScript(harness, 'worktree-storage-guard', [], {
      MURPH_WORKTREE_MIN_FREE_GIB: '20',
      MURPH_WORKTREE_MAX_LIVE: '3',
    })
    expect(first.status).toBe(1)
    expect(first.stderr).toContain('only 9 GiB free')

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
    printf '%s\\n' 'external volume 200000000 1 10000000 95% /Volumes/External SSD'
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
        MURPH_WORKTREE_MAX_LIVE: '3',
      },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('only 9 GiB free')
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

  it('isolates a raw sibling while sanctioned creation and commits continue', () => {
    const harness = createHarness()
    expect(
      runScript(harness, 'worktree-storage-guard', [], {
        MURPH_WORKTREE_MAX_LIVE: '4',
      }).status,
    ).toBe(0)

    const raw = path.join(harness.root, 'raw-sibling')
    runGit(harness.primary, ['worktree', 'add', '-b', 'raw-sibling', raw])
    const globalAudit = runScript(harness, 'worktree-storage-guard', [], {
      MURPH_WORKTREE_MAX_LIVE: '4',
    })
    expect(globalAudit.status).toBe(1)
    expect(globalAudit.stderr).toContain('bypassed scripts/create-worktree')

    const sanctioned = path.join(harness.root, 'sanctioned-sibling')
    const creation = runScript(
      harness,
      'create-worktree',
      ['-b', 'sanctioned-sibling', sanctioned],
      { MURPH_WORKTREE_MAX_LIVE: '4' },
    )
    expect(creation.status, creation.stderr).toBe(0)

    const install = spawnSync('bash', ['scripts/install-git-hooks'], {
      cwd: sanctioned,
      encoding: 'utf8',
      env: guardEnvironment(harness, { MURPH_WORKTREE_MAX_LIVE: '4' }),
    })
    expect(install.status, install.stderr).toBe(0)

    writeFileSync(path.join(sanctioned, 'tracked.txt'), 'sanctioned change\n')
    runGit(sanctioned, ['add', 'tracked.txt'])
    const sanctionedCommit = spawnSync('git', ['commit', '-m', 'sanctioned commit'], {
      cwd: sanctioned,
      encoding: 'utf8',
      env: guardEnvironment(harness, { MURPH_WORKTREE_MAX_LIVE: '4' }),
    })
    expect(sanctionedCommit.status, sanctionedCommit.stderr).toBe(0)

    writeFileSync(path.join(raw, 'tracked.txt'), 'raw change\n')
    runGit(raw, ['add', 'tracked.txt'])
    const rawCommit = spawnSync('git', ['commit', '-m', 'raw commit'], {
      cwd: raw,
      encoding: 'utf8',
      env: guardEnvironment(harness, { MURPH_WORKTREE_MAX_LIVE: '4' }),
    })
    expect(rawCommit.status).toBe(1)
    expect(rawCommit.stderr).toContain('current worktree bypassed scripts/create-worktree')
  })

  it('retires raw authorization published by the rejected isolation guard before downgrade', () => {
    const harness = createHarness()
    expect(
      runScript(harness, 'install-git-hooks', [], { MURPH_WORKTREE_MAX_LIVE: '4' })
        .status,
    ).toBe(0)

    const sanctioned = path.join(harness.root, 'sanctioned-before-retirement')
    expect(
      runScript(
        harness,
        'create-worktree',
        ['-b', 'sanctioned-before-retirement', sanctioned],
        { MURPH_WORKTREE_MAX_LIVE: '4' },
      ).status,
    ).toBe(0)

    const raw = path.join(harness.root, 'raw-with-published-authority')
    runGit(harness.primary, [
      'worktree',
      'add',
      '-b',
      'raw-with-published-authority',
      raw,
    ])
    const rawAdminDir = runGit(raw, ['rev-parse', '--path-format=absolute', '--git-dir'])
    const authorizationMarker = path.join(
      rawAdminDir,
      'murph-storage-guard-authorized',
    )
    const isolationMarker = path.join(rawAdminDir, 'murph-storage-guard-isolated')
    writeFileSync(authorizationMarker, '')
    writeFileSync(isolationMarker, '')

    const environment = guardEnvironment(harness, { MURPH_WORKTREE_MAX_LIVE: '4' })
    const taskScoped = spawnSync(
      'bash',
      ['scripts/worktree-storage-guard', '--current-worktree', sanctioned],
      { cwd: sanctioned, encoding: 'utf8', env: environment },
    )
    expect(taskScoped.status, taskScoped.stderr).toBe(0)
    expect(existsSync(authorizationMarker)).toBe(true)
    expect(existsSync(isolationMarker)).toBe(true)

    const rawScoped = spawnSync(
      'bash',
      ['scripts/worktree-storage-guard', '--current-worktree', raw],
      { cwd: sanctioned, encoding: 'utf8', env: environment },
    )
    expect(rawScoped.status).toBe(1)
    expect(rawScoped.stderr).toContain('current worktree bypassed scripts/create-worktree')
    expect(existsSync(authorizationMarker)).toBe(true)
    expect(existsSync(isolationMarker)).toBe(true)

    const currentAudit = runScript(harness, 'worktree-storage-guard', [], {
      MURPH_WORKTREE_MAX_LIVE: '4',
    })
    expect(currentAudit.status).toBe(1)
    expect(currentAudit.stderr).toContain('bypassed scripts/create-worktree')
    expect(existsSync(authorizationMarker)).toBe(false)
    expect(existsSync(isolationMarker)).toBe(false)

    writeFileSync(path.join(raw, 'tracked.txt'), 'raw after retirement\n')
    runGit(raw, ['add', 'tracked.txt'])
    const currentRawCommit = spawnSync('git', ['commit', '-m', 'raw after retirement'], {
      cwd: raw,
      encoding: 'utf8',
      env: environment,
    })
    expect(currentRawCommit.status).toBe(1)
    expect(currentRawCommit.stderr).toContain(
      'current worktree bypassed scripts/create-worktree',
    )

    installLegacyWorktreeEntrypoints(harness.primary)
    const downgradedAudit = runScript(harness, 'worktree-storage-guard', [], {
      MURPH_WORKTREE_MAX_LIVE: '4',
    })
    expect(downgradedAudit.status).toBe(1)
    expect(downgradedAudit.stderr).toContain('bypassed scripts/create-worktree')

    const downgradedRawCommit = spawnSync(
      'git',
      ['commit', '-m', 'raw after retirement downgrade'],
      { cwd: raw, encoding: 'utf8', env: environment },
    )
    expect(downgradedRawCommit.status).toBe(1)
    expect(downgradedRawCommit.stderr).toContain('bypassed scripts/create-worktree')
  })

  it('retires published authorization without following malformed isolation nodes', () => {
    for (const markerKind of ['directory', 'fifo', 'dangling-symlink'] as const) {
      const harness = createHarness()
      expect(
        runScript(harness, 'install-git-hooks', [], { MURPH_WORKTREE_MAX_LIVE: '4' })
          .status,
      ).toBe(0)
      const sanctioned = path.join(harness.root, `sanctioned-${markerKind}`)
      expect(
        runScript(
          harness,
          'create-worktree',
          ['-b', `sanctioned-${markerKind}`, sanctioned],
          { MURPH_WORKTREE_MAX_LIVE: '4' },
        ).status,
      ).toBe(0)

      const raw = path.join(harness.root, `raw-${markerKind}`)
      runGit(harness.primary, ['worktree', 'add', '-b', `raw-${markerKind}`, raw])
      const rawAdminDir = runGit(raw, ['rev-parse', '--path-format=absolute', '--git-dir'])
      const authorizationMarker = path.join(
        rawAdminDir,
        'murph-storage-guard-authorized',
      )
      const isolationMarker = path.join(rawAdminDir, 'murph-storage-guard-isolated')
      writeFileSync(authorizationMarker, '')
      if (markerKind === 'directory') {
        mkdirSync(isolationMarker)
      } else if (markerKind === 'fifo') {
        const fifo = spawnSync('mkfifo', [isolationMarker], { encoding: 'utf8' })
        expect(fifo.status, fifo.stderr).toBe(0)
      } else {
        symlinkSync('missing-isolation-target', isolationMarker)
      }

      const environment = guardEnvironment(harness, { MURPH_WORKTREE_MAX_LIVE: '4' })
      const taskScoped = spawnSync(
        'bash',
        ['scripts/worktree-storage-guard', '--current-worktree', sanctioned],
        { cwd: sanctioned, encoding: 'utf8', env: environment },
      )
      expect(taskScoped.status, taskScoped.stderr).toBe(0)
      expect(existsSync(authorizationMarker)).toBe(true)
      expect(lstatSync(isolationMarker).isSymbolicLink()).toBe(
        markerKind === 'dangling-symlink',
      )

      const primaryAudit = runScript(harness, 'worktree-storage-guard', [], {
        MURPH_WORKTREE_MAX_LIVE: '4',
      })
      expect(primaryAudit.status).toBe(1)
      expect(primaryAudit.stderr).toContain('bypassed scripts/create-worktree')
      expect(existsSync(authorizationMarker)).toBe(false)
      expect(lstatSync(isolationMarker).isSymbolicLink()).toBe(
        markerKind === 'dangling-symlink',
      )

      installLegacyWorktreeEntrypoints(harness.primary)
      const downgradedAudit = runScript(harness, 'worktree-storage-guard', [], {
        MURPH_WORKTREE_MAX_LIVE: '4',
      })
      expect(downgradedAudit.status).toBe(1)
      expect(downgradedAudit.stderr).toContain('bypassed scripts/create-worktree')
    }
  })

  it('keeps historical authorized entrypoints usable after the primary checkout upgrades', () => {
    const harness = createHarness()
    installLegacyWorktreeEntrypoints(harness.primary)
    runGit(harness.primary, ['add', '.githooks/pre-commit', 'scripts'])
    runGit(harness.primary, ['commit', '-m', 'legacy worktree entrypoints'])

    const historical = path.join(harness.root, 'historical-sibling')
    const historicalCreation = runScript(
      harness,
      'create-worktree',
      ['-b', 'historical-sibling', historical],
      { MURPH_WORKTREE_MAX_LIVE: '4' },
    )
    expect(historicalCreation.status, historicalCreation.stderr).toBe(0)

    for (const name of ['worktree-storage-guard', 'create-worktree', 'install-git-hooks']) {
      executable(
        path.join(harness.primary, 'scripts', name),
        readFileSync(path.join(sourceRoot, 'scripts', name), 'utf8'),
      )
    }
    executable(
      path.join(harness.primary, '.githooks', 'pre-commit'),
      readFileSync(path.join(sourceRoot, '.githooks', 'pre-commit'), 'utf8'),
    )
    runGit(harness.primary, ['add', '.githooks/pre-commit', 'scripts'])
    runGit(harness.primary, ['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'primary upgrade'])

    const installPrimary = runScript(harness, 'install-git-hooks', [], {
      MURPH_WORKTREE_MAX_LIVE: '4',
    })
    expect(installPrimary.status, installPrimary.stderr).toBe(0)

    const raw = path.join(harness.root, 'raw-sibling-after-upgrade')
    runGit(harness.primary, ['worktree', 'add', '-b', 'raw-sibling-after-upgrade', raw])
    const primaryAudit = runScript(harness, 'worktree-storage-guard', [], {
      MURPH_WORKTREE_MAX_LIVE: '4',
    })
    expect(primaryAudit.status).toBe(1)
    expect(primaryAudit.stderr).toContain('bypassed scripts/create-worktree')

    const historicalEnvironment = guardEnvironment(harness, {
      MURPH_TEST_COMMITTER_BIN: path.join(harness.fakeBin, 'cobuild-committer'),
      MURPH_WORKTREE_MAX_LIVE: '4',
    })
    const historicalInstall = spawnSync('bash', ['scripts/install-git-hooks'], {
      cwd: historical,
      encoding: 'utf8',
      env: historicalEnvironment,
    })
    expect(historicalInstall.status, historicalInstall.stderr).toBe(0)

    writeFileSync(path.join(historical, 'tracked.txt'), 'historical commit\n')
    runGit(historical, ['add', 'tracked.txt'])
    const historicalCommit = spawnSync('bash', ['scripts/committer', '-m', 'historical commit'], {
      cwd: historical,
      encoding: 'utf8',
      env: historicalEnvironment,
    })
    expect(historicalCommit.status, historicalCommit.stderr).toBe(0)

    const successor = path.join(harness.root, 'historical-successor')
    const successorCreation = spawnSync(
      'bash',
      ['scripts/create-worktree', '-b', 'historical-successor', successor],
      { cwd: historical, encoding: 'utf8', env: historicalEnvironment },
    )
    expect(successorCreation.status).toBe(1)
    expect(successorCreation.stderr).toContain('bypassed scripts/create-worktree')

    runGit(harness.primary, ['worktree', 'remove', raw])
    const successorCreationWithoutRaw = spawnSync(
      'bash',
      ['scripts/create-worktree', '-b', 'historical-successor', successor],
      { cwd: historical, encoding: 'utf8', env: historicalEnvironment },
    )
    expect(successorCreationWithoutRaw.status, successorCreationWithoutRaw.stderr).toBe(0)

    const successorCheck = spawnSync(
      'bash',
      [
        path.join(harness.primary, 'scripts', 'worktree-storage-guard'),
        '--current-worktree',
        successor,
      ],
      { cwd: successor, encoding: 'utf8', env: historicalEnvironment },
    )
    expect(successorCheck.status, successorCheck.stderr).toBe(0)

    const secondRaw = path.join(harness.root, 'second-raw-sibling')
    runGit(harness.primary, ['worktree', 'add', '-b', 'second-raw-sibling', secondRaw])
    writeFileSync(path.join(secondRaw, 'tracked.txt'), 'raw commit\n')
    runGit(secondRaw, ['add', 'tracked.txt'])
    const rawCommit = spawnSync('git', ['commit', '-m', 'raw commit'], {
      cwd: secondRaw,
      encoding: 'utf8',
      env: historicalEnvironment,
    })
    expect(rawCommit.status).toBe(1)
    expect(rawCommit.stderr).toContain('current worktree bypassed scripts/create-worktree')

    const finalPrimaryAudit = runScript(harness, 'worktree-storage-guard', [], {
      MURPH_WORKTREE_MAX_LIVE: '4',
    })
    expect(finalPrimaryAudit.status).toBe(1)
    expect(finalPrimaryAudit.stderr).toContain('bypassed scripts/create-worktree')
  })

  it('keeps head entrypoints compatible while the primary checkout still has the base guard', () => {
    const harness = createHarness()
    const headRevision = runGit(harness.primary, ['rev-parse', 'HEAD'])
    installLegacyWorktreeEntrypoints(harness.primary)
    runGit(harness.primary, ['add', '.githooks/pre-commit', 'scripts'])
    runGit(harness.primary, ['commit', '-m', 'base primary entrypoints'])
    const baseRevision = runGit(harness.primary, ['rev-parse', 'HEAD'])

    const headSibling = path.join(harness.root, 'head-sibling')
    const headCreation = runScript(
      harness,
      'create-worktree',
      ['-b', 'head-sibling', headSibling, headRevision],
      { MURPH_WORKTREE_MAX_LIVE: '7' },
    )
    expect(headCreation.status, headCreation.stderr).toBe(0)

    const baseSibling = path.join(harness.root, 'base-sibling')
    const baseCreation = runScript(
      harness,
      'create-worktree',
      ['-b', 'base-sibling', baseSibling, baseRevision],
      { MURPH_WORKTREE_MAX_LIVE: '7' },
    )
    expect(baseCreation.status, baseCreation.stderr).toBe(0)

    const headEnvironment = guardEnvironment(harness, {
      MURPH_TEST_COMMITTER_BIN: path.join(harness.fakeBin, 'cobuild-committer'),
      MURPH_WORKTREE_MAX_LIVE: '7',
    })
    const headInstall = spawnSync('bash', ['scripts/install-git-hooks'], {
      cwd: headSibling,
      encoding: 'utf8',
      env: headEnvironment,
    })
    expect(headInstall.status, headInstall.stderr).toBe(0)

    writeFileSync(path.join(headSibling, 'tracked.txt'), 'head committer\n')
    runGit(headSibling, ['add', 'tracked.txt'])
    const headCommit = spawnSync('bash', ['scripts/committer', '-m', 'head committer'], {
      cwd: headSibling,
      encoding: 'utf8',
      env: headEnvironment,
    })
    expect(headCommit.status, headCommit.stderr).toBe(0)

    const successor = path.join(harness.root, 'head-successor')
    const successorCreation = spawnSync(
      'bash',
      ['scripts/create-worktree', '-b', 'head-successor', successor],
      { cwd: headSibling, encoding: 'utf8', env: headEnvironment },
    )
    expect(successorCreation.status, successorCreation.stderr).toBe(0)

    executable(
      path.join(harness.primary, '.githooks', 'pre-commit'),
      readFileSync(path.join(sourceRoot, '.githooks', 'pre-commit'), 'utf8'),
    )
    writeFileSync(path.join(headSibling, 'tracked.txt'), 'new hook old guard\n')
    runGit(headSibling, ['add', 'tracked.txt'])
    const newHookOldGuard = spawnSync('git', ['commit', '-m', 'new hook old guard'], {
      cwd: headSibling,
      encoding: 'utf8',
      env: headEnvironment,
    })
    expect(newHookOldGuard.status, newHookOldGuard.stderr).toBe(0)

    installLegacyWorktreeEntrypoints(harness.primary)
    executable(
      path.join(harness.primary, 'scripts', 'worktree-storage-guard'),
      readFileSync(path.join(sourceRoot, 'scripts', 'worktree-storage-guard'), 'utf8'),
    )
    writeFileSync(path.join(headSibling, 'tracked.txt'), 'old hook new guard\n')
    runGit(headSibling, ['add', 'tracked.txt'])
    const oldHookNewGuard = spawnSync('git', ['commit', '-m', 'old hook new guard'], {
      cwd: headSibling,
      encoding: 'utf8',
      env: headEnvironment,
    })
    expect(oldHookNewGuard.status, oldHookNewGuard.stderr).toBe(0)

    installLegacyWorktreeEntrypoints(harness.primary)
    const raw = path.join(harness.root, 'base-primary-raw')
    runGit(harness.primary, ['worktree', 'add', '-b', 'base-primary-raw', raw])
    const blockedInstall = spawnSync('bash', ['scripts/install-git-hooks'], {
      cwd: headSibling,
      encoding: 'utf8',
      env: headEnvironment,
    })
    expect(blockedInstall.status).toBe(1)
    expect(blockedInstall.stderr).toContain('bypassed scripts/create-worktree')

    const rawAdminDir = runGit(raw, ['rev-parse', '--path-format=absolute', '--git-dir'])
    const rawAuthorizationMarker = path.join(
      rawAdminDir,
      'murph-storage-guard-authorized',
    )
    expect(existsSync(rawAuthorizationMarker)).toBe(false)

    const blockedHeadHook = spawnSync(
      'bash',
      [path.join(harness.primary, '.githooks', 'pre-commit')],
      { cwd: headSibling, encoding: 'utf8', env: headEnvironment },
    )
    expect(blockedHeadHook.status).toBe(1)
    expect(blockedHeadHook.stderr).toContain('bypassed scripts/create-worktree')
    const taskLocalScoped = spawnSync(
      'bash',
      [path.join('scripts', 'worktree-storage-guard'), '--current-worktree', headSibling],
      { cwd: headSibling, encoding: 'utf8', env: headEnvironment },
    )
    expect(taskLocalScoped.status, taskLocalScoped.stderr).toBe(0)
    expect(existsSync(rawAuthorizationMarker)).toBe(false)

    const baseAuditAfterTaskScan = runScript(harness, 'worktree-storage-guard', [], {
      MURPH_WORKTREE_MAX_LIVE: '7',
    })
    expect(baseAuditAfterTaskScan.status).toBe(1)
    expect(baseAuditAfterTaskScan.stderr).toContain('bypassed scripts/create-worktree')

    writeFileSync(path.join(raw, 'tracked.txt'), 'raw commit\n')
    runGit(raw, ['add', 'tracked.txt'])
    const rawCommit = spawnSync('git', ['commit', '-m', 'raw commit'], {
      cwd: raw,
      encoding: 'utf8',
      env: headEnvironment,
    })
    expect(rawCommit.status).toBe(1)
    expect(rawCommit.stderr).toContain('bypassed scripts/create-worktree')

    for (const name of ['worktree-storage-guard', 'create-worktree', 'install-git-hooks']) {
      executable(
        path.join(harness.primary, 'scripts', name),
        readFileSync(path.join(sourceRoot, 'scripts', name), 'utf8'),
      )
    }
    executable(
      path.join(harness.primary, '.githooks', 'pre-commit'),
      readFileSync(path.join(sourceRoot, '.githooks', 'pre-commit'), 'utf8'),
    )

    const baseEnvironment = guardEnvironment(harness, {
      MURPH_TEST_COMMITTER_BIN: path.join(harness.fakeBin, 'cobuild-committer'),
      MURPH_WORKTREE_MAX_LIVE: '7',
    })
    const baseInstallAfterPrimaryUpgrade = spawnSync('bash', ['scripts/install-git-hooks'], {
      cwd: baseSibling,
      encoding: 'utf8',
      env: baseEnvironment,
    })
    expect(baseInstallAfterPrimaryUpgrade.status, baseInstallAfterPrimaryUpgrade.stderr).toBe(0)
    expect(existsSync(rawAuthorizationMarker)).toBe(false)

    writeFileSync(path.join(baseSibling, 'tracked.txt'), 'historical after primary upgrade\n')
    runGit(baseSibling, ['add', 'tracked.txt'])
    const baseCommitAfterPrimaryUpgrade = spawnSync(
      'bash',
      ['scripts/committer', '-m', 'historical after primary upgrade'],
      { cwd: baseSibling, encoding: 'utf8', env: baseEnvironment },
    )
    expect(baseCommitAfterPrimaryUpgrade.status, baseCommitAfterPrimaryUpgrade.stderr).toBe(0)

    const baseSuccessor = path.join(harness.root, 'base-successor')
    const baseSuccessorCreation = spawnSync(
      'bash',
      ['scripts/create-worktree', '-b', 'base-successor', baseSuccessor],
      { cwd: baseSibling, encoding: 'utf8', env: baseEnvironment },
    )
    expect(baseSuccessorCreation.status).toBe(1)
    expect(baseSuccessorCreation.stderr).toContain('bypassed scripts/create-worktree')

    const currentSuccessor = path.join(harness.root, 'current-successor')
    const currentSuccessorCreation = spawnSync(
      'bash',
      ['scripts/create-worktree', '-b', 'current-successor', currentSuccessor],
      { cwd: headSibling, encoding: 'utf8', env: headEnvironment },
    )
    expect(currentSuccessorCreation.status, currentSuccessorCreation.stderr).toBe(0)
    expect(existsSync(rawAuthorizationMarker)).toBe(false)

    const primaryAuditAfterUpgrade = runScript(harness, 'worktree-storage-guard', [], {
      MURPH_WORKTREE_MAX_LIVE: '7',
    })
    expect(primaryAuditAfterUpgrade.status).toBe(1)
    expect(primaryAuditAfterUpgrade.stderr).toContain('bypassed scripts/create-worktree')

    const rawCommitAfterUpgrade = spawnSync('git', ['commit', '-m', 'raw after upgrade'], {
      cwd: raw,
      encoding: 'utf8',
      env: baseEnvironment,
    })
    expect(rawCommitAfterUpgrade.status).toBe(1)
    expect(rawCommitAfterUpgrade.stderr).toContain(
      'current worktree bypassed scripts/create-worktree',
    )

    installLegacyWorktreeEntrypoints(harness.primary)
    const downgradedAudit = runScript(harness, 'worktree-storage-guard', [], {
      MURPH_WORKTREE_MAX_LIVE: '7',
    })
    expect(downgradedAudit.status).toBe(1)
    expect(downgradedAudit.stderr).toContain('bypassed scripts/create-worktree')
    expect(existsSync(rawAuthorizationMarker)).toBe(false)

    const rawCommitAfterDowngrade = spawnSync(
      'git',
      ['commit', '-m', 'raw after downgrade'],
      { cwd: raw, encoding: 'utf8', env: baseEnvironment },
    )
    expect(rawCommitAfterDowngrade.status).toBe(1)
    expect(rawCommitAfterDowngrade.stderr).toContain(
      'bypassed scripts/create-worktree',
    )
  })

  it('keeps raw siblings inside scoped count, reservation, and disk budgets', () => {
    const reservationHarness = createHarness()
    expect(
      runScript(reservationHarness, 'worktree-storage-guard', [], {
        MURPH_WORKTREE_MAX_LIVE: '2',
      }).status,
    ).toBe(0)
    const sanctioned = path.join(reservationHarness.root, 'sanctioned')
    expect(
      runScript(
        reservationHarness,
        'create-worktree',
        ['-b', 'reservation-sanctioned', sanctioned],
        { MURPH_WORKTREE_MAX_LIVE: '2' },
      ).status,
    ).toBe(0)
    runGit(reservationHarness.primary, [
      'worktree',
      'add',
      '-b',
      'reservation-raw',
      path.join(reservationHarness.root, 'raw'),
    ])
    const reservation = runScript(
      reservationHarness,
      'worktree-storage-guard',
      [
        '--current-worktree',
        reservationHarness.primary,
        '--reserve-worktree',
        '--target-path',
        path.join(reservationHarness.root, 'next'),
      ],
      { MURPH_WORKTREE_MAX_LIVE: '2' },
    )
    expect(reservation.status).toBe(1)
    expect(reservation.stderr).toContain('new worktree would exceed the ratcheted ceiling of 2')

    const ceilingHarness = createHarness()
    expect(
      runScript(ceilingHarness, 'worktree-storage-guard', [], {
        MURPH_WORKTREE_MAX_LIVE: '1',
      }).status,
    ).toBe(0)
    const ceilingSanctioned = path.join(ceilingHarness.root, 'sanctioned')
    expect(
      runScript(
        ceilingHarness,
        'create-worktree',
        ['-b', 'ceiling-sanctioned', ceilingSanctioned],
        { MURPH_WORKTREE_MAX_LIVE: '1' },
      ).status,
    ).toBe(0)
    runGit(ceilingHarness.primary, [
      'worktree',
      'add',
      '-b',
      'ceiling-raw',
      path.join(ceilingHarness.root, 'raw'),
    ])
    const ceiling = runScript(
      ceilingHarness,
      'worktree-storage-guard',
      ['--current-worktree', ceilingSanctioned],
      { MURPH_WORKTREE_MAX_LIVE: '1' },
    )
    expect(ceiling.status).toBe(1)
    expect(ceiling.stderr).toContain('exceeds the ratcheted ceiling of 1')

    const diskHarness = createHarness()
    expect(
      runScript(diskHarness, 'worktree-storage-guard', [], {
        MURPH_WORKTREE_MAX_LIVE: '2',
      }).status,
    ).toBe(0)
    const diskRaw = path.join(diskHarness.root, 'raw')
    runGit(diskHarness.primary, [
      'worktree',
      'add',
      '-b',
      'disk-raw',
      diskRaw,
    ])
    const diskRawCanonical = realpathSync(diskRaw)
    executable(
      path.join(diskHarness.fakeBin, 'df'),
      `#!/usr/bin/env bash
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n'
for candidate in "$@"; do
  [[ "$candidate" == -* ]] && continue
  if [[ "$candidate" == "\${MURPH_TEST_LOW_DISK_PATH:?}" ]]; then
    printf '%s\\n' 'rawfs 50000000 1 10000000 80% /raw'
  else
    printf '%s\\n' 'healthyfs 100000000 1 90000000 10% /healthy'
  fi
done
`,
    )
    const scopedDisk = runScript(
      diskHarness,
      'worktree-storage-guard',
      ['--current-worktree', diskHarness.primary],
      {
        MURPH_TEST_LOW_DISK_PATH: diskRawCanonical,
        MURPH_WORKTREE_MAX_LIVE: '2',
        MURPH_WORKTREE_MIN_FREE_GIB: '20',
      },
    )
    expect(scopedDisk.status).toBe(1)
    expect(scopedDisk.stderr).toContain('only 9 GiB free')
    const creatingDisk = runScript(
      diskHarness,
      'worktree-storage-guard',
      [
        '--current-worktree',
        diskHarness.primary,
        '--target-path',
        path.join(diskHarness.root, 'next'),
      ],
      {
        MURPH_TEST_LOW_DISK_PATH: diskRawCanonical,
        MURPH_WORKTREE_MAX_LIVE: '2',
        MURPH_WORKTREE_MIN_FREE_GIB: '20',
      },
    )
    expect(creatingDisk.status).toBe(1)
    expect(creatingDisk.stderr).toContain('only 9 GiB free')
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
    expect(existsSync(path.join(target, '.metadata_never_index'))).toBe(true)
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
printf '%s\\n' 'testfs 200000000 1 10000000 95% /'
`,
    )
    const lowDisk = runScript(harness, 'worktree-storage-guard', [], {
      MURPH_WORKTREE_MIN_FREE_GIB: '20',
    })
    expect(lowDisk.status).toBe(1)
    expect(lowDisk.stderr).toContain('only 9 GiB free')
  })
})
