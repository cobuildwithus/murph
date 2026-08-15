import { spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { worktreeCreationIntentPath } from './frog-autofix-recovery.ts'

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
    `#!/usr/bin/env bash
set -euo pipefail
commit_message="\${1:?}"
shift
exec git commit -m "$commit_message" -- "$@"
`,
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

async function interruptScriptAfterPath(
  harness: Harness,
  args: string[],
  readyPath: string,
  signal: NodeJS.Signals = 'SIGINT',
): Promise<{
  signal: NodeJS.Signals | null
  status: number | null
  stderr: string
}> {
  const child = spawn('bash', [path.join('scripts', 'create-worktree'), ...args], {
    cwd: harness.primary,
    detached: true,
    env: guardEnvironment(harness),
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })
  const completed = new Promise<{
    signal: NodeJS.Signals | null
    status: number | null
    stderr: string
  }>(
    (resolve, reject) => {
      child.once('error', reject)
      child.once('close', (status, signal) => resolve({ signal, status, stderr }))
    },
  )

  try {
    const deadline = Date.now() + 10_000
    while (!existsSync(readyPath)) {
      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for ${path.basename(readyPath)}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    if (child.pid === undefined) throw new Error('create-worktree did not start')
    process.kill(-child.pid, signal)
    return await completed
  } catch (error) {
    if (child.exitCode === null && child.pid !== undefined) {
      process.kill(-child.pid, 'SIGTERM')
      await completed
    }
    throw error
  }
}

async function runWithHeldOpenInput(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<{
  signal: NodeJS.Signals | null
  status: number | null
  stderr: string
  timedOut: boolean
}> {
  const child = spawn(command, args, {
    cwd,
    detached: true,
    env,
    stdio: ['pipe', 'ignore', 'pipe'],
  })
  let stderr = ''
  let timedOut = false
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })

  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      timedOut = true
      if (child.pid !== undefined) process.kill(-child.pid, 'SIGTERM')
    }, 5_000)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', (status, signal) => {
      clearTimeout(timeout)
      resolve({ signal, status, stderr, timedOut })
    })
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

  it('rejects an active non-fast-forward merge through the installed committer wrapper', () => {
    const harness = createHarness()
    const installedCommitter = path.join(
      sourceRoot,
      'node_modules',
      '.bin',
      'cobuild-committer',
    )
    expect(existsSync(installedCommitter)).toBe(true)
    runGit(harness.primary, ['checkout', '-b', 'merge-side'])
    writeFileSync(path.join(harness.primary, 'tracked.txt'), 'side\n')
    runGit(harness.primary, ['add', 'tracked.txt'])
    runGit(harness.primary, [
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '-m',
      'side change',
    ])
    runGit(harness.primary, ['checkout', 'main'])
    writeFileSync(path.join(harness.primary, 'tracked.txt'), 'main\n')
    runGit(harness.primary, ['add', 'tracked.txt'])
    runGit(harness.primary, [
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '-m',
      'main change',
    ])
    const merge = spawnSync(
      'git',
      ['-c', 'core.hooksPath=/dev/null', 'merge', '--no-ff', '--no-commit', 'merge-side'],
      { cwd: harness.primary, encoding: 'utf8' },
    )
    expect(merge.status).toBe(1)
    writeFileSync(path.join(harness.primary, 'tracked.txt'), 'resolved\n')
    runGit(harness.primary, ['add', 'tracked.txt'])
    expect(runGit(harness.primary, ['diff', '--name-only', '--diff-filter=U']))
      .toBe('')

    const before = {
      commitCount: runGit(harness.primary, ['rev-list', '--count', 'HEAD']),
      head: runGit(harness.primary, ['rev-parse', 'HEAD']),
      index: runGit(harness.primary, ['ls-files', '--stage']),
      mergeHead: runGit(harness.primary, ['rev-parse', 'MERGE_HEAD']),
      resolved: readFileSync(path.join(harness.primary, 'tracked.txt'), 'utf8'),
      status: runGit(harness.primary, ['status', '--porcelain=v1']),
    }

    const result = runScript(
      harness,
      'committer',
      ['test(repo): reject active merge', 'tracked.txt'],
      {
        MURPH_TEST_COMMITTER_BIN: installedCommitter,
        MURPH_WORKTREE_GUARD_LOCK_HELD: '1',
      },
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'active Git operation is not supported (MERGE_HEAD)',
    )
    expect(runGit(harness.primary, ['rev-parse', 'HEAD'])).toBe(before.head)
    expect(runGit(harness.primary, ['rev-list', '--count', 'HEAD']))
      .toBe(before.commitCount)
    expect(runGit(harness.primary, ['rev-parse', 'MERGE_HEAD']))
      .toBe(before.mergeHead)
    expect(runGit(harness.primary, ['ls-files', '--stage'])).toBe(before.index)
    expect(runGit(harness.primary, ['status', '--porcelain=v1']))
      .toBe(before.status)
    expect(readFileSync(path.join(harness.primary, 'tracked.txt'), 'utf8'))
      .toBe(before.resolved)
  })

  it('clears the creation intent only after sanctioned setup succeeds', () => {
    const harness = createHarness()
    const target = path.join(harness.root, 'intent-success')
    const intent = worktreeCreationIntentPath(harness.state, target)

    const creation = runScript(harness, 'create-worktree', [
      '-b',
      'intent-success',
      target,
    ])

    expect(creation.status, creation.stderr).toBe(0)
    expect(existsSync(intent)).toBe(false)
    expect(runGit(target, ['status', '--porcelain'])).toBe('')
  })

  it('keeps both platform lock command bounds explicit', () => {
    const installer = readFileSync(
      path.join(sourceRoot, 'scripts', 'install-git-hooks'),
      'utf8',
    )
    const guard = readFileSync(
      path.join(sourceRoot, 'scripts', 'worktree-storage-guard'),
      'utf8',
    )
    for (const [command, timeoutFlag] of [
      ['flock', '-w'],
      ['lockf', '-t'],
    ]) {
      expect(installer).toContain(`${command} ${timeoutFlag} "$lock_wait_seconds"`)
      expect(guard).toContain(
        `${command} ${timeoutFlag} "$compatibility_wait_seconds"`,
      )
    }
  })

  it('retains creation intent after checkout setup fails and rejects retry', () => {
    const harness = createHarness()
    const target = path.join(harness.root, 'intent-failure')
    const intent = worktreeCreationIntentPath(harness.state, target)
    executable(
      path.join(harness.primary, '.githooks', 'post-checkout'),
      '#!/bin/sh\nexit 29\n',
    )

    const creation = runScript(harness, 'create-worktree', [
      '-b',
      'intent-failure',
      target,
    ])

    expect(creation.status).toBe(29)
    expect(existsSync(target)).toBe(false)
    expect(existsSync(intent)).toBe(true)
    const retry = runScript(harness, 'create-worktree', [
      '-b',
      'intent-failure',
      target,
    ])
    expect(retry.status).toBe(1)
    expect(retry.stderr).toContain('matching incomplete creation already exists')
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
    runGit(harness.primary, [
      'config',
      'filter.spotlight-marker.smudge',
      'test -f .metadata_never_index && cat',
    ])
    runGit(harness.primary, [
      'config',
      'filter.spotlight-marker.clean',
      'cat',
    ])
    runGit(harness.primary, [
      'config',
      'filter.spotlight-marker.required',
      'true',
    ])
    writeFileSync(
      path.join(harness.primary, '.gitattributes'),
      'spotlight-probe.txt filter=spotlight-marker\n',
    )
    writeFileSync(path.join(harness.primary, 'spotlight-probe.txt'), 'probe\n')
    runGit(harness.primary, ['add', '.gitattributes', 'spotlight-probe.txt'])
    runGit(harness.primary, ['commit', '-m', 'add Spotlight ordering probe'])

    const creation = runScript(harness, 'create-worktree', [
      '-b',
      'spotlight-excluded-task',
      target,
    ])

    expect(creation.status, creation.stderr).toBe(0)
    expect(existsSync(path.join(target, '.metadata_never_index'))).toBe(true)
    const admin = runGit(target, [
      'rev-parse',
      '--path-format=absolute',
      '--git-dir',
    ])
    expect(existsSync(path.join(admin, 'murph-storage-guard-authorized'))).toBe(
      true,
    )
    expect(runGit(target, ['check-ignore', '.metadata_never_index'])).toBe(
      '.metadata_never_index',
    )
    expect(runGit(harness.primary, ['check-ignore', 'custom-local-only'])).toBe(
      'custom-local-only',
    )
    expect(readFileSync(path.join(target, 'spotlight-probe.txt'), 'utf8')).toBe(
      'probe\n',
    )
    expect(
      readFileSync(excludeFile, 'utf8')
        .split('\n')
        .filter((rule) => rule === '/.metadata_never_index'),
    ).toHaveLength(1)
    expect(runGit(target, ['status', '--porcelain'])).toBe('')
  })

  it('removes a Spotlight marker staged by post-index-change without discarding other hook effects', () => {
    const harness = createHarness()
    const target = path.join(harness.root, 'post-index-change-marker')
    const hookInvocations = path.join(
      harness.root,
      'post-index-change-invocations',
    )
    executable(
      path.join(harness.primary, '.githooks', 'post-index-change'),
      `#!/bin/sh
if [ -e ${JSON.stringify(hookInvocations)} ]; then
  exit 0
fi
printf 'invoked\n' >>${JSON.stringify(hookInvocations)}
exclude=$(git rev-parse --path-format=absolute --git-path info/exclude)
printf '!/.metadata_never_index\n' >"$exclude"
printf 'generated\n' >hook-generated.txt
git add -A
`,
    )

    const creation = runScript(harness, 'create-worktree', [
      '-b',
      'post-index-change-marker',
      target,
    ])

    expect(creation.status, creation.stderr).toBe(0)
    expect(readFileSync(hookInvocations, 'utf8')).toBe('invoked\n')
    expect(
      runGit(target, ['ls-files', '--stage', '--', '.metadata_never_index']),
    ).toBe('')
    expect(runGit(target, ['status', '--porcelain'])).toBe(
      'A  hook-generated.txt',
    )
    const excludeFile = runGit(target, [
      'rev-parse',
      '--path-format=absolute',
      '--git-path',
      'info/exclude',
    ])
    expect(readFileSync(excludeFile, 'utf8')).toMatch(
      /(?:^|\n)\/\.metadata_never_index\n$/,
    )
    expect(runGit(target, ['check-ignore', '.metadata_never_index'])).toBe(
      '.metadata_never_index',
    )
    const admin = runGit(target, [
      'rev-parse',
      '--path-format=absolute',
      '--git-dir',
    ])
    expect(existsSync(path.join(admin, 'murph-storage-guard-authorized'))).toBe(
      true,
    )
  })

  it('removes a Spotlight marker staged by post-checkout without discarding other hook effects', () => {
    const harness = createHarness()
    const target = path.join(harness.root, 'post-checkout-marker')
    const hookInvocations = path.join(harness.root, 'marker-hook-invocations')
    executable(
      path.join(harness.primary, '.githooks', 'post-checkout'),
      `#!/bin/sh
printf 'invoked\n' >>${JSON.stringify(hookInvocations)}
exclude=$(git rev-parse --path-format=absolute --git-path info/exclude)
printf '!/.metadata_never_index\n' >"$exclude"
printf 'generated\n' >hook-generated.txt
git add -A
`,
    )

    const creation = runScript(harness, 'create-worktree', [
      '-b',
      'post-checkout-marker',
      target,
    ])

    expect(creation.status, creation.stderr).toBe(0)
    expect(readFileSync(hookInvocations, 'utf8')).toBe('invoked\n')
    expect(
      runGit(target, ['ls-files', '--stage', '--', '.metadata_never_index']),
    ).toBe('')
    expect(runGit(target, ['status', '--porcelain'])).toBe(
      'A  hook-generated.txt',
    )
    expect(runGit(target, ['check-ignore', '.metadata_never_index'])).toBe(
      '.metadata_never_index',
    )
    const admin = runGit(target, [
      'rev-parse',
      '--path-format=absolute',
      '--git-dir',
    ])
    expect(existsSync(path.join(admin, 'murph-storage-guard-authorized'))).toBe(
      true,
    )
  })

  it('restores the checked-out tree entry when the Spotlight marker is tracked', () => {
    const harness = createHarness()
    writeFileSync(
      path.join(harness.primary, '.metadata_never_index'),
      'tracked marker\n',
    )
    runGit(harness.primary, ['add', '.metadata_never_index'])
    runGit(harness.primary, ['commit', '-m', 'track Spotlight marker'])
    executable(
      path.join(harness.primary, '.githooks', 'post-checkout'),
      `#!/bin/sh
exclude=$(git rev-parse --path-format=absolute --git-path info/exclude)
printf '!/.metadata_never_index\n' >"$exclude"
printf 'hook marker\n' >.metadata_never_index
git add .metadata_never_index
`,
    )
    const target = path.join(harness.root, 'tracked-spotlight-marker')

    const creation = runScript(harness, 'create-worktree', [
      '-b',
      'tracked-spotlight-marker',
      target,
    ])

    expect(creation.status, creation.stderr).toBe(0)
    const expectedOid = runGit(harness.primary, [
      'rev-parse',
      'HEAD:.metadata_never_index',
    ])
    expect(
      runGit(target, ['ls-files', '--stage', '--', '.metadata_never_index']),
    ).toContain(expectedOid)
    expect(
      runGit(target, [
        'diff',
        '--cached',
        '--name-only',
        'HEAD',
        '--',
        '.metadata_never_index',
      ]),
    ).toBe('')
    expect(runGit(target, ['status', '--porcelain'])).toBe('')
  })

  it('restores a tracked executable Spotlight marker through hook index changes', () => {
    const harness = createHarness()
    const marker = path.join(harness.primary, '.metadata_never_index')
    writeFileSync(marker, 'executable marker\n')
    chmodSync(marker, 0o755)
    runGit(harness.primary, ['config', 'core.filemode', 'true'])
    runGit(harness.primary, ['add', '.metadata_never_index'])
    runGit(harness.primary, ['commit', '-m', 'track executable marker'])
    executable(
      path.join(harness.primary, '.githooks', 'post-checkout'),
      `#!/bin/sh
printf 'hook marker\n' >.metadata_never_index
chmod 0644 .metadata_never_index
git add .metadata_never_index
`,
    )
    const target = path.join(harness.root, 'tracked-executable-marker')

    const creation = runScript(harness, 'create-worktree', [
      '-b',
      'tracked-executable-marker',
      target,
    ])

    expect(creation.status, creation.stderr).toBe(0)
    expect(
      runGit(target, ['ls-files', '--stage', '--', '.metadata_never_index']),
    ).toMatch(/^100755 /)
    expect(readFileSync(path.join(target, '.metadata_never_index'), 'utf8')).toBe(
      'executable marker\n',
    )
    expect(lstatSync(path.join(target, '.metadata_never_index')).mode & 0o777).toBe(
      0o755,
    )
    expect(runGit(target, ['status', '--porcelain'])).toBe('')
  })

  it('restores a tracked symlink Spotlight marker without touching its target', () => {
    const harness = createHarness()
    symlinkSync(
      'missing-spotlight-target',
      path.join(harness.primary, '.metadata_never_index'),
    )
    runGit(harness.primary, ['add', '.metadata_never_index'])
    runGit(harness.primary, ['commit', '-m', 'track symlink marker'])
    executable(
      path.join(harness.primary, '.githooks', 'post-checkout'),
      `#!/bin/sh
rm .metadata_never_index
printf 'hook marker\n' >.metadata_never_index
git add .metadata_never_index
`,
    )
    const target = path.join(harness.root, 'tracked-symlink-marker')

    const creation = runScript(harness, 'create-worktree', [
      '-b',
      'tracked-symlink-marker',
      target,
    ])

    expect(creation.status, creation.stderr).toBe(0)
    const targetMarker = path.join(target, '.metadata_never_index')
    expect(lstatSync(targetMarker).isSymbolicLink()).toBe(true)
    expect(readlinkSync(targetMarker)).toBe('missing-spotlight-target')
    expect(existsSync(path.join(target, 'missing-spotlight-target'))).toBe(false)
    expect(runGit(target, ['status', '--porcelain'])).toBe('')
  })

  it('matches native checkout-filter worktree context', () => {
    const configureFilter = (harness: Harness, output: string): void => {
      const attributes = runGit(harness.primary, [
        'rev-parse',
        '--path-format=absolute',
        '--git-path',
        'info/attributes',
      ])
      writeFileSync(attributes, 'tracked.txt filter=materialization-contract\n')
      runGit(harness.primary, [
        'config',
        'filter.materialization-contract.smudge',
        `test -n "\${GIT_DIR-}" && test -n "\${GIT_WORK_TREE-}" && printf '%s|%s|%s\\n' "$PWD" "$GIT_DIR" "$GIT_WORK_TREE" >${JSON.stringify(output)} && cat`,
      ])
      runGit(harness.primary, [
        'config',
        'filter.materialization-contract.clean',
        'cat',
      ])
      runGit(harness.primary, [
        'config',
        'filter.materialization-contract.required',
        'true',
      ])
    }
    const normalizeContext = (context: string, target: string): string => {
      const admin = runGit(target, [
        'rev-parse',
        '--path-format=absolute',
        '--git-dir',
      ])
      return context
        .replaceAll(realpathSync(target), '<TARGET>')
        .replaceAll(realpathSync(admin), '<GIT_DIR>')
    }

    const nativeHarness = createHarness()
    const nativeOutput = path.join(nativeHarness.root, 'native-filter-context')
    configureFilter(nativeHarness, nativeOutput)
    const nativeTarget = path.join(nativeHarness.root, 'native-filter-target')
    const nativeCreation = spawnSync(
      'git',
      ['worktree', 'add', '-b', 'native-filter-context', nativeTarget],
      { cwd: nativeHarness.primary, encoding: 'utf8' },
    )

    const helperHarness = createHarness()
    const helperOutput = path.join(helperHarness.root, 'helper-filter-context')
    configureFilter(helperHarness, helperOutput)
    const helperTarget = path.join(helperHarness.root, 'helper-filter-target')
    const helperCreation = runScript(helperHarness, 'create-worktree', [
      '-b',
      'helper-filter-context',
      helperTarget,
    ])

    expect(nativeCreation.status, nativeCreation.stderr).toBe(0)
    expect(helperCreation.status, helperCreation.stderr).toBe(0)
    expect(
      normalizeContext(readFileSync(helperOutput, 'utf8'), helperTarget),
    ).toBe(normalizeContext(readFileSync(nativeOutput, 'utf8'), nativeTarget))
    expect(readFileSync(path.join(helperTarget, 'tracked.txt'), 'utf8')).toBe(
      'baseline\n',
    )
    expect(existsSync(path.join(helperTarget, '.metadata_never_index'))).toBe(true)
  })

  it('matches native non-recursive worktree materialization', () => {
    const addSubmoduleFixture = (harness: Harness): void => {
      const source = path.join(harness.root, 'submodule-source')
      mkdirSync(source)
      runGit(source, ['init', '-b', 'main'])
      runGit(source, ['config', 'user.name', 'Worktree Guard Test'])
      runGit(source, [
        'config',
        'user.email',
        'worktree-guard@users.noreply.github.com',
      ])
      writeFileSync(path.join(source, 'submodule.txt'), 'submodule\n')
      runGit(source, ['add', 'submodule.txt'])
      runGit(source, ['commit', '-m', 'submodule baseline'])
      const addition = spawnSync(
        'git',
        [
          '-c',
          'protocol.file.allow=always',
          'submodule',
          'add',
          source,
          'nested',
        ],
        { cwd: harness.primary, encoding: 'utf8' },
      )
      if (addition.status !== 0) {
        throw new Error(`submodule fixture failed: ${addition.stderr}`)
      }
      runGit(harness.primary, ['commit', '-am', 'add submodule fixture'])
      runGit(harness.primary, ['config', 'submodule.recurse', 'true'])
    }

    const nativeHarness = createHarness()
    addSubmoduleFixture(nativeHarness)
    const nativeTarget = path.join(nativeHarness.root, 'native-submodule-target')
    const nativeCreation = spawnSync(
      'git',
      ['worktree', 'add', '-b', 'native-submodule-context', nativeTarget],
      { cwd: nativeHarness.primary, encoding: 'utf8' },
    )

    const helperHarness = createHarness()
    addSubmoduleFixture(helperHarness)
    const helperTarget = path.join(helperHarness.root, 'helper-submodule-target')
    const helperCreation = runScript(helperHarness, 'create-worktree', [
      '-b',
      'helper-submodule-context',
      helperTarget,
    ])

    expect(nativeCreation.status, nativeCreation.stderr).toBe(0)
    expect(helperCreation.status, helperCreation.stderr).toBe(0)
    expect(existsSync(path.join(nativeTarget, 'nested', 'submodule.txt'))).toBe(
      false,
    )
    expect(existsSync(path.join(helperTarget, 'nested', 'submodule.txt'))).toBe(
      false,
    )
    expect(runGit(helperTarget, ['status', '--porcelain'])).toBe('')
  })

  it('restores shared and checkout Spotlight state after a successful hook', () => {
    const harness = createHarness()
    const sibling = path.join(harness.root, 'cleanup-hook-sibling')
    expect(
      runScript(harness, 'create-worktree', [
        '-b',
        'cleanup-hook-sibling',
        sibling,
      ]).status,
    ).toBe(0)
    const target = path.join(harness.root, 'cleanup-hook-spotlight')
    const markerObserved = path.join(harness.root, 'cleanup-hook-marker-observed')
    const hookInvocations = path.join(harness.root, 'cleanup-hook-invocations')
    runGit(harness.primary, [
      'config',
      'filter.cleanup-hook-marker.smudge',
      `test -f .metadata_never_index && touch ${JSON.stringify(markerObserved)} && cat`,
    ])
    runGit(harness.primary, [
      'config',
      'filter.cleanup-hook-marker.clean',
      'cat',
    ])
    runGit(harness.primary, [
      'config',
      'filter.cleanup-hook-marker.required',
      'true',
    ])
    writeFileSync(
      path.join(harness.primary, '.gitattributes'),
      'cleanup-hook-probe.txt filter=cleanup-hook-marker\n',
    )
    writeFileSync(path.join(harness.primary, 'cleanup-hook-probe.txt'), 'probe\n')
    runGit(harness.primary, ['add', '.gitattributes', 'cleanup-hook-probe.txt'])
    runGit(harness.primary, ['commit', '-m', 'add cleanup hook marker probe'])
    executable(
      path.join(harness.primary, '.githooks', 'post-checkout'),
      `#!/bin/sh
printf '%s|%s|%s\n' "$1" "$2" "$3" >>${JSON.stringify(hookInvocations)}
git clean -fdX
exclude=$(git rev-parse --path-format=absolute --git-path info/exclude)
printf '# hook comment\n/hook-owned-only\n/.metadata_never_index\n!.*\n/.metadata_never_index\n!.*\n' >"$exclude"
`,
    )

    const creation = runScript(harness, 'create-worktree', [
      '-b',
      'cleanup-hook-spotlight',
      target,
    ])

    expect(creation.status, creation.stderr).toBe(0)
    expect(existsSync(markerObserved)).toBe(true)
    expect(readFileSync(hookInvocations, 'utf8').trim().split('\n')).toHaveLength(1)
    expect(readFileSync(hookInvocations, 'utf8')).toMatch(
      new RegExp(`^0{40,64}\\|[0-9a-f]{40,64}\\|1\\n$`),
    )
    const excludeFile = runGit(target, [
      'rev-parse',
      '--path-format=absolute',
      '--git-path',
      'info/exclude',
    ])
    const excludeRules = readFileSync(excludeFile, 'utf8').trim().split('\n')
    expect(excludeRules).toContain('# hook comment')
    expect(excludeRules).toContain('/hook-owned-only')
    expect(excludeRules.at(-1)).toBe('/.metadata_never_index')
    expect(existsSync(path.join(target, '.metadata_never_index'))).toBe(true)
    expect(runGit(target, ['check-ignore', '.metadata_never_index'])).toBe(
      '.metadata_never_index',
    )
    expect(runGit(sibling, ['check-ignore', '.metadata_never_index'])).toBe(
      '.metadata_never_index',
    )
    expect(runGit(target, ['status', '--porcelain'])).toBe('')
    expect(runGit(sibling, ['status', '--porcelain'])).toBe('')
  })

  it('preserves a shared exclude symlink while establishing final precedence', () => {
    const harness = createHarness()
    const commonDir = runGit(harness.primary, [
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ])
    const excludeFile = path.join(commonDir, 'info', 'exclude')
    const sharedExclude = path.join(harness.root, 'shared-exclude')
    writeFileSync(sharedExclude, '/shared-only\n')
    rmSync(excludeFile)
    symlinkSync(sharedExclude, excludeFile)
    const target = path.join(harness.root, 'symlink-exclude-target')

    const creation = runScript(harness, 'create-worktree', [
      '-b',
      'symlink-exclude-target',
      target,
    ])

    expect(creation.status, creation.stderr).toBe(0)
    expect(lstatSync(excludeFile).isSymbolicLink()).toBe(true)
    expect(readFileSync(sharedExclude, 'utf8').trim().split('\n').at(-1)).toBe(
      '/.metadata_never_index',
    )
    expect(runGit(target, ['check-ignore', '.metadata_never_index'])).toBe(
      '.metadata_never_index',
    )
  })

  it('preserves shared exclude inode and mode while establishing precedence', () => {
    const harness = createHarness()
    const commonDir = runGit(harness.primary, [
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ])
    const excludeFile = path.join(commonDir, 'info', 'exclude')
    const linkedExclude = path.join(harness.root, 'linked-exclude')
    chmodSync(excludeFile, 0o644)
    linkSync(excludeFile, linkedExclude)
    const before = statSync(excludeFile)
    const target = path.join(harness.root, 'linked-exclude-target')

    const creation = runScript(harness, 'create-worktree', [
      '-b',
      'linked-exclude-target',
      target,
    ])

    expect(creation.status, creation.stderr).toBe(0)
    const after = statSync(excludeFile)
    expect(after.ino).toBe(before.ino)
    expect(after.mode & 0o777).toBe(0o644)
    expect(statSync(linkedExclude).ino).toBe(before.ino)
    expect(readFileSync(linkedExclude, 'utf8').trim().split('\n').at(-1)).toBe(
      '/.metadata_never_index',
    )
  })

  it('preserves a shared exclude symlink when registration fails', () => {
    const harness = createHarness()
    const commonDir = runGit(harness.primary, [
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ])
    const excludeFile = path.join(commonDir, 'info', 'exclude')
    const sharedExclude = path.join(harness.root, 'failed-shared-exclude')
    writeFileSync(sharedExclude, '/shared-only\n')
    rmSync(excludeFile)
    symlinkSync(sharedExclude, excludeFile)
    const target = path.join(harness.root, 'failed-symlink-exclude-target')

    const creation = runScript(harness, 'create-worktree', [
      '-b',
      'main',
      target,
    ])

    expect(creation.status).not.toBe(0)
    expect(lstatSync(excludeFile).isSymbolicLink()).toBe(true)
    expect(readFileSync(sharedExclude, 'utf8').trim().split('\n').at(-1)).toBe(
      '/.metadata_never_index',
    )
    expect(existsSync(target)).toBe(false)
  })

  it('repairs shared Spotlight state before rolling back a failed hook', () => {
    const harness = createHarness()
    const sibling = path.join(harness.root, 'failed-hook-sibling')
    expect(
      runScript(harness, 'create-worktree', [
        '-b',
        'failed-hook-sibling',
        sibling,
      ]).status,
    ).toBe(0)
    executable(
      path.join(harness.primary, '.githooks', 'post-checkout'),
      `#!/bin/sh
exclude=$(git rev-parse --path-format=absolute --git-path info/exclude)
printf '# failed hook\n/hook-failure-owned\n' >"$exclude"
exit 23
`,
    )
    const target = path.join(harness.root, 'failed-hook-target')

    const creation = runScript(harness, 'create-worktree', [
      '-b',
      'failed-hook-target',
      target,
    ])

    expect(creation.status).toBe(23)
    expect(runGit(harness.primary, ['worktree', 'list', '--porcelain'])).not.toContain(
      target,
    )
    expect(existsSync(target)).toBe(false)
    expect(
      runGit(harness.primary, [
        'rev-parse',
        '--verify',
        'refs/heads/failed-hook-target',
      ]),
    ).toMatch(/^[0-9a-f]{40,64}$/)
    const excludeFile = runGit(sibling, [
      'rev-parse',
      '--path-format=absolute',
      '--git-path',
      'info/exclude',
    ])
    const excludeRules = readFileSync(excludeFile, 'utf8').trim().split('\n')
    expect(excludeRules).toContain('# failed hook')
    expect(excludeRules).toContain('/hook-failure-owned')
    expect(excludeRules.at(-1)).toBe('/.metadata_never_index')
    expect(runGit(sibling, ['check-ignore', '.metadata_never_index'])).toBe(
      '.metadata_never_index',
    )
    expect(runGit(sibling, ['status', '--porcelain'])).toBe('')
  })

  it('repairs shared Spotlight state before rolling back an interrupted hook', async () => {
    const harness = createHarness()
    const sibling = path.join(harness.root, 'interrupted-shared-rule-sibling')
    expect(
      runScript(harness, 'create-worktree', [
        '-b',
        'interrupted-shared-rule-sibling',
        sibling,
      ]).status,
    ).toBe(0)
    const hookStarted = path.join(harness.root, 'shared-rule-hook-started')
    executable(
      path.join(harness.primary, '.githooks', 'post-checkout'),
      `#!/bin/sh
exclude=$(git rev-parse --path-format=absolute --git-path info/exclude)
printf '# interrupted hook\n/hook-interruption-owned\n!.*\n' >"$exclude"
touch ${JSON.stringify(hookStarted)}
sleep 2
`,
    )
    const target = path.join(harness.root, 'interrupted-shared-rule-target')

    const creation = await interruptScriptAfterPath(
      harness,
      ['-b', 'interrupted-shared-rule-target', target],
      hookStarted,
    )

    expect(
      creation.status === 130 ||
        (creation.status === null && creation.signal === 'SIGINT'),
      creation.stderr,
    ).toBe(true)
    expect(runGit(harness.primary, ['worktree', 'list', '--porcelain'])).not.toContain(
      target,
    )
    expect(existsSync(target)).toBe(false)
    const excludeFile = runGit(sibling, [
      'rev-parse',
      '--path-format=absolute',
      '--git-path',
      'info/exclude',
    ])
    const excludeRules = readFileSync(excludeFile, 'utf8').trim().split('\n')
    expect(excludeRules).toContain('# interrupted hook')
    expect(excludeRules).toContain('/hook-interruption-owned')
    expect(excludeRules.at(-1)).toBe('/.metadata_never_index')
    expect(runGit(sibling, ['check-ignore', '.metadata_never_index'])).toBe(
      '.metadata_never_index',
    )
    expect(runGit(sibling, ['status', '--porcelain'])).toBe('')
  }, 15_000)

  it('reports shared Spotlight repair failure alongside hook failure', () => {
    const harness = createHarness()
    executable(
      path.join(harness.primary, '.githooks', 'post-checkout'),
      `#!/bin/sh
exclude=$(git rev-parse --path-format=absolute --git-path info/exclude)
rm -f "$exclude"
mkdir "$exclude"
exit 23
`,
    )
    const target = path.join(harness.root, 'shared-rule-repair-failure')

    const creation = runScript(harness, 'create-worktree', [
      '-b',
      'shared-rule-repair-failure',
      target,
    ])

    expect(creation.status).toBe(23)
    expect(creation.stderr).toContain(
      'setup failed (status 23); Spotlight exclude repair failed',
    )
    expect(runGit(harness.primary, ['worktree', 'list', '--porcelain'])).not.toContain(
      target,
    )
    expect(existsSync(target)).toBe(false)
    expect(
      runGit(harness.primary, [
        'rev-parse',
        '--verify',
        'refs/heads/shared-rule-repair-failure',
      ]),
    ).toMatch(/^[0-9a-f]{40,64}$/)
  })

  it('rolls back when final authorization publication fails', () => {
    const harness = createHarness()
    const target = path.join(harness.root, 'authorization-publication-failure')
    executable(
      path.join(harness.primary, '.githooks', 'post-checkout'),
      `#!/bin/sh
admin=$(git rev-parse --path-format=absolute --git-dir)
mkdir "$admin/murph-storage-guard-authorized"
`,
    )

    const creation = runScript(harness, 'create-worktree', [
      '-b',
      'authorization-publication-failure',
      target,
    ])

    expect(creation.status).not.toBe(0)
    expect(runGit(harness.primary, ['worktree', 'list', '--porcelain'])).not.toContain(
      target,
    )
    expect(existsSync(target)).toBe(false)
    expect(
      runGit(harness.primary, [
        'rev-parse',
        '--verify',
        'refs/heads/authorization-publication-failure',
      ]),
    ).toMatch(/^[0-9a-f]{40,64}$/)
  })

  it('rolls back a marked worktree and retains its failed creation fence', () => {
    const harness = createHarness()
    const target = path.join(harness.root, 'partial-materialization')
    const markerObserved = path.join(harness.root, 'marker-observed-before-failure')
    const hookInvoked = path.join(harness.root, 'post-checkout-after-failure')
    executable(
      path.join(harness.primary, '.githooks', 'post-checkout'),
      `#!/bin/sh
touch ${JSON.stringify(hookInvoked)}
`,
    )
    runGit(harness.primary, [
      'config',
      'filter.materialization-failure.smudge',
      `test -f .metadata_never_index && touch ${JSON.stringify(markerObserved)} && exit 29`,
    ])
    runGit(harness.primary, [
      'config',
      'filter.materialization-failure.clean',
      'cat',
    ])
    runGit(harness.primary, [
      'config',
      'filter.materialization-failure.required',
      'true',
    ])
    writeFileSync(
      path.join(harness.primary, '.gitattributes'),
      'materialization-probe.txt filter=materialization-failure\n',
    )
    writeFileSync(path.join(harness.primary, 'materialization-probe.txt'), 'probe\n')
    runGit(harness.primary, ['add', '.gitattributes', 'materialization-probe.txt'])
    runGit(harness.primary, ['commit', '-m', 'add failing materialization probe'])

    const creation = runScript(harness, 'create-worktree', [
      '-b',
      'partial-materialization-failure',
      target,
    ])

    expect(creation.status).not.toBe(0)
    expect(creation.stderr).toContain('smudge filter materialization-failure failed')
    expect(existsSync(markerObserved)).toBe(true)
    expect(existsSync(hookInvoked)).toBe(false)
    expect(runGit(harness.primary, ['worktree', 'list', '--porcelain'])).not.toContain(
      target,
    )
    expect(existsSync(target)).toBe(false)
    expect(
      runGit(harness.primary, [
        'rev-parse',
        '--verify',
        'refs/heads/partial-materialization-failure',
      ]),
    ).toMatch(/^[0-9a-f]{40,64}$/)

    const guard = runScript(harness, 'worktree-storage-guard')
    expect(guard.status, guard.stderr).toBe(0)

    runGit(harness.primary, [
      'config',
      'filter.materialization-failure.smudge',
      'cat',
    ])
    const retry = runScript(harness, 'create-worktree', [
      '-B',
      'partial-materialization-failure',
      target,
    ])
    expect(retry.status).toBe(1)
    expect(retry.stderr).toContain('matching incomplete creation already exists')
    expect(existsSync(target)).toBe(false)
    expect(existsSync(hookInvoked)).toBe(false)
  })

  it('rolls back an interrupted materialization and retains its retry fence', async () => {
    const harness = createHarness()
    const unrelatedTarget = path.join(harness.root, 'unrelated-existing')
    expect(
      runScript(harness, 'create-worktree', [
        '-b',
        'unrelated-existing',
        unrelatedTarget,
      ]).status,
    ).toBe(0)

    const target = path.join(harness.root, 'interrupted-materialization')
    const filterStarted = path.join(harness.root, 'materialization-started')
    const hookInvoked = path.join(harness.root, 'interrupted-hook-invoked')
    executable(
      path.join(harness.primary, '.githooks', 'post-checkout'),
      `#!/bin/sh
touch ${JSON.stringify(hookInvoked)}
`,
    )
    runGit(harness.primary, [
      'config',
      'filter.interrupted-materialization.smudge',
      `test -f .metadata_never_index && touch ${JSON.stringify(filterStarted)} && sleep 2`,
    ])
    runGit(harness.primary, [
      'config',
      'filter.interrupted-materialization.clean',
      'cat',
    ])
    runGit(harness.primary, [
      'config',
      'filter.interrupted-materialization.required',
      'true',
    ])
    writeFileSync(
      path.join(harness.primary, '.gitattributes'),
      'interrupted-probe.txt filter=interrupted-materialization\n',
    )
    writeFileSync(path.join(harness.primary, 'interrupted-probe.txt'), 'probe\n')
    runGit(harness.primary, ['add', '.gitattributes', 'interrupted-probe.txt'])
    runGit(harness.primary, ['commit', '-m', 'add interrupted materialization probe'])

    const creation = await interruptScriptAfterPath(
      harness,
      ['-b', 'interrupted-materialization', target],
      filterStarted,
    )

    expect(
      creation.status === 130 ||
        (creation.status === null && creation.signal === 'SIGINT'),
      creation.stderr,
    ).toBe(true)
    const listing = runGit(harness.primary, ['worktree', 'list', '--porcelain'])
    expect(listing).not.toContain(target)
    expect(listing).toContain(unrelatedTarget)
    expect(existsSync(target)).toBe(false)
    expect(existsSync(unrelatedTarget)).toBe(true)
    expect(existsSync(hookInvoked)).toBe(false)
    expect(
      runGit(harness.primary, [
        'rev-parse',
        '--verify',
        'refs/heads/interrupted-materialization',
      ]),
    ).toMatch(/^[0-9a-f]{40,64}$/)

    runGit(harness.primary, [
      'config',
      'filter.interrupted-materialization.smudge',
      'cat',
    ])
    const retry = runScript(harness, 'create-worktree', [
      '-B',
      'interrupted-materialization',
      target,
    ])
    expect(retry.status).toBe(1)
    expect(retry.stderr).toContain('matching incomplete creation already exists')
    expect(existsSync(target)).toBe(false)
    expect(existsSync(hookInvoked)).toBe(false)
  }, 15_000)

  it('rolls back an interrupted post-checkout hook and retains its retry fence', async () => {
    const harness = createHarness()
    const target = path.join(harness.root, 'interrupted-post-checkout')
    const hookStarted = path.join(harness.root, 'post-checkout-started')
    const postCheckout = path.join(harness.primary, '.githooks', 'post-checkout')
    executable(
      postCheckout,
      `#!/bin/sh
touch ${JSON.stringify(hookStarted)}
sleep 2
`,
    )

    const creation = await interruptScriptAfterPath(
      harness,
      ['-b', 'interrupted-post-checkout', target],
      hookStarted,
    )

    expect(
      creation.status === 130 ||
        (creation.status === null && creation.signal === 'SIGINT'),
      creation.stderr,
    ).toBe(true)
    expect(runGit(harness.primary, ['worktree', 'list', '--porcelain'])).not.toContain(
      target,
    )
    expect(existsSync(target)).toBe(false)
    expect(
      runGit(harness.primary, [
        'rev-parse',
        '--verify',
        'refs/heads/interrupted-post-checkout',
      ]),
    ).toMatch(/^[0-9a-f]{40,64}$/)

    executable(postCheckout, '#!/bin/sh\nexit 0\n')
    const retry = runScript(harness, 'create-worktree', [
      '-B',
      'interrupted-post-checkout',
      target,
    ])
    expect(retry.status).toBe(1)
    expect(retry.stderr).toContain('matching incomplete creation already exists')
    expect(existsSync(target)).toBe(false)
  }, 15_000)

  it('leaves an uncatchably interrupted materialization unauthorized', async () => {
    const harness = createHarness()
    const target = path.join(harness.root, 'killed-materialization')
    const filterStarted = path.join(harness.root, 'killed-materialization-started')
    const hookInvoked = path.join(harness.root, 'killed-materialization-hook')
    executable(
      path.join(harness.primary, '.githooks', 'post-checkout'),
      `#!/bin/sh
touch ${JSON.stringify(hookInvoked)}
`,
    )
    runGit(harness.primary, [
      'config',
      'filter.killed-materialization.smudge',
      `admin=$(git rev-parse --path-format=absolute --git-dir) && test ! -e "$admin/murph-storage-guard-authorized" && touch ${JSON.stringify(filterStarted)} && sleep 30`,
    ])
    runGit(harness.primary, [
      'config',
      'filter.killed-materialization.clean',
      'cat',
    ])
    runGit(harness.primary, [
      'config',
      'filter.killed-materialization.required',
      'true',
    ])
    writeFileSync(
      path.join(harness.primary, '.gitattributes'),
      'killed-materialization.txt filter=killed-materialization\n',
    )
    writeFileSync(path.join(harness.primary, 'killed-materialization.txt'), 'probe\n')
    runGit(harness.primary, [
      'add',
      '.gitattributes',
      'killed-materialization.txt',
    ])
    runGit(harness.primary, ['commit', '-m', 'add killed materialization probe'])

    const creation = await interruptScriptAfterPath(
      harness,
      ['-b', 'killed-materialization', target],
      filterStarted,
      'SIGKILL',
    )

    expect(creation.status).toBe(null)
    expect(creation.signal).toBe('SIGKILL')
    expect(runGit(harness.primary, ['worktree', 'list', '--porcelain'])).toContain(
      target,
    )
    expect(existsSync(target)).toBe(true)
    expect(existsSync(hookInvoked)).toBe(false)
    const admin = runGit(target, [
      'rev-parse',
      '--path-format=absolute',
      '--git-dir',
    ])
    expect(existsSync(path.join(admin, 'murph-storage-guard-authorized'))).toBe(
      false,
    )
    const guard = runScript(harness, 'worktree-storage-guard')
    expect(guard.status).toBe(1)
    expect(guard.stderr).toContain('bypassed scripts/create-worktree')
    const retry = runScript(harness, 'create-worktree', [
      '-B',
      'killed-materialization',
      target,
    ])
    expect(retry.status).toBe(1)
    expect(retry.stderr).toContain('target is already a registered checkout')
  }, 15_000)

  it('leaves an uncatchably interrupted post-checkout hook unauthorized', async () => {
    const harness = createHarness()
    const target = path.join(harness.root, 'killed-post-checkout')
    const hookStarted = path.join(harness.root, 'killed-post-checkout-started')
    executable(
      path.join(harness.primary, '.githooks', 'post-checkout'),
      `#!/bin/sh
admin=$(git rev-parse --path-format=absolute --git-dir)
test ! -e "$admin/murph-storage-guard-authorized" || exit 25
touch ${JSON.stringify(hookStarted)}
sleep 30
`,
    )

    const creation = await interruptScriptAfterPath(
      harness,
      ['-b', 'killed-post-checkout', target],
      hookStarted,
      'SIGKILL',
    )

    expect(creation.status).toBe(null)
    expect(creation.signal).toBe('SIGKILL')
    expect(runGit(harness.primary, ['worktree', 'list', '--porcelain'])).toContain(
      target,
    )
    const admin = runGit(target, [
      'rev-parse',
      '--path-format=absolute',
      '--git-dir',
    ])
    expect(existsSync(path.join(admin, 'murph-storage-guard-authorized'))).toBe(
      false,
    )
    const guard = runScript(harness, 'worktree-storage-guard')
    expect(guard.status).toBe(1)
    expect(guard.stderr).toContain('bypassed scripts/create-worktree')
  }, 15_000)

  it('keeps a retained rollback failure unauthorized', () => {
    const harness = createHarness()
    const target = path.join(harness.root, 'rollback-removal-failure')
    executable(
      path.join(harness.fakeBin, 'git'),
      `#!/bin/sh
if [ "\${1-}" = -C ] && [ "\${3-}" = worktree ] && [ "\${4-}" = remove ]; then
  exit 31
fi
PATH=/usr/bin:/bin exec git "$@"
`,
    )
    executable(
      path.join(harness.primary, '.githooks', 'post-checkout'),
      '#!/bin/sh\nexit 29\n',
    )

    const creation = runScript(harness, 'create-worktree', [
      '-b',
      'rollback-removal-failure',
      target,
    ])

    expect(creation.status).toBe(31)
    expect(creation.stderr).toContain(
      'setup failed (status 29); rollback failed (status 31)',
    )
    expect(runGit(harness.primary, ['worktree', 'list', '--porcelain'])).toContain(
      target,
    )
    const admin = runGit(target, [
      'rev-parse',
      '--path-format=absolute',
      '--git-dir',
    ])
    expect(existsSync(path.join(admin, 'murph-storage-guard-authorized'))).toBe(
      false,
    )
    const guard = runScript(harness, 'worktree-storage-guard')
    expect(guard.status).toBe(1)
    expect(guard.stderr).toContain('bypassed scripts/create-worktree')
  })

  it('does not register a worktree when shared Spotlight exclusion setup fails', () => {
    const harness = createHarness()
    const target = path.join(harness.root, 'exclude-setup-failure')
    const excludeFile = runGit(harness.primary, [
      'rev-parse',
      '--path-format=absolute',
      '--git-path',
      'info/exclude',
    ])
    rmSync(excludeFile)
    mkdirSync(excludeFile)

    const creation = runScript(harness, 'create-worktree', [
      '-b',
      'exclude-setup-failure',
      target,
    ])

    expect(creation.status).not.toBe(0)
    expect(existsSync(target)).toBe(false)
    expect(runGit(harness.primary, ['worktree', 'list', '--porcelain'])).not.toContain(
      target,
    )
    expect(runGit(harness.primary, ['branch', '--format=%(refname:short)'])).not.toContain(
      'exclude-setup-failure',
    )
  })

  it('rolls back the complete post-registration setup boundary', () => {
    const harness = createHarness()
    const target = path.join(harness.root, 'marker-setup-failure')
    executable(
      path.join(harness.fakeBin, 'touch'),
      `#!/bin/sh
if [ "\${1-}" = ${JSON.stringify(path.join(target, '.metadata_never_index'))} ]; then
  exit 29
fi
PATH=/usr/bin:/bin exec touch "$@"
`,
    )

    const creation = runScript(harness, 'create-worktree', [
      '-b',
      'marker-setup-failure',
      target,
    ])

    expect(creation.status).toBe(29)
    expect(runGit(harness.primary, ['worktree', 'list', '--porcelain'])).not.toContain(
      target,
    )
    expect(existsSync(target)).toBe(false)
    expect(
      runGit(harness.primary, [
        'rev-parse',
        '--verify',
        'refs/heads/marker-setup-failure',
      ]),
    ).toMatch(/^[0-9a-f]{40,64}$/)
    const guard = runScript(harness, 'worktree-storage-guard')
    expect(guard.status, guard.stderr).toBe(0)
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

  it('warns without admitting a new unmanaged clone during scoped worktree journeys', () => {
    const harness = createHarness()
    runGit(harness.primary, [
      'remote',
      'add',
      'origin',
      'https://example.test/example/murph.git',
    ])
    const baseline = runScript(harness, 'worktree-storage-guard')
    expect(baseline.status, baseline.stderr).toBe(0)

    const existingWorktree = path.join(harness.root, 'existing-worktree')
    const initialCreation = runScript(harness, 'create-worktree', [
      '-b',
      'existing-worktree',
      existingWorktree,
    ])
    expect(initialCreation.status, initialCreation.stderr).toBe(0)

    runGit(harness.root, [
      'clone',
      harness.primary,
      path.join(harness.tempRoot, 'murph-unrelated-task'),
    ])
    writeFileSync(path.join(existingWorktree, 'tracked.txt'), 'scoped commit\n')
    runGit(existingWorktree, ['add', 'tracked.txt'])

    const commit = spawnSync('bash', [
      'scripts/committer',
      'test(repo): scoped commit',
      'tracked.txt',
    ], {
      cwd: existingWorktree,
      encoding: 'utf8',
      env: guardEnvironment(harness, {
        MURPH_TEST_COMMITTER_BIN: path.join(harness.fakeBin, 'cobuild-committer'),
      }),
    })
    expect(commit.status, commit.stderr).toBe(0)
    expect(commit.stderr).toContain('warning: 1 new unmanaged temporary checkout')

    const createdWorktree = path.join(harness.root, 'created-worktree')
    const creation = runScript(harness, 'create-worktree', [
      '-b',
      'created-worktree',
      createdWorktree,
    ])
    expect(creation.status, creation.stderr).toBe(0)
    expect(creation.stderr).toContain('warning: 1 new unmanaged temporary checkout')
    const createdAdmin = runGit(createdWorktree, [
      'rev-parse',
      '--path-format=absolute',
      '--git-dir',
    ])
    expect(
      existsSync(path.join(createdAdmin, 'murph-storage-guard-authorized')),
    ).toBe(true)
    expect(readFileSync(path.join(harness.state, 'unmanaged-temp-checkouts'), 'utf8')).toBe('')

    const globalAudit = runScript(harness, 'worktree-storage-guard')
    expect(globalAudit.status).toBe(1)
    expect(globalAudit.stderr).toContain('new unmanaged temporary checkout')
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
    const historicalCommit = spawnSync('bash', [
      'scripts/committer',
      'test(repo): historical commit',
      'tracked.txt',
    ], {
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
    const headCommit = spawnSync('bash', [
      'scripts/committer',
      'test(repo): head committer',
      'tracked.txt',
    ], {
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
      [
        'scripts/committer',
        'test(repo): historical after primary upgrade',
        'tracked.txt',
      ],
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

  it('rolls back when the native checkout hook fails', () => {
    const harness = createHarness()
    const postCheckout = path.join(harness.primary, '.githooks', 'post-checkout')
    const hookInvocations = path.join(harness.root, 'post-checkout-invocations')
    executable(
      postCheckout,
      `#!/bin/sh
printf '%s|%s|%s|%s\\n' "$PWD" "$1" "$2" "$3" >>${JSON.stringify(hookInvocations)}
exit 23
`,
    )
    const target = path.join(harness.root, 'partial')
    const expectedHead = runGit(harness.primary, ['rev-parse', 'HEAD'])

    const creation = runScript(harness, 'create-worktree', [
      '-b',
      'partial-hook-failure',
      target,
    ])
    expect(creation.status).toBe(23)
    expect(runGit(harness.primary, ['worktree', 'list', '--porcelain'])).not.toContain(
      target,
    )
    expect(existsSync(target)).toBe(false)
    expect(readFileSync(hookInvocations, 'utf8').trim().split('\n')).toEqual([
      `${realpathSync(harness.root)}/partial|${'0'.repeat(expectedHead.length)}|${expectedHead}|1`,
    ])
    expect(
      runGit(harness.primary, [
        'rev-parse',
        '--verify',
        'refs/heads/partial-hook-failure',
      ]),
    ).toBe(expectedHead)
    rmSync(postCheckout)

    const guard = runScript(harness, 'worktree-storage-guard')
    expect(guard.status, guard.stderr).toBe(0)
  })

  it('matches native post-checkout repository-local environment behavior', () => {
    const harness = createHarness()
    const secondary = path.join(harness.root, 'secondary')
    mkdirSync(secondary)
    runGit(secondary, ['init', '-b', 'main'])
    runGit(secondary, ['config', 'user.name', 'Worktree Guard Test'])
    runGit(secondary, [
      'config',
      'user.email',
      'worktree-guard@users.noreply.github.com',
    ])
    const secondaryFile = path.join(secondary, 'secondary-only.txt')
    writeFileSync(secondaryFile, 'baseline\n')
    runGit(secondary, ['add', 'secondary-only.txt'])
    runGit(secondary, ['commit', '-m', 'baseline'])
    writeFileSync(secondaryFile, 'changed\n')

    const hookEnvironments = path.join(harness.root, 'post-checkout-environments')
    const expectedHead = runGit(harness.primary, ['rev-parse', 'HEAD'])
    const expectedExecPath = runGit(harness.primary, ['--exec-path'])
    executable(
      path.join(harness.primary, '.githooks', 'post-checkout'),
      `#!/bin/sh
printf '%s|%s|%s:%s|%s|%s|%s|%s|%s|%s|%s\n' \
  "$PWD" "\${GIT_DIR-unset}" "\${GIT_PREFIX+set}" "\${GIT_PREFIX-}" \
  "\${GIT_EXEC_PATH-unset}" "\${PATH%%:*}" \
  "\${MURPH_CREATE_WORKTREE_LOCK_HELD-unset}" \
  "\${MURPH_WORKTREE_GUARD_LOCK_HELD-unset}" \
  "$1" "$2" "$3" >>${JSON.stringify(hookEnvironments)}
( . "$GIT_EXEC_PATH/git-sh-setup" )
git -C ${JSON.stringify(secondary)} add secondary-only.txt
`,
    )
    expect(runScript(harness, 'install-git-hooks').status).toBe(0)

    const nativeTarget = path.join(harness.root, 'native-hook-environment')
    runGit(harness.primary, [
      'worktree',
      'add',
      '-b',
      'native-hook-environment',
      nativeTarget,
    ])
    expect(runGit(nativeTarget, ['status', '--porcelain'])).toBe('')
    expect(runGit(secondary, ['status', '--porcelain'])).toBe(
      'M  secondary-only.txt',
    )

    runGit(secondary, ['reset', 'HEAD', '--', 'secondary-only.txt'])
    const target = path.join(harness.root, 'helper-hook-environment')
    const creation = runScript(harness, 'create-worktree', [
      '-b',
      'helper-hook-environment',
      target,
    ])

    expect(creation.status, creation.stderr).toBe(0)
    expect(readFileSync(hookEnvironments, 'utf8').trim().split('\n')).toEqual([
      `${realpathSync(nativeTarget)}|unset|set:|${expectedExecPath}|${expectedExecPath}|unset|unset|${'0'.repeat(expectedHead.length)}|${expectedHead}|1`,
      `${realpathSync(target)}|unset|set:|${expectedExecPath}|${expectedExecPath}|unset|unset|${'0'.repeat(expectedHead.length)}|${expectedHead}|1`,
    ])
    expect(runGit(target, ['status', '--porcelain'])).toBe('')
    expect(runGit(secondary, ['status', '--porcelain'])).toBe(
      'M  secondary-only.txt',
    )
  })

  it('matches native post-checkout end-of-file input behavior', async () => {
    const hookContents = `#!/bin/sh
if IFS= read -r line; then
  printf 'line:%s\\n' "$line" >"$MURPH_TEST_STDIN_LOG"
else
  printf 'eof\\n' >"$MURPH_TEST_STDIN_LOG"
fi
`

    const nativeHarness = createHarness()
    executable(
      path.join(nativeHarness.primary, '.githooks', 'post-checkout'),
      hookContents,
    )
    expect(runScript(nativeHarness, 'install-git-hooks').status).toBe(0)
    const nativeBytesLog = path.join(nativeHarness.root, 'native-bytes-input')
    const nativeBytesTarget = path.join(nativeHarness.root, 'native-bytes-target')
    const nativeBytes = spawnSync(
      'git',
      ['worktree', 'add', '-b', 'native-bytes-input', nativeBytesTarget],
      {
        cwd: nativeHarness.primary,
        encoding: 'utf8',
        env: {
          ...guardEnvironment(nativeHarness),
          MURPH_TEST_STDIN_LOG: nativeBytesLog,
        },
        input: 'secret-input\n',
      },
    )
    expect(nativeBytes.status, nativeBytes.stderr).toBe(0)
    expect(readFileSync(nativeBytesLog, 'utf8')).toBe('eof\n')

    const nativeOpenLog = path.join(nativeHarness.root, 'native-open-input')
    const nativeOpenTarget = path.join(nativeHarness.root, 'native-open-target')
    const nativeOpen = await runWithHeldOpenInput(
      'git',
      ['worktree', 'add', '-b', 'native-open-input', nativeOpenTarget],
      nativeHarness.primary,
      {
        ...guardEnvironment(nativeHarness),
        MURPH_TEST_STDIN_LOG: nativeOpenLog,
      },
    )
    expect(nativeOpen.timedOut, nativeOpen.stderr).toBe(false)
    expect(nativeOpen.status, nativeOpen.stderr).toBe(0)
    expect(readFileSync(nativeOpenLog, 'utf8')).toBe('eof\n')

    const helperHarness = createHarness()
    executable(
      path.join(helperHarness.primary, '.githooks', 'post-checkout'),
      hookContents,
    )
    const helperBytesLog = path.join(helperHarness.root, 'helper-bytes-input')
    const helperBytesTarget = path.join(helperHarness.root, 'helper-bytes-target')
    const helperBytes = spawnSync(
      'bash',
      [
        path.join('scripts', 'create-worktree'),
        '-b',
        'helper-bytes-input',
        helperBytesTarget,
      ],
      {
        cwd: helperHarness.primary,
        encoding: 'utf8',
        env: guardEnvironment(helperHarness, {
          MURPH_TEST_STDIN_LOG: helperBytesLog,
        }),
        input: 'secret-input\n',
      },
    )
    expect(helperBytes.status, helperBytes.stderr).toBe(0)
    expect(readFileSync(helperBytesLog, 'utf8')).toBe('eof\n')

    const helperOpenLog = path.join(helperHarness.root, 'helper-open-input')
    const helperOpenTarget = path.join(helperHarness.root, 'helper-open-target')
    const helperOpen = await runWithHeldOpenInput(
      'bash',
      [
        path.join('scripts', 'create-worktree'),
        '-b',
        'helper-open-input',
        helperOpenTarget,
      ],
      helperHarness.primary,
      guardEnvironment(helperHarness, {
        MURPH_TEST_STDIN_LOG: helperOpenLog,
      }),
    )
    expect(helperOpen.timedOut, helperOpen.stderr).toBe(false)
    expect(helperOpen.status, helperOpen.stderr).toBe(0)
    expect(readFileSync(helperOpenLog, 'utf8')).toBe('eof\n')
  }, 15_000)

  it('matches native unavailable post-checkout interpreter status', () => {
    const nativeHarness = createHarness()
    const nativeHook = path.join(
      nativeHarness.primary,
      '.githooks',
      'post-checkout',
    )
    executable(nativeHook, '#!/definitely/missing/murph-interpreter\n')
    expect(runScript(nativeHarness, 'install-git-hooks').status).toBe(0)
    const nativeTarget = path.join(nativeHarness.root, 'native-missing-interpreter')
    const nativeCreation = spawnSync(
      'git',
      [
        'worktree',
        'add',
        '-b',
        'native-missing-interpreter',
        nativeTarget,
      ],
      { cwd: nativeHarness.primary, encoding: 'utf8' },
    )

    const helperHarness = createHarness()
    executable(
      path.join(helperHarness.primary, '.githooks', 'post-checkout'),
      '#!/definitely/missing/murph-interpreter\n',
    )
    const helperTarget = path.join(helperHarness.root, 'helper-missing-interpreter')
    const helperCreation = runScript(helperHarness, 'create-worktree', [
      '-b',
      'helper-missing-interpreter',
      helperTarget,
    ])

    expect(nativeCreation.status).toBe(1)
    expect(helperCreation.status).toBe(nativeCreation.status)
    expect(helperCreation.stderr).toContain('hook interpreter is unavailable')
    expect(
      runGit(helperHarness.primary, ['worktree', 'list', '--porcelain']),
    ).not.toContain(helperTarget)
    expect(existsSync(helperTarget)).toBe(false)
  })

  it('matches native executable post-checkout shebang handling', () => {
    const variants = [
      { name: 'compact', prefix: '#!/bin/sh\n' },
      { name: 'space', prefix: '#! /bin/sh\n' },
      { name: 'tab', prefix: '#!\t/bin/sh\n' },
      { name: 'env-argument', prefix: '#!/usr/bin/env sh\n' },
      { name: 'no-shebang', prefix: '' },
    ]

    for (const variant of variants) {
      const nativeHarness = createHarness()
      const nativeInvocation = path.join(
        nativeHarness.root,
        `${variant.name}-native-invocation`,
      )
      executable(
        path.join(nativeHarness.primary, '.githooks', 'post-checkout'),
        `${variant.prefix}printf '%s|%s|%s\\n' "$1" "$2" "$3" >${JSON.stringify(nativeInvocation)}\n`,
      )
      expect(runScript(nativeHarness, 'install-git-hooks').status).toBe(0)
      const nativeHead = runGit(nativeHarness.primary, ['rev-parse', 'HEAD'])
      const nativeTarget = path.join(nativeHarness.root, `${variant.name}-native`)
      const nativeCreation = spawnSync(
        'git',
        ['worktree', 'add', '-b', `${variant.name}-native`, nativeTarget],
        { cwd: nativeHarness.primary, encoding: 'utf8' },
      )

      const helperHarness = createHarness()
      const helperInvocation = path.join(
        helperHarness.root,
        `${variant.name}-helper-invocation`,
      )
      executable(
        path.join(helperHarness.primary, '.githooks', 'post-checkout'),
        `${variant.prefix}printf '%s|%s|%s\\n' "$1" "$2" "$3" >${JSON.stringify(helperInvocation)}\n`,
      )
      const helperHead = runGit(helperHarness.primary, ['rev-parse', 'HEAD'])
      const helperTarget = path.join(helperHarness.root, `${variant.name}-helper`)
      const helperCreation = runScript(helperHarness, 'create-worktree', [
        '-b',
        `${variant.name}-helper`,
        helperTarget,
      ])

      expect(nativeCreation.status, nativeCreation.stderr).toBe(0)
      expect(helperCreation.status, helperCreation.stderr).toBe(nativeCreation.status)
      expect(readFileSync(nativeInvocation, 'utf8')).toBe(
        `${'0'.repeat(nativeHead.length)}|${nativeHead}|1\n`,
      )
      expect(readFileSync(helperInvocation, 'utf8')).toBe(
        `${'0'.repeat(helperHead.length)}|${helperHead}|1\n`,
      )
      expect(existsSync(path.join(helperTarget, '.metadata_never_index'))).toBe(true)
      expect(runGit(helperTarget, ['status', '--porcelain'])).toBe('')
    }
  })

  it('preserves ignored non-executable post-checkout hook behavior', () => {
    const harness = createHarness()
    writeFileSync(
      path.join(harness.primary, '.githooks', 'post-checkout'),
      '#!/bin/sh\nexit 23\n',
    )
    const target = path.join(harness.root, 'non-executable-hook')

    const creation = runScript(harness, 'create-worktree', [
      '-b',
      'non-executable-hook',
      target,
    ])

    expect(creation.status, creation.stderr).toBe(0)
    expect(runGit(target, ['status', '--porcelain'])).toBe('')
    expect(existsSync(path.join(target, '.metadata_never_index'))).toBe(true)
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

  it('rolls back a locked data worktree when checkout materialization fails', () => {
    const harness = createHarness()
    const target = path.join(harness.root, 'failed-data-materialization')
    runGit(harness.primary, [
      'config',
      'filter.data-materialization-failure.smudge',
      'exit 29',
    ])
    runGit(harness.primary, [
      'config',
      'filter.data-materialization-failure.clean',
      'cat',
    ])
    runGit(harness.primary, [
      'config',
      'filter.data-materialization-failure.required',
      'true',
    ])
    writeFileSync(
      path.join(harness.primary, '.gitattributes'),
      'data-materialization-probe.txt filter=data-materialization-failure\n',
    )
    writeFileSync(
      path.join(harness.primary, 'data-materialization-probe.txt'),
      'probe\n',
    )
    runGit(harness.primary, [
      'add',
      '.gitattributes',
      'data-materialization-probe.txt',
    ])
    runGit(harness.primary, ['commit', '-m', 'add failing data materialization probe'])

    const creation = runScript(harness, 'create-worktree', [
      '--data-research',
      'failure cleanup proof',
      '-b',
      'failed-data-materialization',
      target,
    ])

    expect(creation.status).not.toBe(0)
    expect(creation.stderr).toContain(
      'smudge filter data-materialization-failure failed',
    )
    expect(runGit(harness.primary, ['worktree', 'list', '--porcelain'])).not.toContain(
      target,
    )
    expect(existsSync(target)).toBe(false)
    expect(
      runGit(harness.primary, [
        'rev-parse',
        '--verify',
        'refs/heads/failed-data-materialization',
      ]),
    ).toMatch(/^[0-9a-f]{40,64}$/)
    const guard = runScript(harness, 'worktree-storage-guard')
    expect(guard.status, guard.stderr).toBe(0)
  })
})
