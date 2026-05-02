# Hosted Local Docker Startup Diagnostics

Goal (incl. success criteria):
- Root-cause and fix the `pnpm dev` / `hosted-local up` startup failure that happens after web health checks and prints Docker diagnostics.
- Keep the hosted-local harness fail-fast for real runner/container smoke failures while making the emitted error actionable and privacy-safe.
- Add focused regression coverage for the failure mode.

Constraints/Assumptions:
- Preserve unrelated dirty work and active hosted-local rows.
- Do not print, fixture, or persist secrets, raw identifiers, raw request bodies, local account names, or absolute local paths.
- Keep this scoped to hosted-local startup tooling unless root cause requires a narrower app/package fix.

Key decisions:
- The Docker diagnostics block was secondary output from `appendStartupDiagnostics`; the actual failure was Linq registration returning HTTP 500 for a duplicate `POST /webhook-subscriptions`.
- Keep registration enabled by default, but make it idempotent by listing existing Linq webhook subscriptions first and treating an active exact target/event/phone-number match as already registered.

State:
- in_progress

Done:
- Read required repo workflow, architecture, product, verification, security, reliability, and testing docs.
- Traced the stack to hosted-local readiness, runner image alias repair, and runner-container deploy smoke.
- Reproduced the live failure: public tunnel GET reached the local webhook with HTTP 200; Linq token GET `/webhook-subscriptions` returned HTTP 200; duplicate POST `/webhook-subscriptions` returned HTTP 500.
- Patched hosted-local Linq registration to check the remote subscription list and seed the local cache before attempting create.
- Focused tests for Linq tunnel registration and hosted-local stack passed.
- Live startup with registration enabled reached the ready token after logging that the target was already registered.
- Security/privacy and simplify audits found the same medium issue: remote matching accepted subscriptions with extra events; patched to require exact event-set equality and added regression coverage.

Now:
- Running final completion review.

Next:
- Apply any final review fixes, then create scoped commit.

Open questions (UNCONFIRMED if needed):
- None currently.

Working set (files/ids/commands):
- `scripts/dev-hosted-local/linq-webhook-tunnel.ts`
- `scripts/dev-hosted-local/linq-webhook-tunnel.test.ts`
- `agent-docs/exec-plans/active/2026-05-02-hosted-local-docker-startup-diagnostics.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

Verification:
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/dev-hosted-local/linq-webhook-tunnel.test.ts --no-coverage` passed.
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/dev-hosted-local/stack.test.ts --no-coverage` passed.
- Live focused startup command with runner bundle/smoke and Stripe listener disabled reached hosted-local ready token with Linq registration enabled.
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/dev-hosted-local/linq-webhook-tunnel.test.ts scripts/dev-hosted-local/stack.test.ts --no-coverage` passed after audit fix.
- `pnpm typecheck` passed after audit fix.
