Goal (incl. success criteria):
- Enforce a hard ceiling of 50 Murph-initiated signup-welcome conversations per UTC day per Linq line.
- Choose another healthy assignable line when the preferred line has no welcome capacity.
- When every line is capped, complete activation without a proactive Linq welcome while preserving a usable assigned line for the member-initiated `Text Murph` path.
- Reuse the existing Postgres line pool, line row, and assignment advisory lock; add no service, queue, scheduler, or counter table.

Constraints/Assumptions:
- The cap applies only to participant-target signup welcomes that start a conversation; inbound-created or already-established threads remain replyable.
- Existing per-line `max_new_conversations_per_day` policy may lower the ceiling for warmup, but cannot raise it above 50.
- The current UTC day and count belong on each line so claims survive member deletion or reassignment; the line-pool advisory lock serializes selection and the conditional update independently fails closed at the limit.
- No backfill is required; existing lines have null day/count state and lazily start their first current-day counter.
- Preserve unrelated work and complete this task in the isolated PR worktree.

Key decisions:
- Count atomic signup-welcome reservations, not generic home-line assignments, so a member suppressed at the cap can still receive a line and initiate the conversation.
- Keep active-member capacity and line-health eligibility unchanged.
- Store only the current line-day counter on `HostedLinqLine`; historical delivery evidence remains in the existing delivery ledger.

State:
- Local implementation, direct proof, verification, and required coverage audit complete.

Done:
- Read the required repo architecture, workflow, verification, security, reliability, onboarding, and iMessage deliverability guidance.
- Read the supplied Linq iMessage best-practices PDF.
- Confirmed the existing home-line pool, per-line policy field, routing timestamp, advisory lock, and activation transaction provide the intended ownership boundary.
- Added line-owned UTC-day proactive capacity, the hard-50/lower-warmup policy, fallback selection, and all-lines-capped welcome suppression while preserving home-line assignment.
- Added focused policy, store, activation-routing, member-activation, and migration coverage; focused tests and hosted-web typecheck pass.
- Applied the full migration chain to a fresh isolated PostgreSQL database and proved the line counter starts lazily, rejects the 51st claim without incrementing, and resets to one on the next UTC day.
- Ran the full `pnpm test:diff` owner lane successfully after the final proof change: 5,385 tests passed, 141 skipped; typecheck, dev smoke, lint, and production build passed.
- Completed the required coverage-write audit; it added one narrow false-claim regression and reported no remaining actionable coverage gaps.

Now:
- Close the plan and create the scoped local-completion commit.

Next:
- Rebase onto the latest `main`, push the PR, and run ReviewGPT with CI before final handoff.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/prisma/schema.prisma
- apps/web/prisma/migrations/20260716190000_linq_signup_welcome_reservation/migration.sql
- apps/web/src/lib/hosted-onboarding/linq-home-routing.ts
- apps/web/src/lib/hosted-onboarding/linq-line-store.ts
- apps/web/src/lib/hosted-onboarding/linq-routing-policy.ts
- apps/web/test/hosted-onboarding-linq-home-routing.test.ts
- apps/web/test/hosted-onboarding-linq-line-store.test.ts
- apps/web/test/hosted-onboarding-linq-routing.test.ts
- apps/web/test/hosted-onboarding-member-activation.test.ts
- apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts
- agent-docs/operations/imessage-deliverability.md
- agent-docs/product-specs/murph-onboarding.md

Status: completed
Updated: 2026-07-16
Completed: 2026-07-16
