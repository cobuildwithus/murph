import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const hostedE2eWorkflowPath = path.join(repoRoot, '.github', 'workflows', 'cloudflare-hosted-e2e.yml')

describe('cloudflare hosted e2e workflow guards', () => {
  it('provisions a real local postgres service for hosted local e2e jobs', () => {
    const workflow = readFileSync(hostedE2eWorkflowPath, 'utf8')
    const hostedLocalE2eScenarios = Array.from(workflow.matchAll(/pnpm hosted-local e2e ([^\s\\]+)/g), (match) => match[1])
    const postgresBackedScenarioCount = hostedLocalE2eScenarios.filter(
      (scenario) => scenario !== 'direct-r2-presigned-put',
    ).length

    expect(workflow).toContain('DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/murph_test')
    expect(workflow).toContain('HOSTED_DEVICE_ROUTING_INDEX_KEY: 0101010101010101010101010101010101010101010101010101010101010101')
    expect(workflow).toContain('HOSTED_MAILBOX_FINGERPRINT_KEY: BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc')
    expect(workflow).toContain('NEXT_PUBLIC_PRIVY_APP_ID: ${{ vars.HOSTED_WEB_VERIFY_PRIVY_APP_ID }}')
    expect(workflow).toContain('PRIVY_VERIFICATION_KEY: ci-hosted-web-verification-key')
    expect(workflow).toContain('permissions:\n  contents: read')
    expect(workflow).not.toContain('packages: read')
    expect(workflow).not.toContain('docker login ghcr.io')
    expect(workflow).not.toContain('DEVICE_SYNC_ENCRYPTION_KEY')
    expect(workflow).not.toContain('DEVICE_SYNC_ENCRYPTION_KEY_VERSION')
    expect(hostedLocalE2eScenarios).not.toHaveLength(0)
    expect(postgresBackedScenarioCount).toBeGreaterThan(0)
    expect(workflow.match(/image: postgres/g)).toHaveLength(postgresBackedScenarioCount)
    expect(workflow.match(/POSTGRES_DB: murph_test/g)).toHaveLength(postgresBackedScenarioCount)
    expect(workflow.match(/POSTGRES_PASSWORD: postgres/g)).toHaveLength(postgresBackedScenarioCount)
    expect(workflow.match(/POSTGRES_USER: postgres/g)).toHaveLength(postgresBackedScenarioCount)
    expect(workflow.match(/--health-cmd pg_isready/g)).toHaveLength(postgresBackedScenarioCount)
    expect(workflow.match(/- 5432:5432/g)).toHaveLength(postgresBackedScenarioCount)
    expect(workflow).toContain('pnpm hosted-local e2e device-connect')
    expect(workflow).toContain('pnpm hosted-local e2e linq-delivery')
    expect(workflow).toContain('pnpm hosted-local e2e linq-scheduled-reminder')
    expect(workflow).toContain('pnpm hosted-local e2e idle-checkpoint-deferred-progress')
    expect(workflow).toContain('pnpm hosted-local e2e direct-r2-presigned-put')
    expect(workflow).toContain('pnpm hosted-local e2e telegram')
    expect(workflow.match(/\.artifacts\/hosted-local\/\*\*\/state\.json/g)).toHaveLength(postgresBackedScenarioCount)
    expect(workflow).not.toContain('pnpm --dir apps/cloudflare test:e2e:linq-delivery:local')
    expect(workflow).not.toContain('pnpm --dir apps/cloudflare test:e2e:telegram:local')
  })
})
