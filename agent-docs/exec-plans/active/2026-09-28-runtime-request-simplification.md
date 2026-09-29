# Reduce hosted runtime request amplification

Status: active
Created: 2026-09-28
Updated: 2026-09-28

## Goal

Remove premature command expiry, unnecessary recovery waits, and empty device-import work using existing owners.

## Success criteria

- Slow native readiness can use the existing command deadline while Web callbacks retain their individual timeout.
- Proven exact-target retirement permits bounded same-command admission; uncertainty never permits a successor.
- Empty summary reconciliation avoids needless import work; populated imports retain live source authority.
- Focused regression tests, affected typechecks, complexity review, and required PR review pass.

## Scope

- Murph runtime processing and Junction reconciliation, tests, and contract documentation.
- No production mutations, release, new state, caching layer, dependencies, or orchestration changes.

## Constraints

Keep Postgres admission, exact native stoppedness, fresh import authority, bounded recovery, and disconnect protection intact. Use synthetic evidence in durable artifacts.

## Risks and mitigations

- A deadline does not prove stoppedness: preserve the owner and forbid detached launch after expiry.
- Empty imports can have historical semantics: remove only work proven unnecessary for the affected reconcile path.
- Concurrent admission can advance: always claim canonical ownership again and retain the three-generation limit.

## Tasks

1. Reproduce command deadline and settled retirement behavior with focused tests.
2. Remove redundant budgets and waits at the existing runtime owner.
3. Prove and remove empty summary import work without reusing live authority across effects.
4. Verify, review the full diff, update owner docs, and complete the scoped PR workflow.

## Decisions

- Source of truth is Murph. Private orchestration was inspected read-only and remains outside edit scope.
- Prefer fewer operations over caching authenticated control responses.
- Internal scheduling and request efficiency only; no new member-facing controls or product promise.

## Verification

- Cloudflare focused tests: 57 passed across runtime processing and restore preparation.
- Device sync focused tests: 217 passed across empty/admission reads, bounded backfill, reconcile preflight, diagnostics, and historical windows.
- Both affected package typechecks passed; generated the local Prisma client required by the Cloudflare test-support type surface.
- Complexity guard passed: runtime maximum unchanged at 19; Junction executeJob fell from 96 to 95. Other listed Junction hotspots are unchanged and outside this bounded fix.
- Synthetic evidence: 12-second readiness succeeds with a 10-second callback limit; callbacks still expire at 10 seconds; command expiry cannot launch later; only confirmed release permits same-command re-admission.
- Empty bounded summary projection: source reads 2 to 1, imports 1 to 0. Populated summaries retain post-provider source admission. Three populated summary units now produce three imports rather than four.
- Parent review: no new owners, persistent state, configuration, dependencies, or protocol fields. Existing disconnect, history, native retirement, and mixed-controller fixtures remain covered.
- Product UX: Patch, Ready at the changed internal boundaries. Covered delayed startup, foreground recovery, uncertain stop, empty device results, populated import, and historical continuation. End-to-end production latency and aggregate request reduction are not claimed before deployment.
- Changelog: not applicable; internal runtime scheduling and redundant request removal without a new member-facing feature or contract.
- Remaining completion gates: exact-head CI and required final ReviewGPT. No merge or deployment is authorized by this task.
