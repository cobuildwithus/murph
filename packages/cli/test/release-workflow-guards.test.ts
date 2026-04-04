import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const releaseWorkflowPath = path.join(repoRoot, '.github', 'workflows', 'release.yml')

describe('release workflow guards', () => {
  it('validates the git tag against the manifest-defined publish set', () => {
    const workflow = readFileSync(releaseWorkflowPath, 'utf8')

    expect(workflow).toContain('node scripts/verify-release-target.mjs --expect-version "${tag_version}"')
    expect(workflow).toContain("Tag '${GITHUB_REF_NAME}' is not a supported release tag.")
    expect(workflow).not.toContain('EXPECTED_PACKAGE_NAME')
    expect(workflow).not.toContain('EXPECTED_REPOSITORY_URL')
    expect(workflow).not.toContain('PACKAGE_JSON_PATH')
  })

  it('runs root release checks and packs all publishable tarballs with pnpm', () => {
    const workflow = readFileSync(releaseWorkflowPath, 'utf8')

    expect(workflow).toContain('- name: Run release checks')
    expect(workflow).toContain('MURPH_TEST_LANES_PARALLEL: "1"')
    expect(workflow).toContain('MURPH_APP_VERIFY_PARALLEL: "1"')
    expect(workflow).toContain('MURPH_VERIFY_STEP_PARALLEL: "1"')
    expect(workflow).toContain('run: pnpm release:check')
    expect(workflow).toContain('node scripts/pack-publishables.mjs --expect-version "${{ needs.tag-check.outputs.version }}" --clean --out-dir dist/npm --pack-output dist/npm/pack-output.json')
    expect(workflow).toContain('name: npm-tarballs')
    expect(workflow).not.toContain('npm pack --json')
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
    expect(workflow).not.toContain('npm install -g npm@latest')
    expect(workflow).toContain('if [[ -n "${{ needs.tag-check.outputs.npm_tag }}" ]]; then')
    expect(workflow).toContain('publish_args+=(--npm-tag "${{ needs.tag-check.outputs.npm_tag }}")')
    expect(workflow).toContain('node "${publish_args[@]}"')
    expect(publishHelper).toContain('version already exists')
    expect(publishHelper).toContain('Skipping ${entry.name}@${entry.version}; version already published.')
    expect(publishHelper).toContain('npm trusted publishing is configured per package on npm')
    expect(publishHelper).toContain('node scripts/configure-trusted-publishing.mjs')
  })
})
