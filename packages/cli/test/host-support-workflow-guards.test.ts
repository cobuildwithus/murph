import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const hostSupportWorkflowPath = path.join(repoRoot, '.github', 'workflows', 'host-support.yml')

describe('host support workflow guards', () => {
  it('keeps the hosted-web verify env placeholders aligned across release and support workflows', () => {
    const workflow = readFileSync(hostSupportWorkflowPath, 'utf8')

    expect(workflow).toContain('DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:1/murph_test')
    expect(workflow).toContain('DEVICE_SYNC_ENCRYPTION_KEY: 0101010101010101010101010101010101010101010101010101010101010101')
    expect(workflow).toContain('DEVICE_SYNC_ENCRYPTION_KEY_VERSION: v1')
    expect(workflow).toContain('HOSTED_CONTACT_PRIVACY_KEYS: v1:BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc')
    expect(workflow).toContain('NEXT_PUBLIC_PRIVY_APP_ID: ${{ vars.HOSTED_WEB_VERIFY_PRIVY_APP_ID }}')
    expect(workflow).toContain('PRIVY_VERIFICATION_KEY: ci-hosted-web-verification-key')
    expect(workflow).toContain('run: pnpm release:check')
  })

  it('prepares built CLI runtime artifacts before the host-support setup and inbox suite', () => {
    const workflow = readFileSync(hostSupportWorkflowPath, 'utf8')

    expect(workflow).toContain('- name: Prepare built CLI runtime artifacts')
    expect(workflow).toContain('run: pnpm build:test-runtime:prepared')
    expect(workflow).toContain(
      'run: env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 pnpm exec vitest run packages/cli/test/setup-cli.test.ts packages/cli/test/cli-expansion-inbox-attachments.test.ts packages/cli/test/inbox-service-boundaries.test.ts --no-coverage --maxWorkers 1',
    )
  })
})
