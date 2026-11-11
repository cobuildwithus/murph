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
            || isAllowedTemporalCompatibilityHandoff(file, workflow, description)
            || isAllowedWebAdmissionCancellation(file, workflow, description)
          ) {
            continue
          }
          findings.push(`${file}: ${description}`)
        }
      }
    }

    expect(findings).toEqual([])
  })

  it('allows only the failure-only Web admission cancellation handoff', () => {
    const file = 'temporal-web-admission-cancellation.yml'
    const workflow = readFileSync(path.join(workflowsDir, file), 'utf8')
    const description = 'workflow_run handoff trigger'
    expect(isAllowedWebAdmissionCancellation(file, workflow, description)).toBe(true)
    expect(isAllowedWebAdmissionCancellation('other.yml', workflow, description)).toBe(false)
    expect(isAllowedWebAdmissionCancellation(file, workflow, 'actions/cache')).toBe(false)
    for (const [before, after] of [
      ['types: [completed]', 'types: [requested]'],
      ['workflows: ["Temporal Web Deployment Admission"]', 'workflows: ["Other"]'],
      ['permissions: {}', 'permissions: {contents: write}'],
      ['      actions: read', '      actions: write'],
      ['      statuses: write', '      statuses: write\n      contents: write'],
      ["conclusion == 'cancelled'", "conclusion == 'success'"],
      ['-f state=failure', '-f state=success'],
      ['GH_TOKEN: ${{ github.token }}', 'GH_TOKEN: ${{ secrets.OTHER_TOKEN }}'],
    ]) {
      expect(isAllowedWebAdmissionCancellation(file, workflow.replace(before, after), description)).toBe(false)
    }
  })

  it('allows only the trusted Temporal compatibility workflow_run controller', () => {
    const workflow = readFileSync(
      path.join(workflowsDir, 'temporal-compatibility.yml'),
      'utf8',
    )

    expect(
      isAllowedTemporalCompatibilityHandoff(
        'temporal-compatibility.yml',
        workflow,
        'workflow_run handoff trigger',
      ),
    ).toBe(true)
    expect(
      isAllowedTemporalCompatibilityHandoff(
        'release.yml',
        workflow,
        'workflow_run handoff trigger',
      ),
    ).toBe(false)
    expect(
      isAllowedTemporalCompatibilityHandoff(
        'temporal-compatibility.yml',
        workflow.replace('- Repo Hygiene', '- Release'),
        'workflow_run handoff trigger',
      ),
    ).toBe(false)
    expect(
      isAllowedTemporalCompatibilityHandoff(
        'temporal-compatibility.yml',
        workflow.replace(" && needs.select-pr.outputs.trusted == 'true'", ''),
        'workflow_run handoff trigger',
      ),
    ).toBe(false)
    // The private matrix is skipped only on an explicit "unchanged" result
    // from the trusted comparison, which itself can never fail the job.
    const unchangedSkipMutations: Array<[string, string]> = [
      [
        "        if: ${{ steps.base-fixtures.outputs.unchanged != 'true' }}\n        env:",
        "        if: ${{ steps.base-fixtures.outputs.unchanged == 'false' }}\n        env:",
      ],
      [
        "        id: private-app-token\n        if: ${{ steps.base-fixtures.outputs.unchanged != 'true' }}\n",
        "        id: private-app-token\n        if: ${{ steps.base-fixtures.outcome != 'success' }}\n",
      ],
      [
        '        id: base-fixtures\n        continue-on-error: true\n',
        '        id: base-fixtures\n',
      ],
      [
        'node scripts/hosted-orchestration-compatibility.mjs compare-base',
        'node scripts/compare-fixtures.mjs',
      ],
      [
        '      unchanged: ${{ steps.base-fixtures.outputs.unchanged }}',
        "      unchanged: 'true'",
      ],
    ]
    for (const [original, replacement] of unchangedSkipMutations) {
      expect(workflow).toContain(original)
      expect(
        isAllowedTemporalCompatibilityHandoff(
          'temporal-compatibility.yml',
          workflow.replace(original, replacement),
          'workflow_run handoff trigger',
        ),
      ).toBe(false)
    }
    expect(
      isAllowedTemporalCompatibilityHandoff(
        'temporal-compatibility.yml',
        workflow.replace(
          " && needs.select-pr.outputs.targets_default_branch == 'true'",
          '',
        ),
        'workflow_run handoff trigger',
      ),
    ).toBe(false)
    expect(
      isAllowedTemporalCompatibilityHandoff(
        'temporal-compatibility.yml',
        workflow.replace(
          "        if: ${{ steps.select.outputs.targets_default_branch == 'true' && steps.select.outputs.current == 'true' }}\n",
          '',
        ),
        'workflow_run handoff trigger',
      ),
    ).toBe(false)
    expect(
      isAllowedTemporalCompatibilityHandoff(
        'temporal-compatibility.yml',
        workflow.replace(" && needs.select-pr.outputs.current == 'true' && needs.select-pr.outputs.selected", ' && needs.select-pr.outputs.selected'),
        'workflow_run handoff trigger',
      ),
    ).toBe(false)
    expect(
      isAllowedTemporalCompatibilityHandoff(
        'temporal-compatibility.yml',
        workflow.replace(
          'EXPECTED_HEAD_SHA: ${{ github.event.workflow_run.head_sha }}',
          'EXPECTED_HEAD_SHA: ${{ github.event.workflow_run.pull_requests[0].head.sha }}',
        ),
        'workflow_run handoff trigger',
      ),
    ).toBe(false)
    expect(
      isAllowedTemporalCompatibilityHandoff(
        'temporal-compatibility.yml',
        workflow.replace(
          "      - name: Dispatch exact private reader matrix\n        if: ${{ steps.base-fixtures.outputs.unchanged != 'true' }}\n        env:\n          EXPECTED_BASE_REF: ${{ github.event.repository.default_branch }}\n",
          "      - name: Dispatch exact private reader matrix\n        if: ${{ steps.base-fixtures.outputs.unchanged != 'true' }}\n        env:\n",
        ),
        'workflow_run handoff trigger',
      ),
    ).toBe(false)
    expect(
      isAllowedTemporalCompatibilityHandoff(
        'temporal-compatibility.yml',
        removeWorkflowStep(workflow, 'Revalidate exact PR head before credentialed setup'),
        'workflow_run handoff trigger',
      ),
    ).toBe(false)
    expect(
      isAllowedTemporalCompatibilityHandoff(
        'temporal-compatibility.yml',
        workflow.replaceAll(
          'ref: ${{ github.event.repository.default_branch }}',
          'ref: ${{ needs.select-pr.outputs.head_sha }}',
        ),
        'workflow_run handoff trigger',
      ),
    ).toBe(false)
    expect(
      isAllowedTemporalCompatibilityHandoff(
        'temporal-compatibility.yml',
        workflow.replace('      actions: read\n', ''),
        'workflow_run handoff trigger',
      ),
    ).toBe(false)
    expect(
      isAllowedTemporalCompatibilityHandoff(
        'temporal-compatibility.yml',
        workflow.replace('      actions: read', '      actions: none'),
        'workflow_run handoff trigger',
      ),
    ).toBe(false)
    expect(
      isAllowedTemporalCompatibilityHandoff(
        'temporal-compatibility.yml',
        workflow.replace(
          '      pull-requests: read\n    outputs:',
          '      pull-requests: read\n      statuses: write\n    outputs:',
        ),
        'workflow_run handoff trigger',
      ),
    ).toBe(false)
    expect(
      isAllowedTemporalCompatibilityHandoff(
        'temporal-compatibility.yml',
        workflow.replace('repositories: murph-cloud', 'repositories: murph'),
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
      cacheUses.length === 1 &&
      cacheUses.every(
        (entry) =>
          entry ===
          'uses: actions/cache@caa296126883cff596d87d8935842f9db880ef25',
      )
    )
  }

  if (description === 'cache restore keys') {
    return (workflow.match(/^\s+restore-keys:/gmu) ?? []).length === 1
  }

  return false
}


function isAllowedWebAdmissionCancellation(file: string, workflow: string, description: string): boolean {
  if (file !== 'temporal-web-admission-cancellation.yml' || description !== 'workflow_run handoff trigger') return false
  const parsed: unknown = parse(workflow)
  if (!isRecord(parsed) || !isRecord(parsed.on) || !isRecord(parsed.permissions) || !isRecord(parsed.jobs)) return false
  const trigger = parsed.on.workflow_run
  const job = parsed.jobs['publish-cancellation']
  if (!isRecord(trigger) || !isRecord(job) || !isRecord(job.permissions) || !Array.isArray(job.steps)) return false
  const step = job.steps[0]
  if (!isRecord(step) || typeof step.run !== 'string') return false
  return Object.keys(parsed.on).join(',') === 'workflow_run'
    && isStringArray(trigger.workflows, ['Temporal Web Deployment Admission'])
    && isStringArray(trigger.types, ['completed'])
    && Object.keys(parsed.permissions).length === 0
    && Object.keys(parsed.jobs).join(',') === 'publish-cancellation'
    && Object.keys(job.permissions).sort().join(',') === 'actions,statuses'
    && job.permissions.actions === 'read'
    && job.permissions.statuses === 'write'
    && job.if === "${{ github.event.workflow_run.conclusion == 'cancelled' && github.event.workflow_run.event == 'push' && github.event.workflow_run.head_branch == 'main' && github.event.workflow_run.head_repository.full_name == github.repository }}"
    && job.steps.length === 1
    && step.uses === undefined
    && !workflow.includes('secrets.')
    && !step.run.includes('state=success')
    && step.run.includes('-f state=failure')
}

function isAllowedTemporalCompatibilityHandoff(
  file: string,
  workflow: string,
  description: string,
): boolean {
  if (
    file !== 'temporal-compatibility.yml'
    || description !== 'workflow_run handoff trigger'
  ) {
    return false
  }

  const parsedWorkflow: unknown = parse(workflow)
  if (!isRecord(parsedWorkflow)) {
    return false
  }

  const triggers = parsedWorkflow.on
  const permissions = parsedWorkflow.permissions
  const jobs = parsedWorkflow.jobs
  if (!isRecord(triggers) || !isRecord(permissions) || !isRecord(jobs)) {
    return false
  }

  const workflowRun = triggers.workflow_run
  const selectPr = jobs['select-pr']
  const compatibility = jobs.compatibility
  const required = jobs.required
  if (
    !isRecord(workflowRun)
    || !isRecord(selectPr)
    || !isRecord(compatibility)
    || !isRecord(required)
  ) {
    return false
  }

  const selectOutputs = selectPr.outputs
  const selectSteps = selectPr.steps
  if (!isRecord(selectOutputs) || !Array.isArray(selectSteps)) {
    return false
  }
  const selectStep = selectSteps.find((step) =>
    isRecord(step) && step.name === 'Resolve exact PR head and compatibility owners'
  )
  const pendingStep = selectSteps.find((step) =>
    isRecord(step) && step.name === 'Mark stable status pending'
  )
  const compatibilitySteps = compatibility.steps
  const dispatchStep = Array.isArray(compatibilitySteps)
    ? compatibilitySteps.find((step) =>
      isRecord(step) && step.name === 'Dispatch exact private reader matrix'
    )
    : null
  if (
    !isRecord(selectStep)
    || !isRecord(selectStep.env)
    || !isRecord(pendingStep)
    || !isRecord(dispatchStep)
    || !isRecord(dispatchStep.env)
  ) {
    return false
  }

  return (
    isStringArray(workflowRun.workflows, ['Repo Hygiene'])
    && isStringArray(workflowRun.types, ['completed'])
    && Object.keys(permissions).sort().join(',') === 'contents,pull-requests,statuses'
    && permissions.contents === 'read'
    && permissions['pull-requests'] === 'read'
    && permissions.statuses === 'write'
    && selectPr.if === "${{ github.event.workflow_run.event == 'pull_request' && github.event.workflow_run.pull_requests[0] != null }}"
    && selectOutputs.targets_default_branch === '${{ steps.select.outputs.targets_default_branch }}'
    && selectOutputs.current === '${{ steps.select.outputs.current }}'
    && selectStep.env.EXPECTED_BASE_REF === '${{ github.event.repository.default_branch }}'
    && selectStep.env.EXPECTED_HEAD_SHA === '${{ github.event.workflow_run.head_sha }}'
    && pendingStep.if === "${{ steps.select.outputs.targets_default_branch == 'true' && steps.select.outputs.current == 'true' }}"
    && compatibility.if === "${{ github.event.workflow_run.conclusion == 'success' && needs.select-pr.outputs.targets_default_branch == 'true' && needs.select-pr.outputs.current == 'true' && needs.select-pr.outputs.selected == 'true' && needs.select-pr.outputs.trusted == 'true' }}"
    && compatibility.environment === 'temporal-compatibility'
    && dispatchStep.env.EXPECTED_BASE_REF === '${{ github.event.repository.default_branch }}'
    && required.if === "${{ always() && github.event.workflow_run.event == 'pull_request' && github.event.workflow_run.pull_requests[0] != null && needs.select-pr.outputs.targets_default_branch == 'true' && needs.select-pr.outputs.current == 'true' }}"
    && hasTemporalCompatibilityPermissions(compatibility.permissions)
    && hasEarlyExactPrHeadRevalidation(
      compatibility.steps,
      'Checkout trusted controller',
    )
    && hasTrustedControlPlaneCheckout(
      compatibility.steps,
      'Checkout trusted controller',
    )
    && hasTemporalCompatibilityAppToken(compatibility.steps)
    && hasUnchangedProducerFixtureSkip(compatibility)
    && workflow.includes('node scripts/hosted-orchestration-compatibility.mjs run')
  )
}

// The private matrix may be skipped only when the trusted default-branch
// comparison explicitly reports the PR's producer fixtures as unchanged.
function hasUnchangedProducerFixtureSkip(compatibility: Record<string, unknown>): boolean {
  const steps = compatibility.steps
  const outputs = compatibility.outputs
  if (!Array.isArray(steps) || !isRecord(outputs)) {
    return false
  }

  const indexOfStep = (name: string) =>
    steps.findIndex((step) => isRecord(step) && step.name === name)
  const checkoutIndex = indexOfStep('Checkout trusted controller')
  const compareIndex = indexOfStep('Compare producer fixtures with trusted main')
  const tokenIndex = indexOfStep('Mint private compatibility token')
  const dispatchIndex = indexOfStep('Dispatch exact private reader matrix')
  const compare = steps[compareIndex]
  const token = steps[tokenIndex]
  const dispatch = steps[dispatchIndex]
  if (!isRecord(compare) || !isRecord(token) || !isRecord(dispatch)) {
    return false
  }

  const onlyWhenChanged = "${{ steps.base-fixtures.outputs.unchanged != 'true' }}"
  const skipConditions = steps.filter((step) =>
    isRecord(step) && typeof step.if === 'string' && step.if.includes('base-fixtures')
  )
  return checkoutIndex >= 0
    && checkoutIndex < compareIndex
    && compareIndex < tokenIndex
    && tokenIndex < dispatchIndex
    && compare.id === 'base-fixtures'
    && compare['continue-on-error'] === true
    && compare.if === undefined
    && typeof compare.run === 'string'
    && compare.run.startsWith('node scripts/hosted-orchestration-compatibility.mjs compare-base ')
    && token.if === onlyWhenChanged
    && dispatch.if === onlyWhenChanged
    && skipConditions.length === 2
    && outputs.unchanged === '${{ steps.base-fixtures.outputs.unchanged }}'
}

function hasTemporalCompatibilityAppToken(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false
  }

  const token = value.find((step) =>
    isRecord(step) && step.name === 'Mint private compatibility token'
  )
  if (!isRecord(token) || !isRecord(token.with)) {
    return false
  }

  return token.uses === 'actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1'
    && token.with['app-id'] === '${{ vars.TEMPORAL_COMPATIBILITY_GITHUB_APP_ID }}'
    && token.with['private-key'] === '${{ secrets.TEMPORAL_COMPATIBILITY_GITHUB_APP_PRIVATE_KEY }}'
    && token.with.owner === 'cobuildwithus'
    && token.with.repositories === 'murph-cloud'
    && token.with['permission-actions'] === 'write'
    && token.with['permission-contents'] === 'read'
}

function hasTemporalCompatibilityPermissions(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }

  return Object.keys(value).sort().join(',') === 'actions,contents,pull-requests'
    && value.actions === 'read'
    && value.contents === 'read'
    && value['pull-requests'] === 'read'
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
