import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

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
          if (isAllowedHostSupportTypeScriptCache(file, workflow, description)) {
            continue
          }
          findings.push(`${file}: ${description}`)
        }
      }
    }

    expect(findings).toEqual([])
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
