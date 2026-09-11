import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  buildAssistantRealCodexListArgs,
  buildAssistantRealCodexRunEnv,
  buildAssistantRealCodexVitestArgs,
  parseAssistantRealCodexRunArgs,
  requireSingleAssistantRealCodexTest,
} from './run-assistant-real-codex-e2e.ts'

export const ASSISTANT_REAL_MODEL_GATE_MODEL = 'gpt-5.6-terra'
export const ASSISTANT_REAL_MODEL_GATE_SCENARIOS = [
  'real model canonical meal persists across assistant restart',
  'real model canonical reminder create fire and cancel',
  'real model group privacy and quiet boundary',
] as const
const SCENARIO_TIMEOUT_MS = 12 * 60_000
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url))

export interface RealModelGateCommand {
  args: string[]
  env: NodeJS.ProcessEnv
  capture: boolean
  timeoutMs: number
}

interface GateDependencies {
  sourceEnv: NodeJS.ProcessEnv
  reportDirectory: string
  runCommand: (request: RealModelGateCommand) => {
    status: number | null
    stdout?: string
    error?: Error
  }
  readReport: (reportPath: string) => string
  writeStdout: (message: string) => void
}

interface ScenarioEvidence {
  name: typeof ASSISTANT_REAL_MODEL_GATE_SCENARIOS[number]
  status: 'not_run' | 'passed' | 'failed'
  failure?: 'selection_failed' | 'process_failed' | 'report_failed'
}

export interface RealModelGateEvidence {
  schemaVersion: 1
  sha: string
  model: typeof ASSISTANT_REAL_MODEL_GATE_MODEL
  provider: 'openai-env'
  configuredTransport: 'responses-websocket-enabled'
  runId: string
  runAttempt: string
  scenarioTimeoutMs: number
  scenarios: ScenarioEvidence[]
  success: boolean
}

export function requireRealModelGateEnvironment(env: NodeJS.ProcessEnv): void {
  if (
    env.CI !== 'true' || env.GITHUB_ACTIONS !== 'true'
    || env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_REF_PROTECTED !== 'true'
    || !['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME ?? '')
  ) {
    throw new Error('Real-model gate requires a protected main push or main workflow dispatch.')
  }
  if (
    !/^[a-f0-9]{40}$/u.test(env.GITHUB_SHA ?? '')
    || !/^\d+$/u.test(env.GITHUB_RUN_ID ?? '')
    || !/^[1-9]\d*$/u.test(env.GITHUB_RUN_ATTEMPT ?? '')
  ) {
    throw new Error('Real-model gate requires exact GitHub run and commit metadata.')
  }
  if (env.MURPH_ASSISTANT_REAL_MODEL_SANDBOX !== '1' || !env.OPENAI_API_KEY?.trim()) {
    throw new Error('Configure the dedicated assistant-real-model-sandbox provider key before running this gate.')
  }
}

export function buildRealModelGateEnv(sourceEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // The test harness further limits the provider subprocess environment and
  // creates an isolated Codex home. No other vendor or GitHub credentials enter it.
  const env: NodeJS.ProcessEnv = {}
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE']) {
    if (sourceEnv[key]) env[key] = sourceEnv[key]
  }
  env.CI = 'true'
  env.OPENAI_API_KEY = sourceEnv.OPENAI_API_KEY
  env.MURPH_REAL_CODEX_MODEL_PROVIDER = 'openai-env'
  env.MURPH_REAL_CODEX_PROVIDER_ENV_KEY = 'OPENAI_API_KEY'
  return buildAssistantRealCodexRunEnv({
    options: parseAssistantRealCodexRunArgs([
      '--auth', 'provider', '--model', ASSISTANT_REAL_MODEL_GATE_MODEL,
      '--test', ASSISTANT_REAL_MODEL_GATE_SCENARIOS[0],
    ]),
    sourceEnv: env,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function requirePassedRealModelReport(reportText: string, fullTestName: string): void {
  const report: unknown = JSON.parse(reportText)
  if (
    !isRecord(report) || report.success !== true || report.numPassedTests !== 1
    || report.numFailedTests !== 0 || report.numFailedTestSuites !== 0
    || !Array.isArray(report.testResults) || report.testResults.length !== 1
  ) {
    throw new Error('Expected one successful executed live journey in the Vitest report.')
  }
  const file: unknown = report.testResults[0]
  if (!isRecord(file) || file.status !== 'passed' || !Array.isArray(file.assertionResults)) {
    throw new Error('Expected a successful test file with assertion results.')
  }
  const expectedName = fullTestName.replaceAll(' > ', ' ')
  const assertions: unknown[] = file.assertionResults
  const selected = assertions.filter((entry) => isRecord(entry) && entry.fullName === expectedName)
  if (selected.length !== 1 || !isRecord(selected[0]) || selected[0].status !== 'passed') {
    throw new Error('The selected live journey did not execute and pass exactly once.')
  }
  if (assertions.some((entry) => (
    !isRecord(entry) || (entry.fullName !== expectedName
      && !['skipped', 'pending', 'todo', 'disabled'].includes(String(entry.status)))
  ))) {
    throw new Error('The focused live run executed an unexpected journey.')
  }
}

export function executeRealModelGate(dependencies: GateDependencies): RealModelGateEvidence {
  const { sourceEnv } = dependencies
  requireRealModelGateEnvironment(sourceEnv)
  const evidence: RealModelGateEvidence = {
    schemaVersion: 1,
    sha: sourceEnv.GITHUB_SHA!,
    model: ASSISTANT_REAL_MODEL_GATE_MODEL,
    provider: 'openai-env',
    configuredTransport: 'responses-websocket-enabled',
    runId: sourceEnv.GITHUB_RUN_ID!,
    runAttempt: sourceEnv.GITHUB_RUN_ATTEMPT!,
    scenarioTimeoutMs: SCENARIO_TIMEOUT_MS,
    scenarios: ASSISTANT_REAL_MODEL_GATE_SCENARIOS.map((name) => ({ name, status: 'not_run' })),
    success: false,
  }
  const env = buildRealModelGateEnv(sourceEnv)
  const fullNames: string[] = []
  // Complete every selection preflight before the first paid run.
  for (const scenario of evidence.scenarios) {
    try {
      const listed = dependencies.runCommand({
        args: buildAssistantRealCodexListArgs(`${scenario.name}$`),
        env, capture: true, timeoutMs: 60_000,
      })
      if (listed.error || listed.status !== 0) throw new Error('Enumeration failed.')
      const fullName = requireSingleAssistantRealCodexTest(listed.stdout ?? '')
      if (fullName.split(' > ').at(-1) !== scenario.name) throw new Error('Title mismatch.')
      fullNames.push(fullName)
    } catch {
      scenario.status = 'failed'
      scenario.failure = 'selection_failed'
      return evidence
    }
  }
  for (const [index, scenario] of evidence.scenarios.entries()) {
    const fullName = fullNames[index]!
    const reportPath = path.join(dependencies.reportDirectory, `scenario-${index}.json`)
    dependencies.writeStdout(`Running scenario ${index + 1}/${evidence.scenarios.length}: ${scenario.name}\n`)
    const result = dependencies.runCommand({
      args: [
        ...buildAssistantRealCodexVitestArgs(fullName),
        '--reporter=json', `--outputFile=${reportPath}`,
        '--retry=0', '--bail=1', '--maxWorkers=1', '--maxConcurrency=1',
        '--fileParallelism=false', '--testTimeout=600000', '--hookTimeout=60000',
      ],
      env, capture: false, timeoutMs: SCENARIO_TIMEOUT_MS,
    })
    if (result.error || result.status !== 0) {
      scenario.status = 'failed'
      scenario.failure = 'process_failed'
      return evidence
    }
    try {
      requirePassedRealModelReport(dependencies.readReport(reportPath), fullName)
      scenario.status = 'passed'
    } catch {
      scenario.status = 'failed'
      scenario.failure = 'report_failed'
      return evidence
    }
  }
  evidence.success = true
  return evidence
}

function runGateCommand(request: RealModelGateCommand) {
  // GNU timeout owns a separate process group. After Vitest's earlier test and
  // hook deadlines allow normal cleanup, this outer deadline stops only that
  // owned group, including Codex descendants, without a process-name search.
  const child = spawnSync('timeout', [
    '--signal=KILL', `${request.timeoutMs / 1000}s`, 'pnpm', ...request.args,
  ], {
    cwd: REPO_ROOT,
    env: request.env,
    encoding: 'utf8',
    stdio: request.capture ? ['ignore', 'pipe', 'pipe'] : 'ignore',
    maxBuffer: 1024 * 1024,
  })
  return { status: child.status, error: child.error, stdout: child.stdout ?? undefined }
}

function main(): void {
  const evidenceDirectory = path.join(REPO_ROOT, '.tmp', 'assistant-real-model')
  const evidencePath = path.join(evidenceDirectory, 'metadata.json')
  // A failed configuration check must never leave an earlier successful receipt.
  rmSync(evidencePath, { force: true })
  let reportDirectory: string | undefined
  try {
    requireRealModelGateEnvironment(process.env)
    reportDirectory = mkdtempSync(path.join(tmpdir(), 'murph-real-model-report-'))
    const evidence = executeRealModelGate({
      sourceEnv: process.env,
      reportDirectory,
      runCommand: runGateCommand,
      readReport: (reportPath) => readFileSync(reportPath, 'utf8'),
      writeStdout: (message) => process.stdout.write(message),
    })
    mkdirSync(evidenceDirectory, { recursive: true })
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
    process.stdout.write(`Real-model gate ${evidence.success ? 'passed' : 'failed'}; see metadata for scenario status.\n`)
    process.exitCode = evidence.success ? 0 : 1
  } catch {
    process.stderr.write('Real-model gate failed before completion. Check protected-main sandbox configuration and runner preparation.\n')
    process.exitCode = 1
  } finally {
    if (reportDirectory) rmSync(reportDirectory, { recursive: true, force: true })
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main()
