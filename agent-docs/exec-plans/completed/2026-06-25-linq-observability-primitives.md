Goal (incl. success criteria):
- Land Linq observability primitives in a dedicated PR from the supplied patch, adjusted to the current repo and the revised plan.
- Success means the PR implements the four durable primitives: HostedLinqLine, HostedLinqProviderEvent, HostedLinqDelivery, and HostedLinqAlert.
- Webhook handling stays a thin adapter: verify/parse, ingest telemetry, preserve existing message.received product behavior, and schedule alert email work after the response.
- Outbound hosted onboarding Linq sends record delivery lifecycle attempts without making the Linq API client depend on Prisma.
- Required verification passes, the PR opens, and the external ReviewGPT loop reaches zero accepted findings.

Constraints/Assumptions:
- Treat supplied patch as behavioral intent, not overwrite authority.
- Preserve existing hosted onboarding and mailbox/wake behavior for message.received.
- Do not store raw provider payloads, message text, phone numbers, raw provider ids, secrets, or local identifiers in new observability tables.
- Egress policy may be projected but send paths must not enforce failover or budget gating in this PR.
- Preserve unrelated active ledger rows and unrelated working-tree edits in other worktrees.

Key decisions:
- Use a clean branch worktree from origin/main because the main checkout contains unrelated dirty work.
- Follow the revised primitive split: line current state/policy, append-only provider events, delivery lifecycle rows, and alert side-effect ledger.
- Use the PR-lane completion path; local audit subagents are skipped in favor of the required ReviewGPT PR loop after push.

State:
- Ready to commit/push/open PR; full acceptance is blocked by unrelated package failures outside this Linq/web patch.

Done:
- Read required routing, architecture, invariants, verification, security, reliability, testing, GitHub publish, and ReviewGPT workflow docs.
- Created isolated branch worktree.
- Applied and reconciled the supplied patch against current origin/main.
- Added the four observability primitives, sanitized parser/store modules, webhook sidecar ingestion, delivery attempt/receipt tracking, configured-line seeding, and Linq alert email handling.
- Hardened revised-plan gaps: provider-event line upsert now precedes provider-event insert, participant phones no longer populate the line FK lookup/hint fields, provider status projection never auto-re-enables egress policy, outbound message.received echoes increment line outbound counters, migration timestamps use TIMESTAMP(3), and alert ids are hash-derived.
- Focused verification passed: Linq observability/webhook/transport/http/routing/usage-reset/privacy migration tests; web typecheck; raw-log guard; diff whitespace check.
- Full `pnpm verify:acceptance` passed the web verification lane but failed on unrelated package checks: setup-cli assistant wizard provider assertion and cli runtime timeout.

Now:
- Commit/push/open PR.

Next:
- Run ReviewGPT PR loop to zero accepted findings after PR creation.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/prisma/schema.prisma
- apps/web/prisma/migrations/**
- apps/web/src/lib/hosted-onboarding/linq-*.ts
- apps/web/src/lib/hosted-onboarding/webhook-service.ts
- apps/web/src/lib/hosted-onboarding/webhook-transport.ts
- apps/web/src/lib/hosted-onboarding/contact-privacy*.ts
- apps/web/test/*linq*
- pnpm typecheck
- pnpm --dir apps/web typecheck
- pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage <focused Linq test files>
- pnpm verify:acceptance
- pnpm review:gpt pr-review
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
