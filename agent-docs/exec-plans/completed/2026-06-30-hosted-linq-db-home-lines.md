Goal (incl. success criteria):
- Move hosted Linq new home-line assignment away from `HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS` and make `hosted_linq_line` the DB source of truth for assignable lines.
- Preserve existing sticky member routes and current onboarding/first-contact behavior.
- Add the smallest safe migration path: schema fields, provider inventory sync, DB-backed assignment selection, cutover script, focused tests, and operator guide.
- Open a PR from the isolated branch, then run the required ReviewGPT PR loop to zero accepted findings.

Constraints/Assumptions:
- Keep the implementation narrow: no scheduler, queue, new line manager, or existing-member failover system.
- Use existing Prisma models, secure-box/encrypted phone helpers, home-line advisory lock, routing-store upserts, contact-card cron path, and routing-policy seam where possible.
- Provider-discovered lines are inventory only until explicitly configured by DB policy.
- Per-line daily new-conversation caps are enforced lazily at assignment time.
- No raw phone numbers, local paths, direct identifiers, secrets, or credentials in committed docs/logs/tests.

Key decisions:
- Use `hosted_member_routing.linq_home_line_assigned_at` for daily assignment counting rather than adding a counter table, because the existing home-line-pool advisory lock serializes assignment claims.
- Treat `hosted_linq_line.created_at` as Murph row creation time; add provider first/last-seen metadata instead of overloading it.
- Keep warmup as explicit DB policy and operator action, not automation.

State:
- Implementation complete in the isolated worktree; final commit/PR/ReviewGPT handoff remains.

Done:
- Read supplied Pro trace and Linq phone-line RTF guidance.
- Read repo routing, architecture, verification, security, reliability, iMessage deliverability, and PR ReviewGPT workflow docs.
- Created isolated worktree branch from fresh `origin/main`.
- Added DB-backed hosted Linq line inventory, encrypted line phone storage, provider inventory sync, assignment-time daily cap checks, cutover script, operator guide, and focused tests.
- Verified `pnpm --dir apps/web prisma:generate`, focused hosted Linq/invite/privacy tests, `pnpm --dir apps/web typecheck`, `pnpm --dir apps/web test:prepared`, `git diff --check`, and a privacy scan over the diff.

Now:
- Close the active plan with a scoped commit, push the isolated branch, and open the draft PR.

Next:
- Run ReviewGPT rounds on the opened PR to zero accepted findings.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/prisma/schema.prisma
- apps/web/prisma/migrations/20260630190000_hosted_linq_db_home_lines/migration.sql
- apps/web/src/lib/hosted-onboarding/linq-line-store.ts
- apps/web/src/lib/hosted-onboarding/linq-line-phone-codec.ts
- apps/web/src/lib/hosted-onboarding/linq-phone-number-inventory.ts
- apps/web/src/lib/hosted-onboarding/linq-routing-policy.ts
- apps/web/src/lib/hosted-onboarding/linq-home-routing.ts
- apps/web/src/lib/hosted-onboarding/hosted-member-routing-linq.ts
- apps/web/src/lib/hosted-onboarding/hosted-member-routing-store.ts
- apps/web/src/lib/hosted-onboarding/linq-contact-card.ts
- apps/web/src/lib/hosted-ops/onboarding-invites.ts
- apps/web/scripts/sync-hosted-linq-lines.ts
- docs/hosted-linq-db-home-lines-migration.md
- pnpm --dir apps/web prisma:generate
- pnpm exec vitest run apps/web/test/hosted-onboarding-linq-home-routing.test.ts apps/web/test/hosted-onboarding-linq-routing.test.ts apps/web/test/hosted-onboarding-linq-contact-card.test.ts apps/web/test/hosted-onboarding-linq-phone-number-inventory.test.ts apps/web/test/hosted-ops-onboarding-invites.test.ts apps/web/test/hosted-onboarding-linq-observability-store.test.ts apps/web/test/hosted-onboarding-member-store.test.ts apps/web/test/hosted-onboarding-member-service.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts --config apps/web/vitest.config.ts --no-coverage
- pnpm --dir apps/web typecheck
- pnpm --dir apps/web test:prepared
- git diff --check
Status: completed
Updated: 2026-06-30
Completed: 2026-06-30
