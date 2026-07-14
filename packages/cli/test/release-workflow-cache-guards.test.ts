import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const workflowsDir = path.join(repoRoot, '.github', 'workflows')

describe('GitHub Actions cache trust-boundary guards', () => {
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
            description === 'workflow_run handoff trigger' &&
            isAllowedWorkflowRunHandoff(file, workflow)
          ) {
            continue
          }
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

function isAllowedWorkflowRunHandoff(file: string, workflow: string): boolean {
  if (file !== 'deploy-render-temporal-worker.yml') {
    return false
  }

  return [
    /branches:\s*\n\s*-\s+main/u,
    /github\.event\.workflow_run\.event\s*==\s*'push'/u,
    /github\.event\.workflow_run\.head_branch\s*==\s*'main'/u,
    /github\.event\.workflow_run\.conclusion\s*==\s*'success'/u,
  ].every((pattern) => pattern.test(workflow))
}
