import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const workflowsDir = path.join(repoRoot, '.github', 'workflows')

describe('GitHub Actions cache trust-boundary guards', () => {
  it('keeps dependency and build caches out of release, deploy, and PR workflows', () => {
    const findings: string[] = []
    const workflowFiles = readdirSync(workflowsDir)
      .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
      .sort()

    for (const file of workflowFiles) {
      const workflow = readFileSync(path.join(workflowsDir, file), 'utf8')
      const forbiddenPatterns = [
        ['setup-node cache: pnpm', /cache:\s+pnpm/u],
        ['actions/cache', /uses:\s+actions\/cache@/u],
        ['cache restore keys', /restore-keys:/u],
        ['Docker GitHub Actions cache restore', /cache-from:\s*type=gha/u],
        ['Docker GitHub Actions cache save', /cache-to:\s*type=gha/u],
        ['privileged PR trigger', /^\s*pull_request_target:/mu],
        ['workflow_run handoff trigger', /^\s*workflow_run:/mu],
      ] as const

      for (const [description, pattern] of forbiddenPatterns) {
        if (pattern.test(workflow)) {
          findings.push(`${file}: ${description}`)
        }
      }
    }

    expect(findings).toEqual([])
  })
})
