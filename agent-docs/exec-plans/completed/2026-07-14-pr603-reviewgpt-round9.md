# PR 603 ReviewGPT Round 9 Remediation

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Preserve activation-before-channel-update causality in the existing local system-mailbox owner.
- Prevent the foreground pre-delivery channel barrier from acknowledging a route change before activation can create the managed onboarding follow-up.
- Keep the fresh foreground reply available on its input-scoped current route while the ordered system work remains pending.

## Accepted finding

1. Filtered `apply-member-channels-update` selection uses `pending.find(...)` and can leapfrog an earlier pending `apply-member-activation`; reconciliation then succeeds as a no-op when the managed automation does not exist, permanently consuming the newer desired route or revocation.

## Constraints

- Add no desired-route shadow state, repair loop, queue, or second reconciliation owner.
- Preserve filtered maintenance behavior for unrelated route actions.
- Block only a channel update that is causally behind an earlier pending activation.
- Keep foreground reply delivery input-scoped and non-duplicating while ordinary system maintenance drains activation followed by the update.

## Tasks

1. Add focused failing coverage for route replacement and explicit revocation queued behind activation.
2. Tighten filtered system-mailbox selection to preserve that one causal dependency.
3. Run focused owner tests/typechecks, affected completion audits, finish-task, push, CI, and exact-head ReviewGPT until clean.

## Verification log

- ReviewGPT round 9 on `0803a0a410d1`: one invariant finding received and accepted after tracing activation bootstrap, filtered queue selection, no-op reconciliation, and checkpoint removal.
- Failing reproduction: the parameterized route-replacement/revocation regression proved filtered selection could process the later channel update before activation. Its strengthened form also proved ordinary selection could leapfrog a backed-off activation and the filtered wake candidate could spin on the due update.
- Fix: filtered and ordinary system-mailbox selection now keep `apply-member-channels-update` behind any earlier pending activation; filtered and ordinary wake candidates use the activation retry time while that dependency is blocked.
- Focused notification suite: 23/23 passed after the final coverage-audit enhancement.
- Expanded assistant-runtime system-mailbox/workspace-phase/events suites: 275/275 passed.
- Assistant-engine managed cron runtime: 107/107 passed.
- Assistant-runtime and assistant-engine package typechecks passed.
- Coverage-write audit: no unresolved material gap; added ordinary-maintenance ordering and ordinary wake-candidate assertions.
- Security/privacy audit: no validated Medium+ finding; confirmed ordered activation/reconciliation, retained input-scoped foreground route authority, and no new shadow state or sensitive logging.
- Scoped `pnpm test:diff` passed dependency, workspace-boundary, hosted-runtime, Temporal, crypto, raw-health-log, and affected typecheck gates. Its parallel assistant-runtime run passed 1,602 tests and timed out six tests in three untouched concurrency-heavy files. A no-file-parallelism rerun of those exact files passed 298/298, proving the failures were load-induced rather than regressions.
- `git diff --check` passed.
Completed: 2026-07-14
