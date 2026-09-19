# Avoid redundant wakes while preserving device history progress

Status: completed
Created: 2026-09-16
Updated: 2026-09-16

## Goal

Keep pending device history progressing without redundant hourly container starts or duplicate history roots.

## Success criteria

- Available sparse weight history is imported even while the provider reports a pending pull; pending status never certifies complete coverage.
- Schedule-time history has one source/resource/generation identity across day boundaries; source-first exact history preserves its window identity.
- A checkpointed content proof can defer already-owned future history until the earlier of the actual retry and proof expiry. New content, dirty work, new source authority, daily repair, missing proof, and other providers retain their normal admission paths.
- Focused regression tests, relevant typecheck, complexity review, and scoped commit pass. Live deployment and upstream provider completion are reported separately.

## Scope and constraints

Use the existing provider scheduler, local jobs, retained wake, and checkpoint-fenced reconcile proof. Add no queue, timer, credential access, or canonical health writer. Keep private diagnostic evidence out of repository artifacts. Preserve foreground priority and old-reader fail-open behavior.

## Product UX

Outcome: fewer idle starts and timely import of available weight history.
Reaches: established Junction sources with delayed history, fresh and reconnected sources, and existing non-Junction retained work.
Proof: synthetic pending-to-ready imports, day rollover dedupe, checkpoint/cold-restore scheduling, changed-content fallback, and proof expiry.
Disposition: Ready for local implementation. Production behavior awaits separately authorized delivery and observation.

## Tasks

1. Verify provider readiness against authenticated read-only diagnostics and inspect canonical import coverage.
2. Add regressions for pending sparse imports, stable history identity, and checkpoint-bound future-work deferral.
3. Implement the smallest corrections in existing owners and update their contracts.
4. Run focused checks and parent review; commit the scoped change.

## Decisions

- Provider pending status is real. It is a completion constraint, not proof that already available exact records cannot be imported.
- Defer history only when the scheduler proves all candidate roots already have active jobs and all retained jobs have future deadlines.
- Bound deferral by existing content-proof expiry; old readers reject the extended proof and fall back to normal work.

## Verification

- Provider regressions: 141 tests passed across Junction preflight, extended history, and resource aliases. Available pending weight data reached the real normalizer; coverage remained incomplete until upstream readiness changed.
- Runtime regressions: seven focused tests passed, including actual SQLite queue ownership, cold restore, checkpoint publication, dirty-work fallback, unowned-root fallback, and the earlier of retry or proof expiry.
- Both affected package typechecks passed, including test types. Changelog generation and all ten changelog-page tests passed.
- `pnpm complexity:diff`, `pnpm docs:drift`, `pnpm docs:gardening`, and `git diff --check` passed. Changed existing hotspots did not increase; the provider executor became simpler through a cohesive readiness helper.
- Actual base/current proof-reader compatibility passed: the current reader accepts both forms; the base reader rejects the extended form and takes normal-work fallback. No rollback floor is introduced.
- Parent diff review confirmed unchanged foreground routing, unchanged provider job retry timestamps and attempts, no added network operations in wake projection, bounded existing SQLite ownership lookup, and no new state owner.
- Private diagnostics stayed outside authored artifacts. No production mutation performed. Upstream completion remains pending and is never force-certified by this change.
Completed: 2026-09-16
