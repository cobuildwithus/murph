# Service live runtime wakes and signal Temporal at final release

Status: active
Created: 2026-10-23
Updated: 2026-10-23

## Goal

Reduce Temporal actions by removing checkpoint rechecks after proving that live
invocations service projected wakes and final owner release rechecks durable facts.

## Success criteria

- All wake reasons due before the live wait deadline use the existing runtime timer.
- Checkpoint gates, no-progress bounds, shutdown, and idle batching stay intact.
- Web checkpoints send no Temporal signal; only successful final completion release
  sends the attempt hint. Stale and early completions send none.
- Focused tests and relevant typechecks pass, with deployment dependencies documented.

## Scope and constraints

Runtime and Web only. Lane C owns the versioned workflow contract. Keep the receipt
column for old Web instances. Preserve rare out-of-attempt rechecks. Production is
read-only. The parent owns pushes, PRs, ReviewGPT, CI, merges, and deployment.

## Risks and mitigations

- Lost wakes: deploy workflow first, runtime second, Web last; prove idle and retained waits.
- Duplicate attempt hints: bind notification to the durable release compare-and-swap.
- Premature effects or busy loops: retain checkpoint gates and exact wake attempt guard.

## Tasks

1. Prove and generalize the existing projected-wake timer.
2. Remove checkpoint signaling and dead receipt machinery; bind end hints to final release.
3. Update contract owners, run focused proof and typechecks, review and commit.
4. Write the delegated handoff with rollout and net action estimates.

## Decisions

The parent decision makes runtime_owner_released an attempt-ended invalidation.
Only matching attempt identity clears accepted ownership. Runtime work must ship
before Web removes checkpoint signals; old warm invocations must first drain.

## Verification

Runtime implementation complete. The original future device-sync regression
failed (exit 1, no due pass); the generalized path passes. Focused runtime proof
covers four wake reasons, distinct successor wakes, clean voice retention,
background diagnostic retention past the idle floor, checkpoint gates, and
existing device import/receipt behavior. The extracted device alarm materializer
shares startup's existing claim owner; no scheduler or durable state was added.

- `pnpm --dir packages/assistant-runtime build`: exit 0.
- `pnpm --dir packages/assistant-runtime typecheck`: exit 0.
- Focused Vitest runtime selection across wake gates, voice, startup, and workspace
  runner: exit 0, 32 passed. Full wake-gate/voice files: exit 0, 31 passed before
  adding two successor cases. Final future-wake selection: exit 0, all 6 passed.
- `pnpm --dir apps/web typecheck`: exit 0.
- Web owner route/release, internal callbacks, and reconciliation-facts tests:
  exit 0, 212 passed.
- Local Postgres checkpoint atomicity and owner completion tests: exit 0,
  11 passed, including concurrent settled completions yielding one updated and
  one stale result. Only the task's synthetic local database was used.
- `pnpm complexity:diff`: exit 0; runtime complexity debt falls by 4.
- `pnpm docs:drift` and `pnpm docs:gardening`: exit 0.

Product evidence: Ready at deterministic scheduling/ownership boundaries. No
prompt, tool, model selection, or reply contract changed; a live model call would
not verify these timers or compare-and-swap transitions. No public changelog:
this is internal orchestration cost reduction preserving eligible work and
checkpoint dependencies. The parent retains exact-head CI, final ReviewGPT,
workflow replay/live verification, and release ownership.

Initial setup failures were resolved: compiled capture worker prerequisite,
a stale-date test fixture, obsolete signal expectations, and the migration-seeded
local cutover singleton missing after schema-only setup. An intermediate Web
typecheck caught the deleted receipt import before test cleanup; the final check
passes. Full commands and deployment accounting belong in the delegated handoff.
