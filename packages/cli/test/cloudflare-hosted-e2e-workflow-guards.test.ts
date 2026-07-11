import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const hostedE2eWorkflowPath = path.join(repoRoot, '.github', 'workflows', 'cloudflare-hosted-e2e.yml')
const hostedDeployWorkflowPath = path.join(
  repoRoot,
  '.github',
  'workflows',
  'deploy-cloudflare-hosted.yml',
)

function extractWorkflowJob(workflow: string, jobName: string): string {
  const marker = `\n  ${jobName}:\n`
  const markerIndex = workflow.indexOf(marker)
  expect(markerIndex).toBeGreaterThanOrEqual(0)
  const jobStart = markerIndex + marker.length
  const remainingWorkflow = workflow.slice(jobStart)
  const nextJobIndex = remainingWorkflow.search(/\n  [a-z0-9-]+:\n/)
  return nextJobIndex === -1
    ? remainingWorkflow
    : remainingWorkflow.slice(0, nextJobIndex)
}

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

function expectHostedLocalCodexCliInstall(workflow: string): void {
  expect(workflow).toContain('Install Codex CLI for hosted-local model catalog')
  expect(workflow).toContain(
    "sed -n 's/^ARG CODEX_CLI_VERSION=//p' Dockerfile.cloudflare-hosted-runner-base | tail -n 1",
  )
  expect(workflow).toContain(
    'npm install --prefix "${npm_prefix}" --global --omit=dev --no-audit --no-fund --ignore-scripts "@openai/codex@${codex_cli_version}"',
  )
  expect(workflow).toContain('echo "${npm_prefix}/bin" >> "$GITHUB_PATH"')
  expect(workflow).toContain('"${npm_prefix}/bin/codex" --version')
}

function expectStableRequiredAggregator(input: {
  jobId: string
  jobName: string
  needs: readonly string[]
  workflow: string
}): void {
  expect(input.workflow).toContain(`  ${input.jobId}:\n    name: ${input.jobName}`)
  expect(input.workflow).toContain(`  ${input.jobId}:\n    name: ${input.jobName}\n    runs-on: ubuntu-24.04\n    needs:\n${
    input.needs.map((jobId) => `      - ${jobId}`).join('\n')
  }\n    if: \${{ always() }}`)
  for (const jobId of input.needs) {
    expect(input.workflow).toContain(`needs.${jobId}.result`)
  }
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
    expectHostedLocalCodexCliInstall(workflow)
    expect(hostedLocalE2eScenarios).not.toHaveLength(0)
    expect(postgresBackedScenarioCount).toBeGreaterThan(0)
    expectPostgresServiceContract(workflow, 1)
    expect(hostedLocalE2eScenarios).toEqual([
      'canonical-receipt-lost-ack-recovery',
      'codex-image-media-delivery',
      'computer-handoff-linq-roundtrip',
      'device-connect',
      'device-sync-junction-wearable-direct-resource-replay',
      'direct-r2-presigned-put',
      'family-sponsored-group-roundtrip',
      'idle-checkpoint-deferred-progress',
      'linq-delivery',
      'linq-group-route-drift',
      'linq-home-line-reroute-retry',
      'linq-lost-active-operation',
      'linq-onboarding-followup',
      'linq-scheduled-reminder',
      'linq-unknown-first-contact-fallback',
      'linq-webhook',
      'linq-webhook-audio',
      'openai-egress-authority',
      'provider-egress-token-bridge',
      'retell-call-result-roundtrip',
      'retryable-outbox-foreground-restart',
      'shutdown-checkpoint-conversation-ahead',
      'snapshot-publication-fallback',
      'telegram',
      'temporal-orchestration',
      'timezone-injection',
      'usage-limit-ambiguous-send',
      'vault-file-approval-resume',
      'warm-reuse-egress',
    ])
    expect(workflow).not.toContain('for scenario in ${{ matrix.scenarios }}; do')
    expect(workflow).toContain('pnpm hosted-local e2e "${scenarios[@]}" --no-bundle')
    expect(workflow).toContain('timeoutMinutes: 35')
    // The Linq webhook media scenario depends on the shared bundle shipping
    // the E2E parser toolchain stub.
    expect(workflow).toContain('MURPH_RUNNER_BUNDLE_TEST_PARSER_TOOLCHAIN: "1"')
    expect(workflow).not.toContain('WHISPER_COMMAND')
    expect(workflow.match(/\.artifacts\/hosted-local\/\*\*\/state\.json/g)).toHaveLength(1)
    expect(workflow).not.toContain('pnpm --dir apps/cloudflare test:e2e:linq-delivery:local')
    expect(workflow).not.toContain('pnpm --dir apps/cloudflare test:e2e:telegram:local')
    expectStableRequiredAggregator({
      jobId: 'hosted-e2e-required',
      jobName: 'Hosted E2E required gate',
      needs: ['runner-bundle', 'hosted-scenarios'],
      workflow,
    })
  })

  it('shortens only the routine scheduled-reminder gate', () => {
    const workflow = readFileSync(hostedE2eWorkflowPath, 'utf8')
    const deployWorkflow = readFileSync(hostedDeployWorkflowPath, 'utf8')
    const deployReminderJob = extractWorkflowJob(
      deployWorkflow,
      'linq-scheduled-reminder-gate',
    )

    expect(workflow).toContain([
      '          - name: Linq reminder + onboarding follow-up E2E',
      '            fastGate: "1"',
      '            slug: linq-reminder-onboarding-followup',
      '            scenarios: linq-scheduled-reminder linq-onboarding-followup',
    ].join('\n'))
    expect(deployReminderJob).toContain('pnpm hosted-local e2e linq-scheduled-reminder')
    expect(deployReminderJob).not.toContain('MURPH_HOSTED_LOCAL_E2E_FAST_GATE')
  })

  it('keeps the Junction replay and stable device-sync gate in the unified workflow', () => {
    const workflow = readFileSync(hostedE2eWorkflowPath, 'utf8')

    expect(workflow).toContain([
      '          - name: Junction wearable direct-resource replay E2E',
      '            slug: junction-wearable-direct-resource-replay',
      '            scenarios: device-sync-junction-wearable-direct-resource-replay',
      '            timeoutMinutes: 35',
    ].join('\n'))
    expectStableRequiredAggregator({
      jobId: 'hosted-device-sync-e2e-required',
      jobName: 'Hosted device-sync E2E required gate',
      needs: ['hosted-scenarios'],
      workflow,
    })
  })
})
