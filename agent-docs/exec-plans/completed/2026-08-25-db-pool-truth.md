# Make hosted Web database pressure and retry telemetry truthful

Status: completed
Created: 2026-08-25
Updated: 2026-08-25

## Goal

- Make hosted Web database pressure, retry, and slow-transaction signals truthful enough to distinguish transient pool handoff, safe retry, terminal failure, and callback wall time without recording private request data.

## Success criteria

- Idle capacity with a transient waiter is not reported as saturation or used to suppress a safe retry.
- Pre-dispatch checkout and physical connection-establishment failures receive the bounded retry already intended for no-work failures.
- Dashboard auth treats canonical Prisma P2024 pool exhaustion as recoverable.
- Existing database warnings carry bounded operation/attempt/outcome fields and atomic pool snapshots; slow callback telemetry no longer claims proven connection hold time.
- Focused unit and PostgreSQL integration proof pass; exact-head ReviewGPT and required PR checks resolve.

## Scope

- In scope: `apps/web/src/lib/prisma.ts`, dashboard page-auth recovery, their focused tests, and the hosted Web database telemetry contract in `apps/web/README.md`.
- Out of scope: changing pool size, adding a metrics backend, provider-under-transaction remediation owned by existing worktrees, and production deployment.

## Constraints

- Technical constraints: retry only errors proven to occur before SQL or transaction callback execution; keep log dimensions finite and identifier-free; preserve the two-attempt bound and 10-second per-pool sampling cap.
- Product/process constraints: internal reliability change with no visible UI; use a draft PR, focused proof, parallel preliminary/final ReviewGPT, and exact-head CI.

## Risks and mitigations

1. Risk: Broadening retries could replay a write.
   Mitigation: Split exact pre-dispatch categories and retain the callback-start fence.
2. Risk: New telemetry could expose request or member data.
   Mitigation: Log only static operation labels, numeric attempt/outcome fields, and pool counts; never args, SQL, errors, URLs, or identifiers.

## Tasks

1. Add failing tests for transient idle handoff, raw pre-callback checkout timeout, physical connection establishment, P2024 recovery, and expired callback telemetry.
2. Correct classification, retry, pressure, and telemetry behavior at the existing Prisma/page-auth owners.
3. Run focused Web verification and inspect the complete diff.
4. Commit, push, open the draft PR, launch preliminary and final ReviewGPT in parallel with CI, resolve findings, close this plan, and push the final scoped commit.

## Decisions

- Keep this PR within the existing Prisma and page-auth owners; no new service or persistence owner.

## Verification

- Commands to run: focused Vitest suites for Prisma retry/client and page auth; opt-in PostgreSQL retry suite when local Postgres is available; Web typecheck if changed types escape the focused surface; `git diff --check`.
- Expected outcomes: deterministic passing coverage for each no-work retry and fallback shape, secret-safe telemetry assertions, and no change to post-dispatch retry behavior.
Completed: 2026-08-25
