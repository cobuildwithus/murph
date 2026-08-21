import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const workflowsDir = path.join(repoRoot, '.github', 'workflows')

describe('GitHub Actions cache trust-boundary guards', () => {
  it('keeps the private Temporal deployment owner out of the public repository', () => {
    const findings = listTrackedYamlFiles().flatMap((file) =>
      findPublicTemporalDeploymentOwnership(
        file,
        readFileSync(path.join(repoRoot, file), 'utf8'),
      ),
    )

    expect(findings).toEqual([])
  })

  it('detects renamed Temporal deploy workflows and alternate Render Blueprints', () => {
    expect(
      findPublicTemporalDeploymentOwnership(
        '.github/workflows/deploy-temporal.yml',
        [
          'name: Deploy Temporal',
          'on: workflow_dispatch',
          'env:',
          '  DEPLOY_HOOK: ${{ secrets.RENDER_TEMPORAL_WORKER_DEPLOY_HOOK }}',
        ].join('\n'),
      ),
    ).toEqual([
      '.github/workflows/deploy-temporal.yml: Render Temporal deploy hook',
    ])

    expect(
      findPublicTemporalDeploymentOwnership(
        'infra/render-temporal.yaml',
        [
          'services:',
          '  - type: worker',
          '    name: replacement-temporal-worker',
          '    startCommand: pnpm --dir packages/hosted-orchestrator-temporal temporal:worker:prod',
        ].join('\n'),
      ),
    ).toEqual([
      'infra/render-temporal.yaml: hosted Temporal worker service',
    ])
  })

  it('allows unrelated workflows and service configuration', () => {
    expect(
      findPublicTemporalDeploymentOwnership(
        '.github/workflows/verify.yml',
        [
          'name: Verify',
          'on: pull_request',
          'jobs:',
          '  test:',
          '    runs-on: ubuntu-24.04',
        ].join('\n'),
      ),
    ).toEqual([])

    expect(
      findPublicTemporalDeploymentOwnership(
        'infra/render-web.yaml',
        [
          'services:',
          '  - type: web',
          '    name: murph-web',
          '    startCommand: pnpm --dir apps/web start',
        ].join('\n'),
      ),
    ).toEqual([])
  })

  it('keeps broad caches and privileged triggers out of release, deploy, and PR workflows', () => {
    const findings: string[] = []
    const workflowFiles = readdirSync(workflowsDir)
      .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
      .sort()

    for (const file of workflowFiles) {
      const workflow = readFileSync(path.join(workflowsDir, file), 'utf8')
      const forbiddenPatterns = [
        ['actions/cache', /uses:\s+actions\/cache@/u],
        ['cache restore keys', /restore-keys:/u],
        ['Docker GitHub Actions cache restore', /cache-from:\s*type=gha/u],
        ['Docker GitHub Actions cache save', /cache-to:\s*type=gha/u],
        ['privileged PR trigger', /^\s*pull_request_target:/mu],
        ['workflow_run handoff trigger', /^\s*workflow_run:/mu],
      ] as const

      for (const [description, pattern] of forbiddenPatterns) {
        if (pattern.test(workflow)) {
          if (
            isAllowedHostSupportTypeScriptCache(file, workflow, description)
            || isAllowedNativeHostedE2eHandoff(file, workflow, description)
          ) {
            continue
          }
          findings.push(`${file}: ${description}`)
        }
      }
    }

    expect(findings).toEqual([])
  })

  it('allows only native E2E handoffs that keep PR code outside the secret runner', () => {
    const iosWorkflow = readFileSync(
      path.join(workflowsDir, 'native-ios-hosted-e2e.yml'),
      'utf8',
    )
    const androidWorkflow = readFileSync(
      path.join(workflowsDir, 'native-android-hosted-e2e.yml'),
      'utf8',
    )

    expect(
      isAllowedNativeHostedE2eHandoff(
        'native-ios-hosted-e2e.yml',
        iosWorkflow,
        'workflow_run handoff trigger',
      ),
    ).toBe(true)

    expect(
      isAllowedNativeHostedE2eHandoff(
        'native-android-hosted-e2e.yml',
        androidWorkflow,
        'workflow_run handoff trigger',
      ),
    ).toBe(true)

    expect(
      isAllowedNativeHostedE2eHandoff(
        'release.yml',
        iosWorkflow,
        'workflow_run handoff trigger',
      ),
    ).toBe(false)

    expect(
      isAllowedNativeHostedE2eHandoff(
        'native-ios-hosted-e2e.yml',
        iosWorkflow.replace('- Repo Hygiene', '- Release'),
        'workflow_run handoff trigger',
      ),
    ).toBe(false)

    expect(
      isAllowedNativeHostedE2eHandoff(
        'native-ios-hosted-e2e.yml',
        iosWorkflow.replace(
          " && needs.select-pr.outputs.trusted == 'true'",
          '',
        ),
        'workflow_run handoff trigger',
      ),
    ).toBe(false)

    expect(
      isAllowedNativeHostedE2eHandoff(
        'native-ios-hosted-e2e.yml',
        removeWorkflowStep(iosWorkflow, 'Revalidate exact PR head before runner setup'),
        'workflow_run handoff trigger',
      ),
    ).toBe(false)

    expect(
      isAllowedNativeHostedE2eHandoff(
        'native-ios-hosted-e2e.yml',
        iosWorkflow.replace(
          '      pull-requests: read\n',
          '      pull-requests: read\n      statuses: write\n',
        ),
        'workflow_run handoff trigger',
      ),
    ).toBe(false)

    expect(
      isAllowedNativeHostedE2eHandoff(
        'native-ios-hosted-e2e.yml',
        iosWorkflow.replace('      contents: read\n', '      contents: write\n'),
        'workflow_run handoff trigger',
      ),
    ).toBe(false)

    expect(
      isAllowedNativeHostedE2eHandoff(
        'native-ios-hosted-e2e.yml',
        iosWorkflow.replace(
          'ref: ${{ github.event.repository.default_branch }}',
          () => 'ref: ${{ needs.select-pr.outputs.head_ref }}',
        ),
        'workflow_run handoff trigger',
      ),
    ).toBe(false)

    expect(
      isAllowedNativeHostedE2eHandoff(
        'native-ios-hosted-e2e.yml',
        iosWorkflow.replace('persist-credentials: false', 'persist-credentials: true'),
        'workflow_run handoff trigger',
      ),
    ).toBe(false)

    expect(
      isAllowedNativeHostedE2eHandoff(
        'native-android-hosted-e2e.yml',
        androidWorkflow.replace(
          'NATIVE_ANDROID_E2E_GITHUB_APP_PRIVATE_KEY: ${{ secrets.NATIVE_ANDROID_E2E_GITHUB_APP_PRIVATE_KEY }}',
          'NATIVE_ANDROID_E2E_GITHUB_APP_PRIVATE_KEY: untrusted',
        ),
        'workflow_run handoff trigger',
      ),
    ).toBe(false)
  })
})

function listTrackedYamlFiles(): string[] {
  const output = execFileSync(
    'git',
    [
      'ls-files',
      '-z',
      '--',
      '*.yml',
      '*.yaml',
      ':(glob)**/*.yml',
      ':(glob)**/*.yaml',
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  )

  return [...new Set(output.split('\0').filter(Boolean))]
    .filter((file) => existsSync(path.join(repoRoot, file)))
    .sort()
}

function findPublicTemporalDeploymentOwnership(
  file: string,
  contents: string,
): string[] {
  const findings: string[] = []

  if (/\bRENDER_TEMPORAL_WORKER_DEPLOY_HOOK\b/u.test(contents)) {
    findings.push(`${file}: Render Temporal deploy hook`)
  }

  if (
    /\bmurph-temporal-worker\b/u.test(contents)
    || (
      /^\s*-\s+type:\s*worker\s*$/mu.test(contents)
      && /\bpackages\/hosted-orchestrator-temporal\b/u.test(contents)
      && /\btemporal:worker:prod\b/u.test(contents)
    )
  ) {
    findings.push(`${file}: hosted Temporal worker service`)
  }

  return findings
}

function isAllowedHostSupportTypeScriptCache(
  file: string,
  workflow: string,
  description: string,
): boolean {
  if (file !== 'host-support.yml') {
    return false
  }

  if (description === 'actions/cache') {
    const cacheUses = workflow.match(/uses:\s+actions\/cache@[^\s]+/gu) ?? []
    return (
      cacheUses.length === 2 &&
      cacheUses.every(
        (entry) =>
          entry ===
          'uses: actions/cache@caa296126883cff596d87d8935842f9db880ef25',
      )
    )
  }

  if (description === 'cache restore keys') {
    return (workflow.match(/^\s+restore-keys:/gmu) ?? []).length === 2
  }

  return false
}

function isAllowedNativeHostedE2eHandoff(
  file: string,
  workflow: string,
  description: string,
): boolean {
  const contract = file === 'native-ios-hosted-e2e.yml'
    ? {
        checkoutStep: 'Checkout trusted control plane',
        databaseSecret: 'NATIVE_IOS_E2E_DATABASE_URL: ${{ secrets.NATIVE_IOS_E2E_DATABASE_URL }}',
        dispatchCommand: 'node scripts/native-ios-hosted-e2e.mjs pr',
      }
    : file === 'native-android-hosted-e2e.yml'
      ? {
          checkoutStep: 'Checkout trusted default-branch control code',
          databaseSecret: 'NATIVE_IOS_E2E_DATABASE_URL: ${{ secrets.NATIVE_ANDROID_E2E_DATABASE_URL }}',
          dispatchCommand: 'node scripts/native-android-hosted-e2e.mjs pr',
        }
      : null
  if (!contract || description !== 'workflow_run handoff trigger') {
    return false
  }

  const parsedWorkflow: unknown = parse(workflow)
  if (!isRecord(parsedWorkflow)) {
    return false
  }

  const triggers = parsedWorkflow.on
  if (!isRecord(triggers)) {
    return false
  }

  const workflowRun = triggers.workflow_run
  if (!isRecord(workflowRun)) {
    return false
  }

  const jobs = parsedWorkflow.jobs
  if (!isRecord(jobs)) {
    return false
  }

  const prLive = jobs['pr-live']
  if (
    !isRecord(prLive)
    || !hasTrustedPrLiveAdmission(prLive)
    || !hasExactReadOnlyPrLivePermissions(prLive.permissions)
    || !hasEarlyExactPrHeadRevalidation(prLive.steps, contract.checkoutStep)
    || !hasTrustedControlPlaneCheckout(prLive.steps, contract.checkoutStep)
  ) {
    return false
  }

  return (
    isStringArray(workflowRun.workflows, ['Repo Hygiene'])
    && isStringArray(workflowRun.types, ['completed'])
    && workflow.includes(contract.dispatchCommand)
    && workflow.includes('PR_HEAD_SHA: ${{ needs.select-pr.outputs.head_sha }}')
    && workflow.includes(contract.databaseSecret)
    && (
      file !== 'native-android-hosted-e2e.yml'
      || hasAndroidAppCredentials(prLive.steps)
    )
  )
}

function hasAndroidAppCredentials(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false
  }
  const controller = value.find((step) =>
    isRecord(step) && step.name === 'Run exact candidate lifecycle and private Android journey'
  )
  return isRecord(controller)
    && isRecord(controller.env)
    && controller.env.NATIVE_ANDROID_E2E_GITHUB_APP_ID === '${{ vars.NATIVE_ANDROID_E2E_GITHUB_APP_ID }}'
    && controller.env.NATIVE_ANDROID_E2E_GITHUB_APP_PRIVATE_KEY === '${{ secrets.NATIVE_ANDROID_E2E_GITHUB_APP_PRIVATE_KEY }}'
}

function hasExactReadOnlyPrLivePermissions(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }

  return Object.keys(value).sort().join(',') === 'contents,pull-requests'
    && value.contents === 'read'
    && value['pull-requests'] === 'read'
}

function hasTrustedPrLiveAdmission(prLive: Record<string, unknown>): boolean {
  return prLive.if === "${{ github.run_attempt == 1 && github.event.workflow_run.conclusion == 'success' && needs.select-pr.outputs.selected == 'true' && needs.select-pr.outputs.trusted == 'true' }}"
}

function hasEarlyExactPrHeadRevalidation(value: unknown, checkoutStepName: string): boolean {
  if (!Array.isArray(value)) {
    return false
  }

  const checkoutIndex = value.findIndex((step) =>
    isRecord(step) && step.name === checkoutStepName
  )
  const revalidationIndex = value.findIndex((step) => {
    if (!isRecord(step) || !isRecord(step.env) || typeof step.run !== 'string') {
      return false
    }

    return step.shell === 'bash'
      && step.env.EXPECTED_HEAD_SHA === '${{ needs.select-pr.outputs.head_sha }}'
      && step.env.GH_TOKEN === '${{ github.token }}'
      && step.env.PR_NUMBER === '${{ github.event.workflow_run.pull_requests[0].number }}'
      && step.run.includes('gh api "repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}"')
      && step.run.includes("--jq '.head.sha'")
      && step.run.includes('[[ "${current}" == "${EXPECTED_HEAD_SHA}" ]]')
  })

  return revalidationIndex >= 0
    && checkoutIndex >= 0
    && revalidationIndex < checkoutIndex
}

function hasTrustedControlPlaneCheckout(value: unknown, checkoutStepName: string): boolean {
  if (!Array.isArray(value)) {
    return false
  }

  const checkoutStep = value.find((step) =>
    isRecord(step) && step.name === checkoutStepName
  )
  if (!isRecord(checkoutStep)) {
    return false
  }

  const checkoutWith = checkoutStep.with
  return isRecord(checkoutWith)
    && checkoutWith.ref === '${{ github.event.repository.default_branch }}'
    && checkoutWith['persist-credentials'] === false
}

function removeWorkflowStep(workflow: string, stepName: string): string {
  const marker = `      - name: ${stepName}\n`
  const start = workflow.indexOf(marker)
  if (start < 0) {
    throw new Error(`Workflow step ${stepName} was not found.`)
  }
  const nextStep = workflow.indexOf('\n      - name:', start + marker.length)
  if (nextStep < 0) {
    throw new Error(`Workflow step after ${stepName} was not found.`)
  }
  return `${workflow.slice(0, start)}${workflow.slice(nextStep + 1)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => item === expected[index])
}
