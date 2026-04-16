## Goal (incl. success criteria):

- Simplify the local Cloudflare hosted E2E harness by extracting shared fixtures/helpers and migrating the focused hosted-local specs onto them.
- Ignore the generated local Cloudflare worker config so the local harness does not leave untracked noise in the worktree.
- Success means the focused hosted-local E2E tests still pass, the generated local config is ignored, and the duplicate-commit + full-stack lanes both use reusable fixture helpers.

## Constraints/Assumptions:

- Preserve unrelated worktree edits.
- Keep runtime behavior unchanged; this is a test/harness refactor plus gitignore cleanup.
- Coordinate with the already-landed duplicate-commit helper commit and avoid rewriting it unnecessarily.

## Key decisions:

- Keep one shared full-stack hosted-local dev harness helper for the `pnpm dev`-backed E2E tests.
- Keep the duplicate-commit worker harness on its dedicated test-worker fixture path because it depends on the `__test/*` routes.
- Ignore only `apps/cloudflare/.wrangler/local-dev.generated.json`, not the whole `.wrangler/` directory.

## State:

- in_progress

## Done:

- Reviewed the hosted-local E2E harness duplication and identified the common lifecycle pieces to extract.
- Landed the duplicate-commit worker fixture in a separate prior commit.

## Now:

- Finalize the shared hosted-local dev harness, verify the focused E2E lanes, and land the remaining refactor plus ignore rule.

## Next:

- Run focused verification.
- Run required completion audits.
- Commit the scoped changes with `scripts/finish-task`.

## Open questions (UNCONFIRMED if needed):

- UNCONFIRMED: whether any further debug-state inspection should move out of the Linq spec now that bootstrap/lifecycle handling is shared.

## Working set (files/ids/commands):

- `.gitignore`
- `apps/cloudflare/test/helpers/hosted-local-dev-harness.ts`
- `apps/cloudflare/test/helpers/hosted-local-test-worker-fixture.ts`
- `apps/cloudflare/test/hosted-local-e2e.test.ts`
- `apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts`
- `apps/cloudflare/test/hosted-local-duplicate-commit-e2e.test.ts`
- `pnpm --dir apps/cloudflare test:e2e:linq-delivery:local`
- `pnpm --dir apps/cloudflare test:e2e:duplicate-commit:local`
- `pnpm typecheck`
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
