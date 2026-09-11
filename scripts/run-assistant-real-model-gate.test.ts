import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_REAL_MODEL_GATE_MODEL,
  ASSISTANT_REAL_MODEL_GATE_SCENARIOS,
  buildRealModelGateEnv,
  executeRealModelGate,
  requirePassedRealModelReport,
  requireRealModelGateEnvironment,
  type RealModelGateCommand,
} from './run-assistant-real-model-gate.ts'

const sandboxEnv: NodeJS.ProcessEnv = {
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_REF_PROTECTED: 'true',
  GITHUB_SHA: 'a'.repeat(40),
  GITHUB_RUN_ID: '123',
  GITHUB_RUN_ATTEMPT: '1',
  MURPH_ASSISTANT_REAL_MODEL_SANDBOX: '1',
  OPENAI_API_KEY: 'synthetic-provider-key',
}

function successfulReport(fullName: string) {
  return {
    success: true,
    numPassedTests: 1,
    numFailedTests: 0,
    numFailedTestSuites: 0,
    testResults: [{
      status: 'passed',
      assertionResults: [{ fullName: fullName.replaceAll(' > ', ' '), status: 'passed' }],
    }],
  }
}

describe('protected real-model gate admission', () => {
  it.each([
    { OPENAI_API_KEY: '' },
    { MURPH_ASSISTANT_REAL_MODEL_SANDBOX: undefined },
    { CI: undefined },
    { GITHUB_ACTIONS: undefined },
    { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_EVENT_NAME: 'pull_request_target' },
    { GITHUB_REF: 'refs/heads/feature', GITHUB_EVENT_NAME: 'workflow_dispatch' },
    { GITHUB_REF_PROTECTED: 'false' },
    { GITHUB_SHA: 'not-a-commit' },
    { GITHUB_RUN_ID: 'invalid' },
    { GITHUB_RUN_ATTEMPT: '0' },
  ])('fails before any subprocess for missing sandbox or untrusted context %j', (override) => {
    let calls = 0
    expect(() => executeRealModelGate({
      sourceEnv: { ...sandboxEnv, ...override }, reportDirectory: '/synthetic-reports',
      runCommand: () => { calls += 1; return { status: 0 } },
      readReport: () => '', writeStdout: () => undefined,
    })).toThrow()
    expect(calls).toBe(0)
  })

  it('admits a protected main manual run', () => {
    expect(() => requireRealModelGateEnvironment({
      ...sandboxEnv, GITHUB_EVENT_NAME: 'workflow_dispatch',
    })).not.toThrow()
  })

  it('forces the fixed provider and excludes ambient credentials and overrides', () => {
    const env = buildRealModelGateEnv({
      ...sandboxEnv,
      PATH: '/usr/bin',
      GITHUB_TOKEN: 'synthetic-github-key',
      VERCEL_AI_API_KEY: 'synthetic-other-provider-key',
      CODEX_HOME: '/synthetic-home',
      MURPH_REAL_CODEX_AUTH: 'subscription',
      MURPH_REAL_CODEX_MODEL: 'unapproved-model',
      MURPH_REAL_CODEX_MODEL_PROVIDER: 'vercel-ai-gateway',
      MURPH_REAL_CODEX_COMMAND: 'unapproved-command',
      MURPH_ASSISTANT_SKILLS_ROOT: '/synthetic-skills',
      NODE_OPTIONS: '--inspect',
    })
    expect(env).toMatchObject({
      CI: 'true', PATH: '/usr/bin', OPENAI_API_KEY: 'synthetic-provider-key',
      MURPH_RUN_REAL_CODEX_E2E: '1',
      MURPH_REAL_CODEX_MODEL: ASSISTANT_REAL_MODEL_GATE_MODEL,
      MURPH_REAL_CODEX_MODEL_PROVIDER: 'openai-env',
      MURPH_REAL_CODEX_PROVIDER_ENV_KEY: 'OPENAI_API_KEY',
    })
    for (const key of ['GITHUB_TOKEN', 'VERCEL_AI_API_KEY', 'CODEX_HOME', 'MURPH_REAL_CODEX_AUTH', 'MURPH_ASSISTANT_SKILLS_ROOT', 'NODE_OPTIONS']) {
      expect(env[key]).toBeUndefined()
    }
  })
})

describe('real-model workflow admission and required result', () => {
  async function readJob(name: string): Promise<string> {
    const source = await readFile(new URL('../.github/workflows/assistant-real-model.yml', import.meta.url), 'utf8')
    const job = source.split(`  ${name}:\n`)[1]?.split(/^  [a-z][a-z-]*:\n/mu)[0]
    expect(job).toBeDefined()
    return job!
  }

  async function runJobShell(name: string, env: NodeJS.ProcessEnv): Promise<number | null> {
    const job = await readJob(name)
    const runBlock = job.match(/^        run: \|\n((?: {10}[^\n]*\n|\n)+)/mu)?.[1]
    expect(runBlock).toBeDefined()
    const child = spawnSync('bash', ['-c', runBlock!.replace(/^ {10}/gmu, '')], {
      env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 5_000,
    })
    expect(child.error).toBeUndefined()
    return child.status
  }

  it('keeps admission and result checks credential-free and requires admission before the sandbox job', async () => {
    for (const name of ['admission', 'required']) {
      const job = await readJob(name)
      expect(job).toContain('permissions: {}')
      expect(job).not.toMatch(/environment:|secrets\.|uses:/u)
    }
    const live = await readJob('real-model')
    expect(live).toContain('needs: admission')
    expect(live).toContain("github.ref == 'refs/heads/main' && github.ref_protected")
    expect(live).toContain('ref: ${{ github.sha }}')
    const required = await readJob('required')
    expect(required).toContain('needs: [admission, real-model]')
    expect(required).toContain('if: ${{ always() }}')
  })

  it.each([
    { event: 'push', ref: 'refs/heads/main', protected: 'true', status: 0 },
    { event: 'workflow_dispatch', ref: 'refs/heads/main', protected: 'true', status: 0 },
    { event: 'workflow_dispatch', ref: 'refs/heads/feature', protected: 'true', status: 1 },
    { event: 'push', ref: 'refs/heads/main', protected: 'false', status: 1 },
    { event: 'pull_request', ref: 'refs/heads/main', protected: 'true', status: 1 },
    { event: 'pull_request_target', ref: 'refs/heads/main', protected: 'true', status: 1 },
  ])('executes admission policy for $event $ref protected=$protected', async (input) => {
    expect(await runJobShell('admission', {
      GITHUB_EVENT_NAME: input.event, GITHUB_REF: input.ref, GITHUB_REF_PROTECTED: input.protected,
    })).toBe(input.status)
  })

  it.each([
    { admission: 'success', live: 'success', status: 0 },
    { admission: 'failure', live: 'skipped', status: 1 },
    { admission: 'skipped', live: 'success', status: 1 },
    { admission: 'success', live: 'skipped', status: 1 },
    { admission: 'success', live: 'failure', status: 1 },
    { admission: 'success', live: 'cancelled', status: 1 },
  ])('requires actual live success for admission=$admission live=$live', async (input) => {
    expect(await runJobShell('required', {
      ADMISSION_RESULT: input.admission, LIVE_RESULT: input.live,
    })).toBe(input.status)
  })
})

describe('real-model gate execution evidence', () => {
  function harness(options: { invalidSelection?: boolean; failedProcess?: boolean; missingReport?: boolean } = {}) {
    const requests: RealModelGateCommand[] = []
    const messages: string[] = []
    const reports = new Map<string, string>()
    const evidence = executeRealModelGate({
      sourceEnv: sandboxEnv, reportDirectory: '/synthetic-reports',
      runCommand: (request) => {
        requests.push(request)
        if (request.capture) {
          const title = ASSISTANT_REAL_MODEL_GATE_SCENARIOS[requests.length - 1]
          return { status: 0, stdout: JSON.stringify(options.invalidSelection && requests.length === 3
            ? [] : [{ name: `real model acceptance > ${title}` }]) }
        }
        const index = requests.length - ASSISTANT_REAL_MODEL_GATE_SCENARIOS.length - 1
        const title = `real model acceptance > ${ASSISTANT_REAL_MODEL_GATE_SCENARIOS[index]}`
        const reportPath = request.args.find((value) => value.startsWith('--outputFile='))!.slice('--outputFile='.length)
        reports.set(reportPath, JSON.stringify(successfulReport(title)))
        return { status: options.failedProcess ? 1 : 0, stdout: 'private transcript must never be emitted' }
      },
      readReport: (reportPath) => {
        if (options.missingReport) throw new Error('private path must never be emitted')
        return reports.get(reportPath) ?? ''
      },
      writeStdout: (message) => messages.push(message),
    })
    return { evidence, requests, messages }
  }

  it('preflights every exact scenario then executes once each with bounded commands', () => {
    const { evidence, requests, messages } = harness()
    expect(requests.map((request) => request.capture)).toEqual([true, true, true, false, false, false])
    for (const request of requests.slice(3)) {
      expect(request.timeoutMs).toBe(720_000)
      expect(request.args).toEqual(expect.arrayContaining([
        '--retry=0', '--maxWorkers=1', '--maxConcurrency=1', '--reporter=json',
      ]))
    }
    expect(evidence).toMatchObject({ success: true, sha: sandboxEnv.GITHUB_SHA, model: ASSISTANT_REAL_MODEL_GATE_MODEL,
      provider: 'openai-env', configuredTransport: 'responses-websocket-enabled' })
    expect(evidence.scenarios.map(({ status }) => status)).toEqual(['passed', 'passed', 'passed'])
    expect(JSON.stringify(evidence) + messages.join('')).not.toMatch(/private|synthetic-provider-key|synthetic-reports/u)
  })

  it('does not spend on earlier scenarios when a later title is missing', () => {
    const { evidence, requests } = harness({ invalidSelection: true })
    expect(requests).toHaveLength(3)
    expect(requests.every((request) => request.capture)).toBe(true)
    expect(evidence.success).toBe(false)
    expect(evidence.scenarios[2]).toMatchObject({ status: 'failed', failure: 'selection_failed' })
  })

  it.each([
    { failedProcess: true, reason: 'process_failed' },
    { missingReport: true, reason: 'report_failed' },
  ])('stops without retry on $reason and cannot treat exit code alone as evidence', (options) => {
    const { evidence, requests, messages } = harness(options)
    expect(requests).toHaveLength(4)
    expect(evidence.success).toBe(false)
    expect(evidence.scenarios[0]).toMatchObject({ status: 'failed', failure: options.reason })
    expect(evidence.scenarios[1]?.status).toBe('not_run')
    expect(messages.join('')).not.toContain('private')
  })

  it('rejects malformed, zero, duplicate, wrong-title and unexpected-execution reports', () => {
    const fullName = 'acceptance > selected'
    const base = successfulReport(fullName)
    const reports: unknown[] = [
      null,
      { ...base, numPassedTests: 0 },
      { ...base, success: false },
      { ...base, testResults: [] },
      successfulReport('acceptance > other'),
      { ...base, testResults: [{ status: 'passed', assertionResults: [
        ...base.testResults[0]!.assertionResults,
        ...base.testResults[0]!.assertionResults,
      ] }] },
      { ...base, testResults: [{ status: 'passed', assertionResults: [
        ...base.testResults[0]!.assertionResults,
        { fullName: 'acceptance other', status: 'passed' },
      ] }] },
    ]
    for (const report of reports) {
      expect(() => requirePassedRealModelReport(JSON.stringify(report), fullName)).toThrow()
    }
    expect(() => requirePassedRealModelReport('invalid JSON', fullName)).toThrow()
  })

  it('accepts a real Vitest JSON report and rejects a skipped selected test despite exit zero', async () => {
    const repoRoot = fileURLToPath(new URL('../', import.meta.url))
    const root = await mkdtemp(path.join(tmpdir(), 'real-model-report-test-'))
    const reportPath = path.join(root, 'report.json')
    const vitestEntry = path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs')
    try {
      await writeFile(path.join(root, 'vitest.config.mjs'), "export default { test: { globals: true, include: ['scenario.test.mjs'] } }\n")
      await writeFile(path.join(root, 'scenario.test.mjs'), [
        "describe('acceptance', () => {",
        "  it('selected', () => expect(2 + 2).toBe(4))",
        "  it.skip('unavailable', () => expect.fail())",
        '})',
      ].join('\n'))
      for (const title of ['selected', 'unavailable']) {
        const child = spawnSync(process.execPath, [
          vitestEntry, 'run', '--config', 'vitest.config.mjs', '--testNamePattern', `^acceptance ${title}$`,
          '--reporter=json', `--outputFile=${reportPath}`, '--retry=0', '--maxWorkers=1',
          '--bail=1', '--maxConcurrency=1', '--fileParallelism=false', '--testTimeout=600000', '--hookTimeout=60000',
        ], { cwd: root, env: { PATH: process.env.PATH, CI: 'true' }, encoding: 'utf8', timeout: 30_000 })
        expect(child.error).toBeUndefined()
        expect(child.status).toBe(0)
        const report = await readFile(reportPath, 'utf8')
        if (title === 'selected') expect(() => requirePassedRealModelReport(report, 'acceptance > selected')).not.toThrow()
        else expect(() => requirePassedRealModelReport(report, 'acceptance > unavailable')).toThrow()
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 75_000)
})
