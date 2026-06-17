import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const hostedE2eWorkflowPath = path.join(repoRoot, '.github', 'workflows', 'cloudflare-hosted-e2e.yml')
const hostedDeviceSyncE2eWorkflowPath = path.join(
  repoRoot,
  '.github',
  'workflows',
  'cloudflare-hosted-device-sync-e2e.yml',
)

function expectPostgresServiceContract(workflow: string, expectedServiceCount: number): void {
  expect(
    workflow.match(/image: public\.ecr\.aws\/docker\/library\/postgres:17/g),
  ).toHaveLength(expectedServiceCount)
  expect(workflow.match(/POSTGRES_DB: murph_test/g)).toHaveLength(expectedServiceCount)
  expect(workflow.match(/POSTGRES_PASSWORD: postgres/g)).toHaveLength(expectedServiceCount)
  expect(workflow.match(/POSTGRES_USER: postgres/g)).toHaveLength(expectedServiceCount)
  expect(workflow.match(/--health-cmd "pg_isready -U postgres -d murph_test"/g)).toHaveLength(
    expectedServiceCount,
  )
  expect(workflow.match(/--health-retries 10/g)).toHaveLength(expectedServiceCount)
  expect(workflow.match(/- 5432:5432/g)).toHaveLength(expectedServiceCount)
}

function extractHostedLocalE2eScenarios(workflow: string): string[] {
  const literalCommands = Array.from(
    workflow.matchAll(/pnpm hosted-local e2e ([^\s\\"]+)/g),
    (match) => match[1],
  )
  const matrixScenarios = Array.from(
    workflow.matchAll(/^\s+scenarios:\s+(.+)$/gm),
    (match) => match[1].trim().split(/\s+/),
  ).flat()

  return Array.from(new Set([...literalCommands, ...matrixScenarios])).sort()
}

describe('cloudflare hosted e2e workflow guards', () => {
  it('provisions a real local postgres service for hosted local e2e jobs', () => {
    const workflow = readFileSync(hostedE2eWorkflowPath, 'utf8')
    const hostedLocalE2eScenarios = extractHostedLocalE2eScenarios(workflow)
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
    expect(hostedLocalE2eScenarios).not.toHaveLength(0)
    expect(postgresBackedScenarioCount).toBeGreaterThan(0)
    expectPostgresServiceContract(workflow, 1)
    expect(hostedLocalE2eScenarios).toEqual([
      'codex-image-media-delivery',
      'device-connect',
      'direct-r2-presigned-put',
      'idle-checkpoint-deferred-progress',
      'linq-delivery',
      'linq-scheduled-reminder',
      'linq-webhook',
      'telegram',
      'temporal-orchestration',
    ])
    expect(workflow).toContain('for scenario in ${{ matrix.scenarios }}; do')
    expect(workflow).toContain('pnpm hosted-local e2e "$scenario" --no-bundle')
    // The linq-webhook media job gates the Workers AI transcription path and
    // depends on the shared bundle shipping the e2e parser toolchain stub.
    expect(workflow).toContain('MURPH_RUNNER_BUNDLE_TEST_PARSER_TOOLCHAIN: "1"')
    expect(workflow).not.toContain('WHISPER_COMMAND')
    expect(workflow.match(/\.artifacts\/hosted-local\/\*\*\/state\.json/g)).toHaveLength(1)
    expect(workflow).not.toContain('pnpm --dir apps/cloudflare test:e2e:linq-delivery:local')
    expect(workflow).not.toContain('pnpm --dir apps/cloudflare test:e2e:telegram:local')
  })

  it('keeps the device-sync hosted e2e job on the same postgres service contract', () => {
    const workflow = readFileSync(hostedDeviceSyncE2eWorkflowPath, 'utf8')

    expect(workflow).toContain('DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/murph_test')
    expect(workflow).toContain('pnpm hosted-local e2e device-sync-junction-wearable-direct-resource-replay')
    expectPostgresServiceContract(workflow, 1)
    expect(workflow).toContain('.artifacts/cloudflare-hosted-device-sync-e2e/junction-wearable-direct-resource-replay.log')
    expect(workflow).toContain('.artifacts/hosted-local/**/state.json')
  })
})
