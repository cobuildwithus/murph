# Hosted-Local Docker Cleanup

## Goal

Make `pnpm dev` / `pnpm hosted-local up` and hosted-local E2E clean up generated local Cloudflare runner Docker residue on normal shutdown, failure, and Ctrl+C.

Success criteria:

- Stop paths remove generated local runner containers and generated `cloudflare-dev/runnercontainer:*` / `cloudflare-dev/deploysmokerunnercontainer:*` images for the active run.
- Hosted-local E2E performs the same cleanup in its finalizer and has a signal hook so Ctrl+C reaches cleanup before exit.
- Cleanup stays scoped to Murph/Cloudflare local runner artifacts and does not remove unrelated Docker volumes, databases, base images, or other project images.
- Focused tests cover the new cleanup selection and shutdown wiring.

## Constraints

- Preserve unrelated dirty worktree edits and active hosted-runner ledger rows.
- Do not expose local user/home identifiers or secrets in logs/docs/tests.
- Avoid global Docker destructive cleanup by default.

## Working Set

- `scripts/dev-hosted-local/runtime.ts`
- `scripts/dev-hosted-local/stack.ts`
- `scripts/dev-hosted-local/runtime.cleanup.test.ts`
- `scripts/dev-hosted-local/stack.test.ts`
- `scripts/hosted-local-run-cli.test.ts`
- `packages/hosted-local-harness/src/cli.ts`
- `packages/hosted-local-harness/src/e2e.ts`
- `packages/hosted-local-harness/src/process.ts`
- `apps/cloudflare/test/run-hosted-local-e2e-runner.test.ts`
Status: completed
Updated: 2026-05-12
Completed: 2026-05-12
