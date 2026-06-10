import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const workflowPath = path.join(
  repoRoot,
  '.github',
  'workflows',
  'backfill-hosted-email-reply-aliases.yml',
)

describe('hosted email reply-alias backfill workflow guards', () => {
  it('keeps the production backfill workflow manual, protected, and counts-only', () => {
    const workflow = readFileSync(workflowPath, 'utf8')

    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('type: boolean')
    expect(workflow).toContain("if: ${{ github.ref == 'refs/heads/main' && github.ref_protected }}")
    expect(workflow).toContain('environment: production')
    expect(workflow).toContain('cancel-in-progress: false')
    expect(workflow).toContain(
      'HOSTED_EMAIL_REPLY_ALIAS_BACKFILL_SECRET: ${{ secrets.HOSTED_EMAIL_REPLY_ALIAS_BACKFILL_SECRET }}',
    )
    expect(workflow).toContain('HOSTED_WEB_BASE_URL: ${{ vars.HOSTED_WEB_BASE_URL }}')
    expect(workflow).toContain(
      '/api/internal/hosted-execution/email/backfill-reply-aliases',
    )
    expect(workflow).toContain('missingReplyAliasCountAfter')
    expect(workflow).not.toContain('DATABASE_URL')
    expect(workflow).not.toContain('DIRECT_DATABASE_URL')
    expect(workflow).not.toContain('vercel env pull')
    expect(workflow).not.toContain('withmurph.ai')
  })
})
