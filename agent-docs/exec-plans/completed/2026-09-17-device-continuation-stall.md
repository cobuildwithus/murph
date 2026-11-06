# Prevent device continuation wake churn

Status: completed
Created: 2026-09-17
Updated: 2026-09-17

## Goal

Honor deferred device webhook admission so future retries do not cause empty runtime starts.

## Scope and invariants

Use the existing mailbox eligibility projection for both scheduling and admission.
Preserve exact retained jobs, retry timestamps, connection authority, and foreground priority.
No new state, provider behavior, restart mechanism, or production mutation.

## Product UX

Outcome: device imports resume when work is due without repeated empty starts while waiting.
Reaches: retained history with deferred webhook work, fresh device work, and foreground work.
Proof: synthetic runnable selection and persisted mailbox wake tests, including retry expiry.

## Tasks

1. Reproduce future webhook hints incorrectly admitting retained owners.
2. Require due hints in the shared eligibility projection and pass the existing selection instant.
3. Verify due/future hints, retry expiry, foreground priority, and the composed mailbox owner.
4. Review the diff, run relevant typecheck and complexity checks, and commit the scoped fix.

## Evidence

Read-only diagnostics identify repeated empty passes while the retained owner and pending hint are both deferred.
The shared eligible-hint projection does not check the hint retry time.
Existing persisted-wake proof currently expects this premature wake; correct that expectation.

## Verification

- Before the fix, three focused assertions reproduced premature admission and wake projection.
- Focused device-hint and persisted mailbox-state suites: 104 tests passed.
- Empty/deferred mailbox preparation suite: 3 tests passed, including three early admissions with unchanged retained state.
- Composed workspace restore scenarios: 6 passed. Deferred work makes no provider calls before retry, then imports and clears the mailbox at the deadline. Fresh connection/manual work and equal-cadence follow-up remain supported.
- `pnpm --dir packages/assistant-runtime typecheck`: passed.
- `pnpm docs:drift` and `git diff --check`: passed.
- `pnpm complexity:diff`: passed; no change in existing complexity debt or hotspot maxima.
- Parent review: one existing due-time predicate shared by projection and claim; no new storage, I/O, provider retry, authority rule, or foreground work. Existing hotspot functions remain unchanged except passing the selection instant.
- Product UX: Ready for the scoped scheduling correction; retained work survives and executes when due. No public UI, prompt, reply, or data-format change.
- Changelog: not applicable; internal scheduling correction removes empty starts without changing provider retry deadlines or member-facing capabilities.
- Deployment: runner-only behavioral correction; no Web/Temporal schema change. Existing snapshots remain readable across versions; old runners retain the bug. PR CI, final ReviewGPT, and production rollout have not run in this local fix task. Live recovery requires deployment and bounded observation.
Completed: 2026-09-17
