import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const releaseWorkflowPath = path.join(repoRoot, '.github', 'workflows', 'release.yml')

function findMutableActionRefs(workflow: string): Array<{ line: number; ref: string; uses: string }> {
  const findings: Array<{ line: number; ref: string; uses: string }> = []
  const lines = workflow.split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const match = /^\s*-?\s*uses:\s+([^@\s]+)@([^\s#]+)/u.exec(line)
    if (!match) {
      continue
    }

    const ref = match[2] ?? ''
    if (!/^[a-f0-9]{40}$/u.test(ref)) {
      findings.push({
        line: index + 1,
        ref,
        uses: match[1] ?? '',
      })
    }
  }

  return findings
}

describe('release workflow guards', () => {
  it('validates the git tag against the manifest-defined publish set', () => {
    const workflow = readFileSync(releaseWorkflowPath, 'utf8')

    expect(workflow).toContain('node-version-file: .nvmrc')
    expect(workflow).toContain('node scripts/verify-release-target.mjs --expect-version "${tag_version}"')
    expect(workflow).toContain("Tag '${GITHUB_REF_NAME}' is not a supported release tag.")
    expect(workflow).not.toContain('EXPECTED_PACKAGE_NAME')
    expect(workflow).not.toContain('EXPECTED_REPOSITORY_URL')
    expect(workflow).not.toContain('PACKAGE_JSON_PATH')
  })

  it('runs root release checks and packs all publishable tarballs with pnpm', () => {
    const workflow = readFileSync(releaseWorkflowPath, 'utf8')
    const releaseChecksStart = workflow.indexOf('      - name: Run release checks')
    const releaseChecksEnd = workflow.indexOf('      - name: Pack publishable packages')
    const releaseChecksStep = workflow.slice(releaseChecksStart, releaseChecksEnd)

    expect(workflow).toContain('DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:1/murph_test')
    expect(workflow).toContain('HOSTED_DEVICE_ROUTING_INDEX_KEY: 0101010101010101010101010101010101010101010101010101010101010101')
    expect(workflow).toContain('HOSTED_MAILBOX_FINGERPRINT_KEY: BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc')
    expect(workflow).toContain('HOSTED_CONTACT_PRIVACY_KEYS: v1:BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc')
    expect(workflow).toContain('NEXT_PUBLIC_PRIVY_APP_ID: ${{ vars.HOSTED_WEB_VERIFY_PRIVY_APP_ID }}')
    expect(workflow).toContain('PRIVY_VERIFICATION_KEY: ci-hosted-web-verification-key')
    expect(releaseChecksStart).toBeGreaterThanOrEqual(0)
    expect(releaseChecksEnd).toBeGreaterThan(releaseChecksStart)
    expect(releaseChecksStep).not.toContain('NODE_OPTIONS')
    expect(releaseChecksStep).toContain('run: pnpm release:check')
    expect(workflow).not.toContain('NODE_OPTIONS')
    expect(workflow).toContain('MURPH_TEST_LANES_PARALLEL: "1"')
    expect(workflow).toContain('MURPH_APP_VERIFY_PARALLEL: "1"')
    expect(workflow).toContain('MURPH_VERIFY_STEP_PARALLEL: "1"')
    expect(workflow).toContain('node scripts/pack-publishables.mjs --expect-version "${{ needs.tag-check.outputs.version }}" --clean --out-dir dist/npm --pack-output dist/npm/pack-output.json')
    expect(workflow).toContain('name: npm-tarballs')
    expect(workflow).not.toContain('cache: pnpm')
    expect(workflow).toContain('scope: "@murphai"')
    expect(workflow).not.toContain('name: Update npm')
    expect(workflow).not.toContain('run: npm install -g npm@latest')
    expect(workflow).not.toContain('npm pack --json')
  })

  it('keeps the artifact guard ahead of every permanent publication boundary', () => {
    const workflow = readFileSync(releaseWorkflowPath, 'utf8')
    const packHelper = readFileSync(
      path.join(repoRoot, 'scripts', 'pack-publishables.mjs'),
      'utf8',
    )
    const publishHelper = readFileSync(
      path.join(repoRoot, 'scripts', 'publish-publishables.mjs'),
      'utf8',
    )

    const uploadStart = workflow.indexOf('uses: actions/upload-artifact@')
    const uploadEnd = workflow.indexOf('  github-release:')
    const uploadStep = workflow.slice(uploadStart, uploadEnd)
    const downloadIndex = workflow.indexOf('uses: actions/download-artifact@', uploadEnd)
    const downloadedGuardIndex = workflow.indexOf(
      'node scripts/release-artifact-secret-guard.mjs --pack-output dist/npm/pack-output.json',
      downloadIndex,
    )
    const githubReleaseIndex = workflow.indexOf(
      'uses: softprops/action-gh-release@',
      downloadedGuardIndex,
    )
    const packGuardIndex = packHelper.lastIndexOf(
      'await verifyReleaseArtifacts(context.repoRoot, packOutput)',
    )
    const manifestWriteIndex = packHelper.indexOf(
      'await writeJson(packOutputPath, packOutput)',
      packGuardIndex,
    )
    const publishGuardIndex = publishHelper.indexOf(
      'await verifyReleaseArtifacts(context.repoRoot, packOutput)',
    )
    const npmPublishIndex = publishHelper.indexOf(
      'await execFileStreaming(',
      publishGuardIndex,
    )

    expect(uploadStart).toBeGreaterThanOrEqual(0)
    expect(uploadStep).toContain('retention-days: 1')
    expect(downloadIndex).toBeGreaterThan(uploadEnd)
    expect(downloadedGuardIndex).toBeGreaterThan(downloadIndex)
    expect(githubReleaseIndex).toBeGreaterThan(downloadedGuardIndex)
    expect(packGuardIndex).toBeGreaterThanOrEqual(0)
    expect(manifestWriteIndex).toBeGreaterThan(packGuardIndex)
    expect(publishGuardIndex).toBeGreaterThanOrEqual(0)
    expect(npmPublishIndex).toBeGreaterThan(publishGuardIndex)
  })

  it('keeps prerelease routing, primary-package release notes, and ordered publish helper usage', () => {
    const workflow = readFileSync(releaseWorkflowPath, 'utf8')
    const publishHelper = readFileSync(
      path.join(repoRoot, 'scripts', 'publish-publishables.mjs'),
      'utf8',
    )

    expect(workflow).toContain('alpha')
    expect(workflow).toContain('beta')
    expect(workflow).toContain('rc')
    expect(workflow).toContain('manifest.releaseArtifacts.releaseNotesDir')
    expect(workflow).toContain('bash scripts/generate-release-notes.sh')
    expect(workflow).toContain('publish_args=(')
    expect(workflow).toContain('scripts/publish-publishables.mjs')
    expect(workflow).not.toContain('NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}')
    expect(workflow).not.toContain('Using NPM_TOKEN authentication for npm publish.')
    expect(workflow).not.toContain('falling back to trusted publishing')
    expect(workflow).not.toContain('unset NODE_AUTH_TOKEN')
    expect(workflow.match(/node-version-file: \.nvmrc/g)).toHaveLength(3)
    expect(workflow.match(/scope: "@murphai"/g)).toHaveLength(2)
    expect(workflow.match(/name: Update npm/g) ?? []).toHaveLength(0)
    expect(workflow).not.toContain('run: npm install -g npm@latest')
    expect(workflow).toContain('if [[ -n "${{ needs.tag-check.outputs.npm_tag }}" ]]; then')
    expect(workflow).toContain('publish_args+=(--npm-tag "${{ needs.tag-check.outputs.npm_tag }}")')
    expect(workflow).toContain('node "${publish_args[@]}"')
    expect(publishHelper).toContain('version already exists')
    expect(publishHelper).toContain('Skipping ${entry.name}@${entry.version}; version already published.')
    expect(publishHelper).toContain('npm trusted publishing is configured per package on npm')
    expect(publishHelper).toContain('node scripts/configure-trusted-publishing.mjs')
    expect(publishHelper).toContain("new Error('Release publication command failed.')")
    expect(publishHelper).not.toContain('Command failed: ${command}')
  })

  it('pins every action ref used by the npm release path', () => {
    const workflow = readFileSync(releaseWorkflowPath, 'utf8')

    expect(findMutableActionRefs(workflow)).toEqual([])
    for (const expectedLine of [
      'uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6',
      'uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6',
      'uses: pnpm/action-setup@fc06bc1257f339d1d5d8b3a19a8cae5388b55320 # v5',
      'uses: actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f # v6',
      'uses: actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131 # v7',
      'uses: softprops/action-gh-release@3bb12739c298aeb8a4eeaf626c5b8d85266b0e65 # v2',
    ]) {
      expect(workflow).toContain(expectedLine)
    }
  })
})
