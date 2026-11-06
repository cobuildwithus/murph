# Drain covered device schedules after completion publication

Status: completed
Created: 2026-09-15
Updated: 2026-09-15

## Goal

Absorb redundant scheduled device requests arriving during checkpoint and completion publication without starting another runtime or provider pass.

## Scope and constraints

- Move the existing single bounded system-prefix drain after completion recording; reuse retained-owner coverage before the final checkpoint.
- Add an atomic Web schedule-tuple check to reject delayed stale sweep candidates.
- Preserve shared mailbox budgets, foreground priority, exact connection/epoch/cadence barriers, deferred import effects, future jobs, and checkpoint recovery.
- No polling, new persisted state, timer/size changes, schema migration, or production mutation.
- Internal background efficiency only; no assistant prompt or provider-input changes and no public changelog.

## Evidence and verification

- Existing bounded-after-read scenario confirms that late arrivals remain unread before this change.
- Add synthetic checkpoint/publication arrival regressions plus foreground, budget, newer work, failure, and cold-restore coverage.
- Run focused assistant-runtime and relevant Web tests, typechecks, complexity, docs checks, exact-head CI, and ReviewGPT.

## Progress

- Diagnosis complete: scheduled rows can arrive after the single drain and before completion recording.
- Implemented the post-publication bounded drain, retained-owner retirement, and locked exact schedule check.
- Recovery treats benign schedule/consent skips separately from real handoff failures.
- New checkpoint/publication arrival regressions fail against the base and pass with the fix; cold restore preserves future jobs without a repeat provider pass.
- Runtime entrypoint (82 tests), mailbox notification (163 tests), and runtime typecheck pass. Web unit tests (222), real Postgres tests (38), and Web typecheck also pass. Docs drift passes.
- Parent review found no new state owner or unbounded work. Complexity guard passes with unchanged hotspot debt and one less recovery branch.
- PR #3484 is open. ReviewGPT passed on 869cf343dda97ef715dedec236646aabf92aa15f with verified model/response identity and no findings; parent final review agrees.
- Implementation and focused proof are complete. Final exact-head CI remains a PR gate after this documentation-only closeout; no production deployment is included.
Completed: 2026-09-15
