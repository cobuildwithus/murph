import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const hostSupportWorkflowPath = path.join(repoRoot, '.github', 'workflows', 'host-support.yml')

describe('host support workflow guards', () => {
  it('keeps the hosted-web verify env placeholders aligned across release and support workflows', () => {
    const workflow = readFileSync(hostSupportWorkflowPath, 'utf8')

    expect(workflow).toContain('HOSTED_CONTACT_PRIVACY_KEYS: v1:BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc')
    expect(workflow).toContain('NEXT_PUBLIC_PRIVY_APP_ID: ${{ vars.HOSTED_WEB_VERIFY_PRIVY_APP_ID }}')
    expect(workflow).toContain('PRIVY_VERIFICATION_KEY: ci-hosted-web-verification-key')
    expect(workflow).toContain('run: pnpm release:check')
  })
})
