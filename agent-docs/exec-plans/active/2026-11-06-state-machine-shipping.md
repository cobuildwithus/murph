# Simplify and ship the state-machine fixes

Status: active
Created: 2026-11-06
Updated: 2026-11-06

## Goal

Ship the confirmed cross-app state-machine fixes after removing unnecessary operations and keeping canonical ownership simple, maintainable and composable.

## Success criteria

- Preserve every demonstrated retry, concurrency, auth and offline invariant.
- Remove only proven redundant complexity; keep necessary explicit-choice evidence.
- Publish scoped PRs, resolve required reviews and exact-head checks, merge through normal protected paths, and verify the supported backend/native release outcomes.
- Keep the shared state-machine inventory and linked issues current; distinguish merged source from deployed services and uploaded native builds.

## Scope and authority

The user explicitly requested shipping both repositories and prioritizing architectural simplicity. Reuse the existing task branches and preserve unrelated primary-checkout edits. Normal branch pushes, PR creation, guarded merge and supported release paths are authorized. No App Review submission, rollback, secret extraction, or unrelated cleanup is included.

## Decisions

- Murph's latest main remains c32c522e20fd; iOS main advanced to 60e6940, reconciled with an ordinary merge.
- Remove the redundant reminder player lock: the existing game FOR UPDATE lock coordinates with newly inserted preference facts through their foreign-key KEY SHARE lock. Existing immutable facts suppress copying their field. Retain independent off/every-day facts because older clients can omit every-day choice.
- Keep diagnostic conditional writes and the shared losing-transition reread; removing either would reintroduce false success or duplicate durable-winner mapping.
- Move iOS retained-cache writes out of generic Home presentation to accepted mutation owners; retain current revision/token/safety and block-cache boundaries.
- Murph uses the required final ReviewGPT alongside CI. iOS retains its selected independent local review gate without duplicating it with ReviewGPT; extend that review for the simplification/integration delta.
- The user has authorized local Xcode verification instead of the unavailable HEAVY wrapper. Licensing approval is already recorded in the native owner docs; do not request it again.

## Tasks

1. Inspect current heads, ownership and release contracts; reconcile new base changes.
2. Simplify at the existing owners and run focused regressions/typechecks.
3. Update inventory and PR evidence, commit, push and open draft PRs.
4. Finish candidate review, mark ready, run required final review and CI concurrently, and remediate accepted findings.
5. Close the plan on the final code candidate, merge exact checked heads, and verify backend/native release paths without secret extraction.
6. Update issues and report concrete shipped outcomes or remaining release gates.

## Verification

- Reminder simplification: activation 14 + diagnostic 16 tests pass, including 4 real PostgreSQL lock-order/optional-field cases and the 1,000-game bounded-query test. Focused lint and diff checks pass.
- Prior proof remains: ordinary reminders 28, warmup 6, upstream parser/inbox 54+25, and native 276; rerun affected compiled graphs for the new candidate.
- Final typechecks, native tests/review, exact-head hosted checks, final Murph ReviewGPT and deployment/upload proof remain in progress.
