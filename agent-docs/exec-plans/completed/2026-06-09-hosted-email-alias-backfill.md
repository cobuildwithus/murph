Goal (incl. success criteria):
- Backfill deterministic hosted email reply-alias lookup keys for unsuspended hosted members who already have a verified email but no persisted reply alias.
- Provide a protected GitHub manual workflow that can dry-run and apply the backfill without copying the Vercel production database URL into GitHub.
- Success means workflow output is counts-only, the route is secret-gated, idempotent re-runs are safe, and production missing-alias count reaches zero for unsuspended verified-email members.

Constraints/Assumptions:
- Web remains the owner of hosted member routing and email authorization facts.
- Do not print or persist raw emails, member ids, alias addresses, alias lookup keys, database URLs, or trigger secrets in logs or workflow summaries.
- The production database URL exists in Vercel, not GitHub; the workflow must trigger a Vercel-hosted server-side mutation instead of moving that secret.
- Preserve unrelated working-tree edits and active ledger rows.

Key decisions:
- Add a narrow internal maintenance route guarded by a dedicated bearer secret instead of reusing user sessions or copying the database secret into GitHub.
- Reuse `createHostedMemberReplyAliasRoute` and `upsertHostedMemberReplyAliasLookupKeyTx` so alias derivation and routing-row creation follow existing owner code.
- Default the workflow to dry-run; require explicit `apply=true` to write.

State:
- In progress.

Done:
- Confirmed existing production verified-email members are missing reply aliases.
- Confirmed `HOSTED_EMAIL_SIGNING_SECRET` is present in Vercel, GitHub production, and Cloudflare.
- Confirmed GitHub production does not currently hold `DATABASE_URL` or `DIRECT_DATABASE_URL`.
- Added the secret-gated Vercel-hosted backfill route, manual GitHub workflow, route test, and workflow guard test.
- Passed focused tests, YAML parse, `pnpm typecheck`, and `pnpm test:diff`.
- Simplify review found workflow hardening and leakage-test improvements; accepted and verified those, and rejected billing-active restriction because the production repair scope is all unsuspended verified-email members.
- Security/privacy review and rerun found no medium-or-higher findings; names-only provider checks confirmed `HOSTED_WEB_BASE_URL` and the backfill secret are configured.
- Coverage-write added route query-shape and duplicate-alias collision proof; focused tests, `pnpm typecheck`, and `pnpm test:diff` passed afterward.
- User approved deploying and running the backfill before the remaining deep/final completion review passes.

Now:
- Close the plan with a scoped commit, deploy web, run the workflow dry-run, then run apply if dry-run counts are expected.

Next:
- Verify production missing-alias counts after the workflow run.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/app/api/internal/hosted-execution/email/backfill-reply-aliases/route.ts
- apps/web/test/hosted-execution-email-backfill-route.test.ts
- packages/cli/test/hosted-email-alias-backfill-workflow-guards.test.ts
- .github/workflows/backfill-hosted-email-reply-aliases.yml
- agent-docs/exec-plans/active/COORDINATION_LEDGER.md
Status: completed
Updated: 2026-06-09
Completed: 2026-06-09
