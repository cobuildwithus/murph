import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const hostedE2eWorkflowPath = path.join(repoRoot, '.github', 'workflows', 'cloudflare-hosted-e2e.yml')

describe('cloudflare hosted e2e workflow guards', () => {
  it('provisions a real local postgres service for hosted local e2e jobs', () => {
    const workflow = readFileSync(hostedE2eWorkflowPath, 'utf8')

    expect(workflow).toContain('DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/murph_test')
    expect(workflow).toContain('NEXT_PUBLIC_PRIVY_APP_ID: ${{ vars.HOSTED_WEB_VERIFY_PRIVY_APP_ID }}')
    expect(workflow).toContain('PRIVY_VERIFICATION_KEY: ci-hosted-web-verification-key')
    expect(workflow.match(/image: postgres/g)).toHaveLength(3)
    expect(workflow.match(/POSTGRES_DB: murph_test/g)).toHaveLength(3)
    expect(workflow.match(/POSTGRES_PASSWORD: postgres/g)).toHaveLength(3)
    expect(workflow.match(/POSTGRES_USER: postgres/g)).toHaveLength(3)
    expect(workflow.match(/--health-cmd pg_isready/g)).toHaveLength(3)
    expect(workflow.match(/- 5432:5432/g)).toHaveLength(3)
    expect(workflow).toContain('pnpm --dir apps/cloudflare test:e2e:linq-delivery:local')
    expect(workflow).toContain('pnpm --dir apps/cloudflare test:e2e:telegram:local')
  })
})
