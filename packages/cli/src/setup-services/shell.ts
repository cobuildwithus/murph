import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SetupStepResult } from '../setup-cli-contracts.js'
import { createStep, DEFAULT_USER_BIN_DIRECTORY } from './steps.js'
import { defaultFileExists, isExecutable } from './process.js'

const HEALTHYBOB_PATH_BLOCK_BEGIN = '# >>> Healthy Bob PATH >>>'
const HEALTHYBOB_PATH_BLOCK_END = '# <<< Healthy Bob PATH <<<'

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
      name: 'healthybob',
      path: path.join(userBinDirectory, 'healthybob'),
    },
    {
      name: 'vault-cli',
      path: path.join(userBinDirectory, 'vault-cli'),
    },
  ]
  const pathPresent = pathIncludesSegment(input.env.PATH, userBinDirectory)
  const pathBlockStatus = pathPresent
    ? 'reused'
    : await readPathBlockStatus(shellProfilePath, input.fileExists)
  const shimsReady = await Promise.all(
    shimSpecs.map(async (shim) => {
      return await hasInstalledShim({
        cliBinPath: input.cliBinPath,
        fileExists: input.fileExists,
        shimPath: shim.path,
      })
    }),
  )
  const hasAllShims = shimsReady.every(Boolean)

  if (input.dryRun) {
    const status =
      hasAllShims && (pathPresent || pathBlockStatus === 'reused')
        ? 'reused'
        : 'planned'
    const detail = hasAllShims && (pathPresent || pathBlockStatus === 'reused')
      ? `Reusing Healthy Bob CLI shims from ${userBinDirectory}.`
      : pathPresent
        ? `Would install Healthy Bob CLI shims in ${userBinDirectory}.`
        : `Would install Healthy Bob CLI shims in ${userBinDirectory} and add ${userBinDirectory} to PATH via ${shellProfilePath}.`

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
      shimPath: shim.path,
    })
    wroteShim = wroteShim || changed
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
    ? `${status === 'completed' ? 'Installed' : 'Reusing'} Healthy Bob CLI shims from ${userBinDirectory}.`
    : `${status === 'completed' ? 'Installed' : 'Reusing'} Healthy Bob CLI shims from ${userBinDirectory} and ${pathUpdated ? 'added that directory to' : 'confirmed it is managed in'} ${shellProfilePath}.`

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
  return hasHealthyBobPathBlock(contents) ? 'reused' : 'missing'
}

async function hasInstalledShim(input: {
  cliBinPath: string
  fileExists: (absolutePath: string) => Promise<boolean>
  shimPath: string
}): Promise<boolean> {
  if (!(await input.fileExists(input.shimPath))) {
    return false
  }

  const contents = await readFile(input.shimPath, 'utf8')
  if (contents !== buildCliShimScript(input.cliBinPath)) {
    return false
  }

  return await isExecutable(input.shimPath)
}

async function writeCliShim(input: {
  cliBinPath: string
  shimPath: string
}): Promise<boolean> {
  const nextContents = buildCliShimScript(input.cliBinPath)
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
    if (hasHealthyBobPathBlock(existing)) {
      return false
    }
  }

  const nextContents = `${existing}${existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''}${buildHealthyBobPathBlock()}`
  await writeFile(profilePath, nextContents, 'utf8')
  return true
}

function hasHealthyBobPathBlock(contents: string): boolean {
  return (
    contents.includes(HEALTHYBOB_PATH_BLOCK_BEGIN) &&
    contents.includes(HEALTHYBOB_PATH_BLOCK_END)
  )
}

function buildHealthyBobPathBlock(): string {
  return `${HEALTHYBOB_PATH_BLOCK_BEGIN}
export PATH="$HOME/.local/bin:$PATH"
${HEALTHYBOB_PATH_BLOCK_END}
`
}

function buildCliShimScript(cliBinPath: string): string {
  const cliSourceBinPath = resolveRepoCliSourceBinPath(cliBinPath)
  const repoRoot = resolveRepoRootFromCliBinPath(cliBinPath)
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

  return `#!/usr/bin/env bash
set -euo pipefail

if [ -f ${quoteShellArgument(cliBinPath)} ]; then
  missing_packages=()
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

  exec node ${quoteShellArgument(cliBinPath)} "$@"
fi

if [ -f ${quoteShellArgument(cliSourceBinPath)} ]; then
  if command -v pnpm >/dev/null 2>&1; then
    exec pnpm --dir ${quoteShellArgument(repoRoot)} exec tsx ${quoteShellArgument(cliSourceBinPath)} "$@"
  fi

  if command -v corepack >/dev/null 2>&1; then
    exec corepack pnpm --dir ${quoteShellArgument(repoRoot)} exec tsx ${quoteShellArgument(cliSourceBinPath)} "$@"
  fi
fi

printf '%s\n' 'Healthy Bob CLI build output is unavailable. Run \`pnpm --dir <repo> build\` or \`pnpm --dir <repo> chat\` from the repo checkout.' >&2
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
