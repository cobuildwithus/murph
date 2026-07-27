# PR 966 Round 9 Remediation

Status: completed
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Resolve the two round-nine integration regressions without adding another
  cleanup owner or media-delivery service.

## Success criteria

- Account deletion makes the existing bounded Cloudflare cleanup attempt
  before acknowledging completion and retains the encrypted receipt for
  timeout or provider failure.
- Private-media capabilities use and validate the current deployment's
  expected Worker origin, keeping preview and production isolated.
- Latest `origin/main` is an ancestor of the corrected PR head.
- Focused tests, canonical diff verification, correction ReviewGPT, and
  exact-head required CI pass.

## Scope

- In scope:
  - hosted account deletion cleanup invocation and focused tests
  - private-media Worker-origin configuration, validation, and focused tests
  - deployment variables and current security/deployment documentation
  - ordinary merge overlap from the latest `origin/main`
- Out of scope:
  - new cleanup queues, receipts, schedulers, or state machines
  - changes to the encrypted capability format or R2 ownership

## Constraints

- Keep the existing receipt and hourly retry as fallback ownership.
- Keep publication and deletion serialized by the existing UserRunner lock.
- Derive Web validation from the existing hosted execution control origin.
- Preserve production's exact-origin pin and preview environment isolation.

## Tasks

1. [x] Merge the latest `origin/main` and resolve any overlap.
2. [x] Restore the bounded immediate deletion cleanup attempt.
3. [x] Thread the configured Worker origin through publication and validation.
4. [x] Add focused regression proof and update affected durable docs.
5. [x] Run local verification and close the implementation plan. Push the
   closed-plan head next so correction ReviewGPT and exact-head CI can run
   against the merge candidate.

## Decisions

- Use the existing cleanup function, receipt, deadline, and retry cron.
- Use the existing `CF_PUBLIC_BASE_URL` / hosted control URL configuration
  rather than introduce capability negotiation or environment state.

## Verification

- Passed after the final base merge:
  - hosted Web focused Vitest: 4 files, 181 tests
  - hosted-execution parser Vitest: 1 file, 59 tests
  - Cloudflare private-media, runner-env, deploy, and serialization Vitest:
    6 files, 185 tests
  - assistant-runtime package-entrypoint boundary Vitest: 1 file, 18 tests
  - typechecks for hosted Web, Cloudflare runner, assistant runtime, and hosted
    execution
  - `git diff --check`, direct-identifier scan, and latest-base ancestry
- Earlier current-remediation proof also passed the full hosted-execution
  package suite (419 tests), expanded Cloudflare focused suites, and the same
  four owner typechecks before the final clean base merge.
- `pnpm test:diff <affected paths>` passed repository guards, every affected
  package typecheck, and all affected package suites. Its app phase could not
  acquire the non-FIFO shared-host slot after several unrelated Web,
  Cloudflare, and full-acceptance owners; the session-owned waiter was
  cancelled before app execution (exit 130).
- `pnpm verify:acceptance` was attempted next and hit the same unrelated
  full-acceptance slot owner before execution; that session-owned waiter was
  cancelled (exit 130). The focused owner proof above and fresh exact-head CI
  are the next-best validation.
- Correction ReviewGPT and exact-head CI run after this plan is archived and
  the resulting merge candidate is pushed.
Completed: 2026-07-27
