# Cloudflare Hosted Usage Proxy Fix

## Goal

Restore hosted AI usage export after runner env hardening without re-exposing the broad hosted web internal token to the runner environment.

## Success Criteria

- Hosted runner usage export succeeds through a trusted worker-owned path.
- `HOSTED_EXECUTION_INTERNAL_TOKEN` remains absent from the runner env.
- Focused regression coverage proves the Cloudflare runner path still exports usage successfully.

## Scope

- `apps/cloudflare` runner/outbound wiring for a usage proxy host
- `packages/assistant-runtime` hosted usage export plumbing
- `packages/hosted-execution` shared proxy host/base URL contracts if needed
- targeted tests only

## Constraints

- Do not reintroduce broad hosted web internal token exposure into the runner env.
- Keep the fix narrow to hosted usage export.
- Preserve adjacent dirty worktree edits outside this lane.

## Verification

- `pnpm --dir apps/cloudflare typecheck`
- focused Cloudflare/runtime vitest coverage for the usage export path
Status: completed
Updated: 2026-03-29
Completed: 2026-03-29
