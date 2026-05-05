Goal (incl. success criteria):
- Add a local-development/e2e Linq inbound guard so shared Linq credentials cannot trigger production-user replies during local `pnpm dev` or hosted-local harness runs.
- Success: the guard is config-driven, disabled by default in production, blocks non-allowlisted inbound Linq senders before mailbox append/assistant wake, and does not commit real phone numbers or other personal identifiers.

Constraints/Assumptions:
- Do not hardcode real phone numbers or local identifiers in repo files.
- Preserve existing hosted Linq production behavior unless the new local guard env is intentionally configured.
- Keep the patch narrow around hosted Linq ingress and local harness config.
- Existing checkout has many unrelated active edits; preserve them.

Key decisions:
- Guard in hosted Linq webhook planning after contact normalization and before member lookup, daily counters, mailbox append, read receipts, or assistant wake.
- Use `HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS` as a local-only env var; reject it in production and require it before hosted-local enables local Linq webhook handling with real Linq credentials.

State:
- handoff

Done:
- Read mandatory repo workflow, architecture, security, reliability, and verification docs.
- Implemented local Linq inbound allowlist parsing and production rejection.
- Added hosted Linq ignore path for non-allowlisted local inbound senders before side effects.
- Added hosted-local tunnel setup guard requiring the allowlist when shared Linq webhook credentials are present.
- Added focused unit/integration coverage and local `.env` value without committing or printing the real phone number.
- Ran focused verification; broad verification/typecheck are blocked by unrelated dirty-tree device-sync/log-guard failures.

Now:
- Handoff with verification status; scoped commit is blocked by overlapping unrelated dirty work in coordination/plan files and existing dirty tree failures.

Next:
- Clear/archive this plan after the broader dirty worktree can safely stage plan/ledger changes, or commit the code slice separately if the repo policy owner approves excluding plan bookkeeping.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether to commit this slice without plan/ledger bookkeeping while the active checkout contains many unrelated dirty tasks.

Working set (files/ids/commands):
- Plan: `agent-docs/exec-plans/active/2026-05-05-local-linq-inbound-guard.md`
- Code/tests: `apps/web/src/lib/hosted-onboarding/env.ts`, `apps/web/src/lib/hosted-onboarding/linq-webhook.ts`, `apps/web/src/lib/hosted-onboarding/linq.ts`, `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`, `apps/web/test/hosted-onboarding-env.test.ts`, `apps/web/test/hosted-onboarding-linq-dispatch.test.ts`, `scripts/dev-hosted-local/config.ts`, `scripts/dev-hosted-local/config.test.ts`, `scripts/dev-hosted-local/linq-webhook-tunnel.ts`, `scripts/dev-hosted-local/linq-webhook-tunnel.test.ts`
- Docs/env: `apps/web/.env.example`, `apps/web/README.md`, local ignored `.env`
Status: completed
Updated: 2026-05-05
Completed: 2026-05-05
