import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SetupStepResult } from '../setup-cli-contracts.js'
import { createStep, DEFAULT_USER_BIN_DIRECTORY } from './steps.js'
import { defaultFileExists, isExecutable } from './process.js'

const PATH_BLOCK_BEGIN = '# >>> Murph PATH >>>'
const PATH_BLOCK_END = '# <<< Murph PATH <<<'
const LEGACY_PATH_BLOCK_BEGIN = '# >>> Healthy Bob PATH >>>'
const LEGACY_PATH_BLOCK_END = '# <<< Healthy Bob PATH <<<'

export async function ensureCliShims(input: {
  cliBinPath: string
  dryRun: boolean
  env: NodeJS.ProcessEnv
  fileExists: (absolutePath: string) => Promise<boolean>
  homeDirectory: string
  notes: string[]
  steps: SetupStepResult[]
}): Promise<void> {
  const userBinDirectory = path.join(input.homeDirectory, DEFAULT_USER_BIN_DIRECTORY)
  const shellProfilePath = resolveShellProfilePath(input.homeDirectory, input.env)
  const shimSpecs = [
    {
      name: 'murph',
      path: path.join(userBinDirectory, 'murph'),
    },
    {
      name: 'vault-cli',
      path: path.join(userBinDirectory, 'vault-cli'),
    },
  ]
  const legacyShimPaths = [path.join(userBinDirectory, 'healthybob')]
  const pathPresent = pathIncludesSegment(input.env.PATH, userBinDirectory)
  const pathBlockStatus = pathPresent
    ? 'reused'
    : await readPathBlockStatus(shellProfilePath, input.fileExists)
  const shimsReady = await Promise.all(
    shimSpecs.map(async (shim) => {
      return await hasInstalledShim({
        cliBinPath: input.cliBinPath,
        fileExists: input.fileExists,
        shimName: shim.name,
        shimPath: shim.path,
      })
    }),
  )
  const hasAllShims = shimsReady.every(Boolean)
  const legacyShimsPresent = (
    await Promise.all(legacyShimPaths.map(async (shimPath) => await input.fileExists(shimPath)))
  ).some(Boolean)

  if (input.dryRun) {
    const status =
      hasAllShims &&
      !legacyShimsPresent &&
      (pathPresent || pathBlockStatus === 'reused')
        ? 'reused'
        : 'planned'
    const detail = hasAllShims &&
      !legacyShimsPresent &&
      (pathPresent || pathBlockStatus === 'reused')
      ? `Reusing Murph CLI shims from ${userBinDirectory}.`
      : pathPresent
        ? `Would install Murph CLI shims in ${userBinDirectory}.`
        : `Would install Murph CLI shims in ${userBinDirectory} and add ${userBinDirectory} to PATH via ${shellProfilePath}.`

    input.steps.push(
      createStep({
        detail,
        id: 'cli-shims',
        kind: 'configure',
        status,
        title: 'CLI command shims',
      }),
    )
    return
  }

  await mkdir(userBinDirectory, { recursive: true })
  let wroteShim = false

  for (const shim of shimSpecs) {
    const changed = await writeCliShim({
      cliBinPath: input.cliBinPath,
      shimName: shim.name,
      shimPath: shim.path,
    })
    wroteShim = wroteShim || changed
  }
  for (const shimPath of legacyShimPaths) {
    if (await input.fileExists(shimPath)) {
      await rm(shimPath, { force: true })
      wroteShim = true
    }
  }

  let pathUpdated = false
  if (!pathPresent) {
    pathUpdated = await ensurePathBlock(shellProfilePath)
    input.notes.push(
      `Open a new shell or run source ${redactHomePath(shellProfilePath, input.homeDirectory)} to use ${shimSpecs[0].name} immediately.`,
    )
  }

  const status = wroteShim || pathUpdated ? 'completed' : 'reused'
  const detail = pathPresent
    ? `${status === 'completed' ? 'Installed' : 'Reusing'} Murph CLI shims from ${userBinDirectory}.`
    : `${status === 'completed' ? 'Installed' : 'Reusing'} Murph CLI shims from ${userBinDirectory} and ${pathUpdated ? 'added that directory to' : 'confirmed it is managed in'} ${shellProfilePath}.`

  input.steps.push(
    createStep({
      detail,
      id: 'cli-shims',
      kind: 'configure',
      status,
      title: 'CLI command shims',
    }),
  )
}

export function resolveShellProfilePath(
  homeDirectory: string,
  env: NodeJS.ProcessEnv,
): string {
  const shellBaseName = path.basename(env.SHELL ?? '')

  switch (shellBaseName) {
    case 'bash':
      return path.join(homeDirectory, '.bashrc')
    case 'zsh':
      return path.join(homeDirectory, '.zshrc')
    default:
      return path.join(homeDirectory, '.profile')
  }
}

export function pathIncludesSegment(pathValue: string | undefined, entry: string): boolean {
  const normalizedEntry = path.resolve(entry)
  return listPathSegments(pathValue).some(
    (segment) => path.resolve(segment) === normalizedEntry,
  )
}

export function redactNullableHomePath(
  value: string | null,
  homeDirectory: string,
): string | null {
  return value === null ? null : redactHomePath(value, homeDirectory)
}

export function redactHomePath(value: string, homeDirectory: string): string {
  const normalizedValue = path.resolve(value)
  const normalizedHome = path.resolve(homeDirectory)

  if (normalizedValue === normalizedHome) {
    return '~'
  }

  if (normalizedValue.startsWith(`${normalizedHome}${path.sep}`)) {
    return `~${normalizedValue.slice(normalizedHome.length)}`
  }

  return value
}

export function redactHomePathInText(text: string, homeDirectory: string): string {
  const normalizedHome = path.resolve(homeDirectory)
  const escapedHome = escapeRegExp(normalizedHome)
  return text.replace(new RegExp(`${escapedHome}(?=$|[/\\\\])`, 'g'), '~')
}

export function redactHomePathsInValue<T>(
  value: T,
  homeDirectory: string,
): T {
  if (typeof value === 'string') {
    return redactHomePathInText(value, homeDirectory) as T
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactHomePathsInValue(entry, homeDirectory)) as T
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        redactHomePathsInValue(entry, homeDirectory),
      ]),
    ) as T
  }

  return value
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function listPathSegments(pathValue: string | undefined): string[] {
  return (pathValue ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

async function readPathBlockStatus(
  profilePath: string,
  fileExists: (absolutePath: string) => Promise<boolean>,
): Promise<'missing' | 'reused'> {
  if (!(await fileExists(profilePath))) {
    return 'missing'
  }

  const contents = await readFile(profilePath, 'utf8')
  return hasManagedPathBlock(contents) ? 'reused' : 'missing'
}

async function hasInstalledShim(input: {
  cliBinPath: string
  fileExists: (absolutePath: string) => Promise<boolean>
  shimName: string
  shimPath: string
}): Promise<boolean> {
  if (!(await input.fileExists(input.shimPath))) {
    return false
  }

  const contents = await readFile(input.shimPath, 'utf8')
  if (contents !== buildCliShimScript(input.cliBinPath, input.shimName)) {
    return false
  }

  return await isExecutable(input.shimPath)
}

async function writeCliShim(input: {
  cliBinPath: string
  shimName: string
  shimPath: string
}): Promise<boolean> {
  const nextContents = buildCliShimScript(input.cliBinPath, input.shimName)
  const exists = await defaultFileExists(input.shimPath)

  if (exists) {
    const currentContents = await readFile(input.shimPath, 'utf8')
    const executable = await isExecutable(input.shimPath)
    if (currentContents === nextContents && executable) {
      return false
    }
  }

  await writeFile(input.shimPath, nextContents, 'utf8')
  await chmod(input.shimPath, 0o755)
  return true
}

async function ensurePathBlock(profilePath: string): Promise<boolean> {
  let existing = ''

  if (await defaultFileExists(profilePath)) {
    existing = await readFile(profilePath, 'utf8')
    if (hasManagedPathBlock(existing)) {
      return false
    }
  }

  const nextContents = `${existing}${existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''}${buildManagedPathBlock()}`
  await writeFile(profilePath, nextContents, 'utf8')
  return true
}

function hasManagedPathBlock(contents: string): boolean {
  return (
    (
      contents.includes(PATH_BLOCK_BEGIN) &&
      contents.includes(PATH_BLOCK_END)
    ) || (
      contents.includes(LEGACY_PATH_BLOCK_BEGIN) &&
      contents.includes(LEGACY_PATH_BLOCK_END)
    )
  )
}

function buildManagedPathBlock(): string {
  return `${PATH_BLOCK_BEGIN}
export PATH="$HOME/.local/bin:$PATH"
${PATH_BLOCK_END}
`
}

function buildCliShimScript(cliBinPath: string, shimName: string): string {
  const cliSourceBinPath = resolveRepoCliSourceBinPath(cliBinPath)
  const cliPackageRoot = path.resolve(path.dirname(cliBinPath), '..')
  const repoRoot = resolveRepoRootFromCliBinPath(cliBinPath)
  const cliRequiredDistPaths = [
    cliBinPath,
    path.join(cliPackageRoot, 'dist', 'index.js'),
    path.join(cliPackageRoot, 'dist', 'vault-cli-contracts.js'),
    path.join(cliPackageRoot, 'dist', 'inbox-cli-contracts.js'),
  ]
  const workspacePackageNames = [
    'contracts',
    'core',
    'device-syncd',
    'importers',
    'inboxd',
    'parsers',
    'query',
    'runtime-state',
  ]
  const workspaceCheckLines = workspacePackageNames
    .map((packageName) => {
      const packageRoot = path.join(repoRoot, 'packages', packageName)
      const packageDistIndexPath = path.join(packageRoot, 'dist', 'index.js')
      return `  if [ ! -f ${quoteShellArgument(packageDistIndexPath)} ]; then
    missing_packages+=(${quoteShellArgument(packageRoot)})
  fi`
    })
    .join('\n')
  const cliDistCheckLines = cliRequiredDistPaths
    .map((requiredPath) => {
      return `if [ ! -f ${quoteShellArgument(requiredPath)} ]; then
  cli_dist_ready=false
fi`
    })
    .join('\n')

  return `#!/usr/bin/env bash
set -euo pipefail

run_supervised() {
  if [[ -t 0 && -t 2 ]]; then
    exec "$@"
  fi

  "$@" &
  child_pid=$!

  forward_signal() {
    local signal_name="$1"
    local exit_code="$2"
    local attempts=0

    trap - INT TERM
    kill "-$signal_name" "$child_pid" 2>/dev/null || true

    while kill -0 "$child_pid" 2>/dev/null; do
      if [ "$attempts" -ge 20 ]; then
        kill -KILL "$child_pid" 2>/dev/null || true
        break
      fi

      sleep 0.1
      attempts=$((attempts + 1))
    done

    wait "$child_pid" 2>/dev/null || true
    exit "$exit_code"
  }

  trap 'forward_signal INT 130' INT
  trap 'forward_signal TERM 143' TERM

  while kill -0 "$child_pid" 2>/dev/null; do
    sleep 0.1
  done

  wait "$child_pid"
  local exit_code=$?
  trap - INT TERM
  return "$exit_code"
}

cli_dist_ready=true
${cliDistCheckLines}

is_discovery_invocation() {
  for arg in "$@"; do
    case "$arg" in
      --help|--schema|--llms|--llms-full)
        return 0
        ;;
    esac
  done

  return 1
}

if is_discovery_invocation "$@"; then
  if [ "$cli_dist_ready" = true ]; then
    run_supervised env SETUP_PROGRAM_NAME=${quoteShellArgument(shimName)} node ${quoteShellArgument(cliBinPath)} "$@"
    exit $?
  fi

  if [ -f ${quoteShellArgument(cliSourceBinPath)} ]; then
    if command -v pnpm >/dev/null 2>&1; then
      run_supervised env SETUP_PROGRAM_NAME=${quoteShellArgument(shimName)} pnpm --dir ${quoteShellArgument(repoRoot)} exec tsx ${quoteShellArgument(cliSourceBinPath)} "$@"
      exit $?
    fi

    if command -v corepack >/dev/null 2>&1; then
      run_supervised env SETUP_PROGRAM_NAME=${quoteShellArgument(shimName)} corepack pnpm --dir ${quoteShellArgument(repoRoot)} exec tsx ${quoteShellArgument(cliSourceBinPath)} "$@"
      exit $?
    fi
  fi
fi

missing_packages=()
if [ "$cli_dist_ready" != true ]; then
  missing_packages+=(${quoteShellArgument(cliPackageRoot)})
fi

${workspaceCheckLines}

if [ "\${#missing_packages[@]}" -gt 0 ]; then
  if command -v pnpm >/dev/null 2>&1; then
    for package_dir in "\${missing_packages[@]}"; do
      pnpm --dir "$package_dir" build >/dev/null
    done
  elif command -v corepack >/dev/null 2>&1; then
    for package_dir in "\${missing_packages[@]}"; do
      corepack pnpm --dir "$package_dir" build >/dev/null
    done
  fi
fi

cli_dist_ready=true
${cliDistCheckLines}

if [ "$cli_dist_ready" = true ]; then
  run_supervised env SETUP_PROGRAM_NAME=${quoteShellArgument(shimName)} node ${quoteShellArgument(cliBinPath)} "$@"
  exit $?
fi

if [ -f ${quoteShellArgument(cliSourceBinPath)} ]; then
  if command -v pnpm >/dev/null 2>&1; then
    run_supervised env SETUP_PROGRAM_NAME=${quoteShellArgument(shimName)} pnpm --dir ${quoteShellArgument(repoRoot)} exec tsx ${quoteShellArgument(cliSourceBinPath)} "$@"
    exit $?
  fi

  if command -v corepack >/dev/null 2>&1; then
    run_supervised env SETUP_PROGRAM_NAME=${quoteShellArgument(shimName)} corepack pnpm --dir ${quoteShellArgument(repoRoot)} exec tsx ${quoteShellArgument(cliSourceBinPath)} "$@"
    exit $?
  fi
fi

printf '%s\n' 'Murph CLI build output is unavailable. Run \`pnpm --dir <repo> build\` or \`pnpm --dir <repo> chat\` from the repo checkout.' >&2
exit 1
`
}

function resolveRepoCliSourceBinPath(cliBinPath: string): string {
  return path.resolve(path.dirname(cliBinPath), '..', 'src', 'bin.ts')
}

function resolveRepoRootFromCliBinPath(cliBinPath: string): string {
  return path.resolve(path.dirname(cliBinPath), '..', '..', '..')
}

function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`
}

export async function hasNonEmptyFile(
  absolutePath: string,
  fileExists: (absolutePath: string) => Promise<boolean>,
): Promise<boolean> {
  if (!(await fileExists(absolutePath))) {
    return false
  }

  const fileStat = await stat(absolutePath)
  return fileStat.isFile() && fileStat.size > 0
}
