# Cloudflare Container SSH Workflow Env

## Goal

Pass the optional Container SSH public-key env through the GitHub immediate deploy
workflow so the already-rendered SSH config can be deployed for testing.

## Constraints

- Do not commit SSH key material or personal identifiers.
- Treat the public key as operator-local/GitHub environment configuration, not
  source-controlled data.
- Keep the pass-through narrow to `CF_CONTAINER_SSH_PUBLIC_KEY` and
  `CF_CONTAINER_SSH_KEY_NAME`.

## Verification

- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/deploy-automation.test.ts`
  passed.
- `git diff --check` passed for touched workflow/test/plan files.
Status: completed
Updated: 2026-05-13
Completed: 2026-05-13
