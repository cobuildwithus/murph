import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

export interface CliSuccessEnvelope<TData = Record<string, unknown>> {
  ok: true
  data: TData
  meta: {
    cta?: {
      description?: string
      commands: Array<{
        command: string
        description?: string
      }>
    }
    command: string
    duration: string
  }
}

export interface CliErrorEnvelope {
  ok: false
  error: {
    code?: string
    message?: string
    retryable?: boolean
  }
  meta: {
    cta?: {
      description?: string
      commands: Array<{
        command: string
        description?: string
      }>
    }
    command: string
    duration: string
  }
}

export type CliEnvelope<TData = Record<string, unknown>> =
  | CliSuccessEnvelope<TData>
  | CliErrorEnvelope

export const packageDir = fileURLToPath(new URL('../', import.meta.url))
export const repoRoot = path.resolve(packageDir, '../..')
export const binPath = path.join(packageDir, 'dist/bin.js')
const cliIndexPath = path.join(packageDir, 'dist/index.js')
const CLI_MAX_OUTPUT_BUFFER_BYTES = 8 * 1024 * 1024
const CLI_RUNTIME_ARTIFACT_WAIT_TIMEOUT_MS = 15_000
const CLI_RUNTIME_ARTIFACT_WAIT_INTERVAL_MS = 100
const CLI_RUNTIME_ARTIFACT_REPAIR_LOCK_WAIT_TIMEOUT_MS = 60_000
const CLI_RUNTIME_ARTIFACT_REPAIR_LOCK_STALE_MS = 10 * 60_000
const forwardedCliEnvKeys = [
  'CI',
  'COLORTERM',
  'FORCE_COLOR',
  'HOME',
  'LANG',
  'NODE_ENV',
  'NO_COLOR',
  'PATH',
  'SHELL',
  'SYSTEMROOT',
  'TERM',
  'TMP',
  'TMPDIR',
  'TZ',
  'VAULT',
] as const
const requiredRuntimeArtifactPaths = [
  path.join(repoRoot, 'packages/contracts/dist/index.js'),
  path.join(repoRoot, 'packages/contracts/dist/index.d.ts'),
  path.join(repoRoot, 'packages/contracts/dist/command-capabilities.js'),
  path.join(repoRoot, 'packages/contracts/dist/command-capabilities.d.ts'),
  path.join(repoRoot, 'packages/hosted-execution/dist/index.js'),
  path.join(repoRoot, 'packages/hosted-execution/dist/index.d.ts'),
  path.join(repoRoot, 'packages/runtime-state/dist/index.js'),
  path.join(repoRoot, 'packages/runtime-state/dist/index.d.ts'),
  path.join(repoRoot, 'packages/core/dist/index.js'),
  path.join(repoRoot, 'packages/core/dist/index.d.ts'),
  path.join(repoRoot, 'packages/importers/dist/index.js'),
  path.join(repoRoot, 'packages/importers/dist/index.d.ts'),
  path.join(repoRoot, 'packages/importers/dist/core-port.js'),
  path.join(repoRoot, 'packages/importers/dist/core-port.d.ts'),
  path.join(repoRoot, 'packages/device-syncd/dist/index.js'),
  path.join(repoRoot, 'packages/device-syncd/dist/index.d.ts'),
  path.join(repoRoot, 'packages/query/dist/index.js'),
  path.join(repoRoot, 'packages/query/dist/index.d.ts'),
  path.join(repoRoot, 'packages/inboxd/dist/index.js'),
  path.join(repoRoot, 'packages/inboxd/dist/index.d.ts'),
  path.join(repoRoot, 'packages/parsers/dist/index.js'),
  path.join(repoRoot, 'packages/parsers/dist/index.d.ts'),
  binPath,
  cliIndexPath,
  path.join(repoRoot, 'packages/cli/dist/cli-entry.js'),
  path.join(repoRoot, 'packages/cli/dist/vault-cli-contracts.js'),
  path.join(repoRoot, 'packages/cli/dist/inbox-cli-contracts.js'),
]
const importSmokeArtifactPaths = [
  ...requiredRuntimeArtifactPaths.filter((artifactPath) => artifactPath.endsWith('.js') && artifactPath !== binPath),
  path.join(repoRoot, 'packages/cli/dist/operator-config.js'),
  path.join(repoRoot, 'packages/cli/dist/setup-cli.js'),
  path.join(repoRoot, 'packages/cli/dist/setup-runtime-env.js'),
]
const cliRuntimeArtifactRepairLockPath = path.join(
  repoRoot,
  'node_modules',
  '.cache',
  'murph',
  'cli-runtime-artifacts.lock',
)
const PREPARED_CLI_RUNTIME_ARTIFACTS_ENV = 'MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS' as const
let cliRuntimeArtifactsVerified = false
const strippedTestRunnerEnvKeys = ['NODE_OPTIONS', 'VITEST'] as const
const strippedTestRunnerEnvPrefixes = ['VITEST_', 'C8_', 'NYC_'] as const
const CLI_PERSISTENT_HARNESS_ENV = 'MURPH_CLI_TEST_PERSISTENT_HARNESS' as const
const CLI_PERSISTENT_HARNESS_DEFAULT_POOL_SIZE = 2
const cliCommandHarnessPath = path.join(repoRoot, 'scripts', 'cli-command-harness.mjs')
const cliCommandHarnessCleanupCallbacks = new Set<() => void>()
let cliCommandHarnessPoolPromise: Promise<CliCommandHarnessPool> | null = null
let cliCommandHarnessProcessExitCleanupInstalled = false

interface PersistentCliHarnessRequest {
  args: string[]
  env: NodeJS.ProcessEnv
}

interface PersistentCliHarnessSuccess {
  id: number
  ok: true
  stdout: string
  stderr: string
}

interface PersistentCliHarnessFailure {
  id: number
  ok: false
  stdout: string
  stderr: string
  errorMessage: string
}

type PersistentCliHarnessResponse =
  | PersistentCliHarnessSuccess
  | PersistentCliHarnessFailure

type PendingCliHarnessRequest = {
  reject: (error: Error) => void
  resolve: (response: PersistentCliHarnessResponse) => void
}

interface CliCommandHarness {
  readonly isClosed: boolean
  readonly pendingRequests: number
  run(input: PersistentCliHarnessRequest): Promise<PersistentCliHarnessResponse>
}

interface CliCommandHarnessPool {
  run(input: PersistentCliHarnessRequest): Promise<PersistentCliHarnessResponse>
}

export type CliProcessExecutionMode = 'harness' | 'isolated'

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined
  }

  switch (value.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return false
    default:
      return undefined
  }
}

function shouldUsePersistentCliHarness(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return parseBooleanEnv(env[CLI_PERSISTENT_HARNESS_ENV]) ?? true
}

export function resolveCliProcessExecutionMode(options?: {
  env?: NodeJS.ProcessEnv
  stdin?: string
}): CliProcessExecutionMode {
  if (options?.stdin !== undefined) {
    return 'isolated'
  }

  const harnessControlEnv = {
    ...process.env,
    ...options?.env,
  }

  return shouldUsePersistentCliHarness(harnessControlEnv) ? 'harness' : 'isolated'
}

function withoutVitestRuntimeEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const nextEnv = { ...env }

  for (const key of strippedTestRunnerEnvKeys) {
    delete nextEnv[key]
  }

  for (const key of Object.keys(nextEnv)) {
    if (strippedTestRunnerEnvPrefixes.some((prefix) => key.startsWith(prefix))) {
      delete nextEnv[key]
    }
  }

  return nextEnv
}

export function withoutNodeV8Coverage(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const nextEnv = withoutVitestRuntimeEnv(env)
  delete nextEnv.NODE_V8_COVERAGE

  return nextEnv
}

function selectCliBaseEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = {}

  for (const key of forwardedCliEnvKeys) {
    const value = env[key]
    if (value !== undefined) {
      nextEnv[key] = value
    }
  }

  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('LC_') && value !== undefined) {
      nextEnv[key] = value
    }
  }

  return nextEnv
}

export async function runCli<TData = Record<string, unknown>>(
  args: string[],
  options?: {
    env?: NodeJS.ProcessEnv
    stdin?: string
  },
): Promise<CliEnvelope<TData>> {
  return runCliAttempt(args, options, true)
}

async function runCliAttempt<TData = Record<string, unknown>>(
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv
    stdin?: string
  } | undefined,
  allowRetry: boolean,
): Promise<CliEnvelope<TData>> {
  try {
    const { stdout } = await execCli(withMachineOutput(args), options)
    const result = JSON.parse(stdout) as CliEnvelope<TData>

    if (allowRetry && shouldRetryCliEnvelope(result) && (await waitForCliRuntimeArtifacts())) {
      return runCliAttempt(args, options, false)
    }

    return result
  } catch (error) {
    const output = commandOutputFromError(error)
    if (allowRetry && shouldRetryCliExecution(error) && (await waitForCliRuntimeArtifacts())) {
      return runCliAttempt(args, options, false)
    }
    if (output !== null) {
      try {
        return JSON.parse(output) as CliEnvelope<TData>
      } catch {
        throw new Error(`CLI command failed before emitting JSON:\n${output}`)
      }
    }

    throw error
  }
}

export async function runRawCli(
  args: string[],
  options?: {
    env?: NodeJS.ProcessEnv
    stdin?: string
  },
): Promise<string> {
  return runRawCliAttempt(args, options, true)
}

async function runRawCliAttempt(
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv
    stdin?: string
  } | undefined,
  allowRetry: boolean,
): Promise<string> {
  try {
    const { stdout } = await execCli(args, options)

    return stdout.trim()
  } catch (error) {
    if (allowRetry && shouldRetryCliExecution(error) && (await waitForCliRuntimeArtifacts())) {
      return runRawCliAttempt(args, options, false)
    }

    const output = commandOutputFromError(error)
    if (output !== null) {
      return output
    }

    throw error
  }
}

export function requireData<TData>(result: CliEnvelope<TData>): TData {
  if (!result.ok) {
    throw new Error(
      `CLI result failed: ${result.error.message ?? result.error.code ?? 'unknown error'}`,
    )
  }

  return result.data
}

export function commandOutputFromError(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null
  }

  const maybeOutput = error as {
    stdout?: Buffer | string
    stderr?: Buffer | string
  }

  return decodeCommandOutput(maybeOutput.stdout) ?? decodeCommandOutput(maybeOutput.stderr)
}

export async function ensureCliRuntimeArtifacts(): Promise<void> {
  return ensureCliRuntimeArtifactsWithOptions()
}

export async function ensureCliRuntimeArtifactsWithOptions(options?: {
  forceReverify?: boolean
}): Promise<void> {
  if (
    options?.forceReverify !== true &&
    process.env[PREPARED_CLI_RUNTIME_ARTIFACTS_ENV] === '1' &&
    requiredRuntimeArtifactPaths.every((artifactPath) => existsSync(artifactPath))
  ) {
    cliRuntimeArtifactsVerified = true
    return
  }

  if (
    options?.forceReverify !== true &&
    cliRuntimeArtifactsVerified &&
    requiredRuntimeArtifactPaths.every((artifactPath) => existsSync(artifactPath))
  ) {
    return
  }

  if (await verifyCliRuntimeArtifacts()) {
    return
  }

  await withCliRuntimeArtifactRepairLock(async () => {
    if (await verifyCliRuntimeArtifacts()) {
      return
    }

    await rebuildCliRuntimeArtifacts()

    if (await verifyCliRuntimeArtifacts()) {
      return
    }

    throw createMissingRuntimeArtifactsError()
  })
}

export async function rebuildCliRuntimeArtifacts(): Promise<void> {
  await execWorkspaceCommand(['build:test-runtime:prepared'], { retryOnce: true })

  await execWorkspaceCommand([
    'exec',
    'tsx',
    'packages/cli/scripts/verify-package-shape.ts',
  ])
}

function decodeCommandOutput(output: Buffer | string | undefined): string | null {
  if (typeof output === 'string') {
    return output.trim().length > 0 ? output : null
  }

  if (Buffer.isBuffer(output)) {
    const text = output.toString('utf8').trim()
    return text.length > 0 ? text : null
  }

  return null
}

function withMachineOutput(args: string[]): string[] {
  const nextArgs = [...args]

  if (!nextArgs.includes('--verbose')) {
    nextArgs.push('--verbose')
  }

  if (!nextArgs.includes('--json') && !nextArgs.includes('--format')) {
    nextArgs.push('--format', 'json')
  }

  return nextArgs
}

async function execCli(
  args: string[],
  options?: {
    env?: NodeJS.ProcessEnv
    stdin?: string
  }
) {
  await ensureCliRuntimeArtifacts()

  try {
    return await execCliProcess(args, options)
  } catch (error) {
    if (shouldRetryCliExecution(error) && (await waitForCliRuntimeArtifacts())) {
      return await execCliProcess(args, options)
    }

    throw error
  }
}

async function execCliProcess(
  args: string[],
  options?: {
    env?: NodeJS.ProcessEnv
    stdin?: string
  },
) {
  const commandEnv = buildCliExecutionEnv(options?.env)

  if (resolveCliProcessExecutionMode(options) === 'harness') {
    return execCliProcessThroughHarness(args, commandEnv)
  }

  return execCliProcessIsolated(args, {
    env: commandEnv,
    stdin: options?.stdin,
  })
}

function buildCliExecutionEnv(
  env: NodeJS.ProcessEnv | undefined,
): NodeJS.ProcessEnv {
  return withoutNodeV8Coverage({
    ...selectCliBaseEnv(),
    ...env,
  })
}

async function execCliProcessThroughHarness(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  const harnessPool = await getCliCommandHarnessPool()
  const response = await harnessPool.run({
    args: [...args],
    env,
  })

  if (response.ok) {
    return {
      stdout: response.stdout,
      stderr: response.stderr,
    }
  }

  const error = new Error(response.errorMessage)
  Object.assign(error, {
    stderr: response.stderr,
    stdout: response.stdout,
  })
  throw error
}

async function execCliProcessIsolated(
  args: string[],
  options: {
    env: NodeJS.ProcessEnv
    stdin?: string
  },
): Promise<{ stdout: string; stderr: string }> {
  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [binPath, ...args],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: options.env,
        maxBuffer: CLI_MAX_OUTPUT_BUFFER_BYTES,
      },
      (error, stdout, stderr) => {
        if (error) {
          Object.assign(error, { stderr, stdout })
          reject(error)
          return
        }

        resolve({ stdout, stderr })
      },
    )

    child.stdin?.end(options.stdin)
  })
}

async function getCliCommandHarnessPool(
): Promise<CliCommandHarnessPool> {
  if (!cliCommandHarnessPoolPromise) {
    cliCommandHarnessPoolPromise = createCliCommandHarnessPool().catch((error) => {
      cliCommandHarnessPoolPromise = null
      throw error
    })
  }

  return cliCommandHarnessPoolPromise
}

async function createCliCommandHarnessPool(
): Promise<CliCommandHarnessPool> {
  const harnessCount = CLI_PERSISTENT_HARNESS_DEFAULT_POOL_SIZE
  const harnesses = await Promise.all(
    Array.from({ length: harnessCount }, () => createCliCommandHarness()),
  )

  return {
    async run(input) {
      const availableHarnesses = harnesses.filter((harness) => !harness.isClosed)
      const harness =
        availableHarnesses.length > 0
          ? availableHarnesses.reduce((best, candidate) =>
              candidate.pendingRequests < best.pendingRequests ? candidate : best,
            )
          : await createCliCommandHarness()

      if (availableHarnesses.length === 0) {
        harnesses.push(harness)
      }

      return harness.run(input)
    },
  }
}

async function createCliCommandHarness(): Promise<CliCommandHarness> {
  installCliCommandHarnessProcessExitCleanup()

  const child = spawn(process.execPath, [cliCommandHarnessPath], {
    cwd: repoRoot,
    env: withoutNodeV8Coverage(selectCliBaseEnv()),
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  if (!child.stdin || !child.stdout || !child.stderr) {
    throw createCliCommandHarnessError(
      'Persistent CLI harness did not expose all stdio pipes.',
    )
  }

  const childStdin = child.stdin
  const childStdout = child.stdout
  const childStderr = child.stderr
  let nextRequestId = 1
  let pendingRequests = 0
  let stderrOutput = ''
  let isClosed = false
  const pending = new Map<number, PendingCliHarnessRequest>()

  const unregisterChildCleanup = registerCliCommandHarnessChild(child)

  childStderr.setEncoding('utf8')
  childStderr.on('data', (chunk: string) => {
    stderrOutput += chunk
    if (stderrOutput.length > 24_000) {
      stderrOutput = stderrOutput.slice(-24_000)
    }
  })

  const lines = createInterface({
    input: childStdout,
    crlfDelay: Infinity,
  })

  const rejectPending = (error: Error) => {
    for (const [requestId, callbacks] of pending) {
      pending.delete(requestId)
      pendingRequests -= 1
      callbacks.reject(error)
    }
  }

  lines.on('line', (line) => {
    if (line.trim().length === 0) {
      return
    }

    let response: PersistentCliHarnessResponse

    try {
      response = JSON.parse(line) as PersistentCliHarnessResponse
    } catch (error) {
      const protocolError = createCliCommandHarnessError(
        `Persistent CLI harness emitted invalid JSON: ${formatHarnessError(error)}${formatHarnessStderr(stderrOutput)}`,
      )
      rejectPending(protocolError)
      child.kill()
      return
    }

    const callbacks = pending.get(response.id)
    if (!callbacks) {
      return
    }

    pending.delete(response.id)
    pendingRequests -= 1
    callbacks.resolve(response)
  })

  child.once('error', (error) => {
    isClosed = true
    unregisterChildCleanup()
    rejectPending(
      createCliCommandHarnessError(
        `Persistent CLI harness failed to start: ${formatHarnessError(error)}${formatHarnessStderr(stderrOutput)}`,
      ),
    )
  })

  child.once('exit', (code, signal) => {
    isClosed = true
    unregisterChildCleanup()
    const suffix =
      code !== null
        ? `exited with code ${code}`
        : `terminated by signal ${signal ?? 'unknown'}`
    rejectPending(
      createCliCommandHarnessError(
        `Persistent CLI harness ${suffix}.${formatHarnessStderr(stderrOutput)}`,
      ),
    )
  })

  return {
    get isClosed() {
      return isClosed
    },
    get pendingRequests() {
      return pendingRequests
    },
    async run(input) {
      if (isClosed) {
        throw createCliCommandHarnessError(
          `Persistent CLI harness is unavailable.${formatHarnessStderr(stderrOutput)}`,
        )
      }

      return await new Promise<PersistentCliHarnessResponse>((resolve, reject) => {
        const requestId = nextRequestId
        nextRequestId += 1
        pendingRequests += 1
        pending.set(requestId, { reject, resolve })

        const payload = JSON.stringify({
          id: requestId,
          args: input.args,
          env: input.env,
        })

        childStdin.write(`${payload}\n`, 'utf8', (error) => {
          if (!error) {
            return
          }

          pending.delete(requestId)
          pendingRequests -= 1
          reject(
            createCliCommandHarnessError(
              `Persistent CLI harness request write failed: ${formatHarnessError(error)}${formatHarnessStderr(stderrOutput)}`,
            ),
          )
        })
      })
    },
  }
}

function installCliCommandHarnessProcessExitCleanup(): void {
  if (cliCommandHarnessProcessExitCleanupInstalled) {
    return
  }

  cliCommandHarnessProcessExitCleanupInstalled = true

  const cleanup = () => {
    for (const callback of cliCommandHarnessCleanupCallbacks) {
      callback()
    }

    cliCommandHarnessCleanupCallbacks.clear()
  }

  process.once('exit', cleanup)
}

function registerCliCommandHarnessChild(
  child: ReturnType<typeof spawn>,
): () => void {
  const cleanup = () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill()
    }
  }

  cliCommandHarnessCleanupCallbacks.add(cleanup)

  child.unref()
  ;(child.stdin as (typeof child.stdin & { unref?: () => void }) | null)?.unref?.()
  ;(child.stdout as (typeof child.stdout & { unref?: () => void }) | null)?.unref?.()
  ;(child.stderr as (typeof child.stderr & { unref?: () => void }) | null)?.unref?.()

  return () => {
    cliCommandHarnessCleanupCallbacks.delete(cleanup)
  }
}

function createCliCommandHarnessError(message: string): Error {
  const error = new Error(message)
  error.name = 'CliCommandHarnessError'
  return error
}

function formatHarnessError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message
  }

  return typeof error === 'string' ? error : String(error)
}

function formatHarnessStderr(stderrOutput: string): string {
  return stderrOutput.trim().length > 0 ? `\n${stderrOutput.trim()}` : ''
}

async function verifyCliRuntimeArtifacts(): Promise<boolean> {
  if (!requiredRuntimeArtifactPaths.every((artifactPath) => existsSync(artifactPath))) {
    cliRuntimeArtifactsVerified = false
    return false
  }

  cliRuntimeArtifactsVerified = (
    await Promise.all(importSmokeArtifactPaths.map((artifactPath) => canImportArtifact(artifactPath)))
  ).every(Boolean)
  return cliRuntimeArtifactsVerified
}

async function waitForCliRuntimeArtifacts(): Promise<boolean> {
  const deadline = Date.now() + CLI_RUNTIME_ARTIFACT_WAIT_TIMEOUT_MS

  while (Date.now() < deadline) {
    await sleep(CLI_RUNTIME_ARTIFACT_WAIT_INTERVAL_MS)

    if (await verifyCliRuntimeArtifacts()) {
      return true
    }
  }

  return false
}

function shouldRetryCliExecution(error: unknown): boolean {
  return isRetryableCliRuntimeArtifactError(commandOutputFromError(error))
}

function shouldRetryCliEnvelope(result: CliEnvelope<unknown>): boolean {
  if (result.ok) {
    return false
  }

  return isRetryableCliRuntimeArtifactError(result.error.message ?? result.error.code ?? null)
}

export function isRetryableCliRuntimeArtifactError(output: string | null): boolean {
  return shouldRetryCliOutput(output)
}

function shouldRetryCliOutput(output: string | null): boolean {
  if (output === null) {
    return false
  }

  const referencesBuiltWorkspaceArtifact =
    output.includes('/dist/') &&
    (output.includes('/packages/') || output.includes('/node_modules/@murph/'))
  const isMissingModuleError =
    output.includes('ERR_MODULE_NOT_FOUND') ||
    output.includes('Cannot find module') ||
    output.includes('Cannot find package') ||
    output.includes('ENOENT: no such file or directory')
  const isDistStartupFailure =
    referencesBuiltWorkspaceArtifact &&
    (output.includes('file://') ||
      output.includes('lstat ') ||
      output.includes('does not provide an export named') ||
      output.includes('SyntaxError:') ||
      output.includes('ReferenceError:'))

  return referencesBuiltWorkspaceArtifact && (isMissingModuleError || isDistStartupFailure)
}

function createMissingRuntimeArtifactsError(): Error {
  const missingArtifacts = requiredRuntimeArtifactPaths.filter(
    (artifactPath) => !existsSync(artifactPath),
  )
  const relativeMissingArtifacts = missingArtifacts.map((artifactPath) =>
    path.relative(repoRoot, artifactPath),
  )
  const detail =
    relativeMissingArtifacts.length > 0
      ? ` Missing artifacts: ${relativeMissingArtifacts.join(', ')}.`
      : ''

  return new Error(
    `Built CLI runtime artifacts are unavailable.${detail} Run \`pnpm build:test-runtime:prepared\` before invoking CLI integration tests.`,
  )
}

async function withCliRuntimeArtifactRepairLock(action: () => Promise<void>): Promise<void> {
  const deadline = Date.now() + CLI_RUNTIME_ARTIFACT_REPAIR_LOCK_WAIT_TIMEOUT_MS

  await mkdir(path.dirname(cliRuntimeArtifactRepairLockPath), { recursive: true })

  while (true) {
    try {
      await mkdir(cliRuntimeArtifactRepairLockPath)
    } catch (error) {
      if (!isDirectoryAlreadyExistsError(error)) {
        throw error
      }

      if (await verifyCliRuntimeArtifacts()) {
        return
      }

      if (await cleanupStaleCliRuntimeArtifactRepairLock()) {
        continue
      }

      if (Date.now() >= deadline) {
        throw new Error(
          'Timed out waiting for the CLI runtime artifact repair lock to clear.',
        )
      }

      await sleep(CLI_RUNTIME_ARTIFACT_WAIT_INTERVAL_MS)
      continue
    }

    try {
      await action()
      return
    } finally {
      await rm(cliRuntimeArtifactRepairLockPath, { recursive: true, force: true })
    }
  }
}

async function cleanupStaleCliRuntimeArtifactRepairLock(): Promise<boolean> {
  try {
    const lockStats = await stat(cliRuntimeArtifactRepairLockPath)

    if (Date.now() - lockStats.mtimeMs < CLI_RUNTIME_ARTIFACT_REPAIR_LOCK_STALE_MS) {
      return false
    }

    await rm(cliRuntimeArtifactRepairLockPath, { recursive: true, force: true })
    return true
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    ) {
      return false
    }

    throw error
  }
}

function isDirectoryAlreadyExistsError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'EEXIST'
  )
}

async function sleep(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs))
}

async function canImportArtifact(artifactPath: string): Promise<boolean> {
  if (!existsSync(artifactPath)) {
    return false
  }

  const artifactDir = path.dirname(artifactPath)
  const artifactSpecifier = `./${path.basename(artifactPath)}`

  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import(${JSON.stringify(artifactSpecifier)}).then(() => {}).catch((error) => { console.error(error); process.exitCode = 1 })`,
        ],
        {
          cwd: artifactDir,
          encoding: 'utf8',
          env: withoutNodeV8Coverage(selectCliBaseEnv()),
          maxBuffer: CLI_MAX_OUTPUT_BUFFER_BYTES,
        },
        (error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        },
      )
    })

    return true
  } catch {
    return false
  }
}

async function execWorkspaceCommand(
  args: string[],
  options?: {
    retryOnce?: boolean
  },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const run = (allowRetry: boolean) => {
      execFile(
        'pnpm',
        args,
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: withoutNodeV8Coverage(selectCliBaseEnv()),
          maxBuffer: CLI_MAX_OUTPUT_BUFFER_BYTES,
        },
        (error) => {
          if (error) {
            if (allowRetry) {
              run(false)
              return
            }

            reject(error)
            return
          }

          resolve()
        },
      )
    }

    run(options?.retryOnce === true)
  })
}
