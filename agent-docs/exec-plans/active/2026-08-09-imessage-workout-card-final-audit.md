# Finalize iMessage workout session cards

## Goal

Finish the coordinated backend contract for native workout-session cards without introducing a second workout authority or synchronization path.

Success criteria:

- The canonical workout event remains the only mutable source of truth.
- V4 Messages payloads contain bounded presentation data and use the canonical product origin.
- The model-facing authoring schema remains small while runtime Zod validation remains authoritative.
- Ambiguous card commands fail closed instead of mutating a guessed workout.
- Focused typechecks, contract tests, skill tests, and documentation drift checks pass.

## Scope

- In: workout response-card contracts and encoding, assistant authoring schema, tracked-workout skill guidance, cross-platform fixture, focused tests, and card documentation.
- Out: workout storage, event mutation primitives, native networking or persistence, rollout enablement, and unrelated response-card kinds.

## Constraints

- Reuse the existing compact-table/card delivery path and canonical workout event.
- Keep canonical event ids and write authority out of native URLs.
- Preserve legacy card readers while authoring only the canonical origin.
- Prefer deletion and direct contracts over adapters, registries, or new services.

## Plan

1. Reconcile URL constants and the canonical card origin.
2. Keep runtime validation strict while bounding the model-facing schema.
3. Add completed/skipped-state and cross-platform coverage.
4. Harden ambiguous-command guidance and update durable documentation.
5. Remove temporary remediation artifacts and run focused verification.

## Verification

- `pnpm --dir packages/contracts typecheck`
- `pnpm --dir packages/operator-config typecheck`
- `pnpm --dir packages/assistant-engine typecheck`
- Contract workout-session suite: 7 tests passed.
- Operator response-card suites: 16 tests passed, including V3/V4 routing, canonical-origin fixtures, completed workouts, and skipped sets with and without targets.
- Assistant tracked-workout skill suite: 2 tests passed, including ambiguity-safe coordinate resolution.
- `pnpm docs:drift`
- The coordinated native reader PR passed both repository verification lanes after adding single-flight, failure-safe composer insertion and completed/skipped decoder coverage.
- After integrating `main`'s targeted live-workout commands, the three affected assistant skill suites passed (9 tests), `@murphai/assistant-engine` typechecked, and `pnpm docs:drift` passed.

The plan remains active until the native V4 reader is released before broad backend V4 emission.
