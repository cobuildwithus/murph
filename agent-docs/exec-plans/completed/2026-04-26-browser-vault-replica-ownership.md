Goal (incl. success criteria):
- Fix browser-vault session handling so a bound hosted user cannot make the Cloudflare worker read another user's browser-vault replica object key.
- Success means ownership is checked before R2 reads, the browser-vault session route binds the replica store to the route user, focused regression tests fail on the old behavior, and required verification/audits complete or are explicitly blocked by unrelated work.

Constraints/Assumptions:
- High-risk hosted trust-boundary bugfix; keep the diff narrow.
- Preserve unrelated active hosted Cloudflare and Health Commons work.
- Do not log or persist raw identifiers, secrets, local paths, or provider payloads.
- Browser-vault replica object keys are user-scoped opaque paths under `users/browser-vault-replicas/`.

Key decisions:
- Enforce user ownership inside `readBrowserVaultReplicaEnvelope` before `bucket.get`.
- Bind the browser-vault session route's replica store with the decoded route `userId`.
- Keep the generic parser structural only; user binding needs root-key-derived prefix validation in the Cloudflare store.

State:
- completed

Done:
- Classified as high-risk hosted trust-boundary bugfix.
- Confirmed the current session route constructs the replica store without `userId`.
- Confirmed `readBrowserVaultReplicaEnvelope` currently calls `bucket.get(ref.objectKey)` before ownership validation.
- Bound the browser-vault session route's replica store to `userId`.
- Added store-level ownership checks before replica reads and fail-closed unbound access.
- Mapped ownership failures to the stable missing-replica response without doing a replica-object read.
- Added focused store and route regression tests for foreign-prefix and unbound-read behavior.
- Required `security-privacy-review`, `coverage-write`, and `task-finish-review` passes completed; final low test gap was fixed.

Now:
- Complete.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED whether full repo acceptance is practical in this dirty concurrent tree.

Working set (files/ids/commands):
- `apps/cloudflare/src/index.ts`
- `apps/cloudflare/src/browser-vault-store.ts`
- `apps/cloudflare/test/browser-vault-store.test.ts`
- `apps/cloudflare/test/index.test.ts`
- `apps/cloudflare/test/runner-run-processor.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `pnpm --dir apps/cloudflare test:node apps/cloudflare/test/browser-vault-store.test.ts apps/cloudflare/test/index.test.ts` passed (41 tests)
- `pnpm --dir apps/cloudflare typecheck` passed
- `git diff --check -- <touched files>` passed
- `bash scripts/workspace-verify.sh test:diff <touched files>` blocked by unrelated Health Commons generation validation for collagen supplementation
- `pnpm typecheck` blocked by the same unrelated Health Commons generation validation during `apps/web` typecheck
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
