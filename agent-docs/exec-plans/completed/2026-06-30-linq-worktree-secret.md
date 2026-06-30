Goal (incl. success criteria):
- Make hosted-local worktree startup derive the effective Linq webhook signing secret before starting web.
- Persist only the ignored local `LINQ_WEBHOOK_SECRET` override when Linq returns a secret, without logging or committing secret values.
- Success means `pnpm dev:worktree <slug>` starts web with the provider-matched webhook secret and does not require per-worktree dashboard origin/secret edits beyond the shared tunnel setup.

Constraints/Assumptions:
- Keep the fix inside `packages/hosted-local-harness`; do not add a new route, daemon, or app-side fallback.
- Treat `.env.local` as ignored sensitive local input; never print values.
- Linq may not expose signing secrets for existing subscriptions, so startup may need to create an exact local subscription to obtain one.
- Preserve unrelated active ledger rows and worktree edits.

Key decisions:
- Resolve/register the Linq webhook before spawning web so the effective secret is available in the child env.
- Prefer provider-returned signing secrets over stale local/Vercel values for local dev.
- Keep provider mutation narrow to local webhook subscription registration; do not add provider delete/update logic.

State:
- Verification passed; ready to commit and restart the worktree stack.

Done:
- Confirmed current stack rejects Linq webhooks with `LINQ_SIGNATURE_INVALID`.
- Confirmed registration currently runs after web startup, too late to affect `process.env`.
- Moved Linq webhook registration before child process env construction.
- Added provider-secret adoption and ignored local `apps/web/.env.local` upsert for `LINQ_WEBHOOK_SECRET`.
- Added focused hosted-local harness tests and updated worktree dev docs.

Now:
- Finish the scoped task commit and restart the local PR worktree stack.

Next:
- Confirm the stack starts with the adopted local Linq signing secret.

Open questions (UNCONFIRMED if needed):
- Whether Linq lists existing subscription secrets in all cases; implementation must work when it only returns the secret on create.

Working set (files/ids/commands):
- packages/hosted-local-harness/src/dev-hosted-local/linq-webhook-tunnel.ts
- packages/hosted-local-harness/src/dev-hosted-local/stack.ts
- packages/hosted-local-harness/test/dev-hosted-local/linq-webhook-tunnel.test.ts
- packages/hosted-local-harness/test/dev-hosted-local/stack.test.ts
- agent-docs/operations/hosted-local-worktree-dev.md
Status: completed
Updated: 2026-06-29
Completed: 2026-06-29
