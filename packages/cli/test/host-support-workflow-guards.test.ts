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
    expect(workflow).toContain('HOSTED_DEVICE_ROUTING_INDEX_KEY: 0101010101010101010101010101010101010101010101010101010101010101')
    expect(workflow).toContain('HOSTED_MAILBOX_FINGERPRINT_KEY: BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc')
    expect(workflow).toContain('HOSTED_CONTACT_PRIVACY_KEYS: v1:BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc')
    expect(workflow).toContain('NEXT_PUBLIC_PRIVY_APP_ID: ${{ vars.HOSTED_WEB_VERIFY_PRIVY_APP_ID }}')
    expect(workflow).toContain('PRIVY_VERIFICATION_KEY: ci-hosted-web-verification-key')
  })

  it('keeps the release gate split into parallel shards instead of one long release:check job', () => {
    const workflow = readFileSync(hostSupportWorkflowPath, 'utf8')

    expect(workflow).toContain('name: Release build/typecheck (ubuntu)')
    expect(workflow).toContain('name: Release package coverage (${{ matrix.shard }})')
    expect(workflow).toContain('name: Release app verification (ubuntu)')
    expect(workflow).toContain('name: Release fixture coverage (ubuntu)')
    expect(workflow).toContain('name: Release checks (ubuntu)')
    expect(workflow).toContain('pnpm build:workspace:clean')
    expect(workflow).toContain('pnpm typecheck')
    expect(workflow).toContain('pnpm no-js')
    expect(workflow).toContain('bash scripts/doc-gardening.sh --fail-on-issues')
    expect(workflow).toContain('pnpm test:apps')
    expect(workflow).toContain('MURPH_APP_VERIFY_PARALLEL: "1"')
    expect(workflow).toContain('MURPH_VERIFY_STEP_PARALLEL: "1"')
    expect(workflow).toContain('pnpm exec tsx e2e/smoke/verify-scenario-integrity.ts --coverage')
    expect(workflow).toContain('MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 MURPH_VITEST_MAX_WORKERS=50%')
    expect(workflow).not.toContain('run: pnpm release:check')
  })

  it('keeps every package coverage owner assigned to a release shard', () => {
    const workflow = readFileSync(hostSupportWorkflowPath, 'utf8')
    const packageDirs = [
      'packages/assistant-cli',
      'packages/assistant-engine',
      'packages/assistant-runtime',
      'packages/assistantd',
      'packages/cloudflare-hosted-control',
      'packages/contracts',
      'packages/core',
      'packages/device-syncd',
      'packages/cli',
      'packages/gateway-core',
      'packages/hosted-execution',
      'packages/importers',
      'packages/inbox-services',
      'packages/inboxd',
      'packages/messaging-ingress',
      'packages/openclaw-plugin',
      'packages/operator-config',
      'packages/parsers',
      'packages/query',
      'packages/runtime-state',
      'packages/setup-cli',
      'packages/vault-usecases',
    ]

    for (const packageDir of packageDirs) {
      expect(workflow).toContain(packageDir)
    }
  })

  it('prepares built CLI runtime artifacts before the host-support setup suite', () => {
    const workflow = readFileSync(hostSupportWorkflowPath, 'utf8')

    expect(workflow).toContain('- name: Prepare built CLI runtime artifacts')
    expect(workflow).toContain('run: pnpm build:test-runtime:prepared')
    expect(workflow).toContain(
      'run: env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 pnpm exec vitest run packages/cli/test/setup-cli.test.ts packages/cli/test/inbox-service-boundaries.test.ts --no-coverage --maxWorkers 1',
    )
  })
})
