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
- UNCONFIRMED until live reproduction and static trace complete.

State:
- in_progress

Done:
- Read required repo workflow, architecture, product, verification, security, reliability, and testing docs.
- Traced the stack to hosted-local readiness, runner image alias repair, and runner-container deploy smoke.

Now:
- Reproduce or isolate the exact post-health failure and patch the narrow harness behavior.

Next:
- Run focused hosted-local tests, typecheck, required completion audits, and scoped commit.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether the immediate failure is missing runner image alias repair, deploy-smoke failure, or process-output redaction/actionability.

Working set (files/ids/commands):
- `scripts/dev-hosted-local/stack.ts`
- `scripts/dev-hosted-local/stack.test.ts`
- `agent-docs/exec-plans/active/2026-05-02-hosted-local-docker-startup-diagnostics.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

Verification:
- Pending.
