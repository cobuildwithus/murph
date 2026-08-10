# Finalize iMessage workout session cards

## Goal

Finish the coordinated backend contract for native workout-session cards without introducing a second workout authority or synchronization path.

Success criteria:

- The canonical workout event remains the only mutable source of truth.
- V4 Messages payloads contain bounded presentation data and use the canonical product origin.
- The model-facing authoring schema remains small while runtime Zod validation remains authoritative.
- Ambiguous card commands fail closed instead of mutating a guessed workout.
- Display positions reconcile to canonical sparse workout coordinates before mutation.
- Targets remain plan-only; every actual result is member-entered.
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
4. Harden ambiguous-command and display-coordinate handling, including existing-set-only mutation.
5. Route ordinary start/resume requests through the workout and tracked-table owners.
6. Remove the ambiguous complete-at-target shortcut and preserve idempotent Finish replay.
7. Remove temporary remediation artifacts and run focused verification.

## Review disposition

- Accepted: V4 display positions were not canonical sparse workout coordinates. The assistant now reconciles the displayed names and counts to the canonical workout, maps positions to canonical orders, and the mutation command fails closed when the addressed set does not already exist.
- Accepted: ordinary start/resume requests did not reliably load the tracked-table owner or permit the initial workout card. Routing and card-tool guidance now cover that entry point.
- Accepted: replayed Finish commands were blocked by active-only preflight. Finish now resolves the exact event and uses the idempotent workout owner before set-command preflight.
- Accepted: the complete-at-target shortcut could turn a planned range, AMRAP, or other non-scalar target into a false actual. It is removed from both sides of the contract.
- Accepted: active cards could encode skipped sets. Runtime and native decoder contracts now reject that contradictory state.
- Accepted: the compact authoring schema had lost useful field constraints. Inline bounds and patterns are restored without references and remain under the prompt-schema ceiling.
- Rejected: exposing a native correlation token or canonical event id. The extension remains an immutable reader and visible composer-command source; transcript context and exact reconciliation fail closed when an old card is ambiguous.
- Deferred release proof: transcript badge, bubble sizing, forwarding, composer insertion, and offline reopening require a physical Messages device and remain a release gate. Neither coordinated PR is ready or merged.

## Verification

- `pnpm --dir packages/contracts typecheck`
- `pnpm --dir packages/operator-config typecheck`
- `pnpm --dir packages/vault-usecases typecheck`
- `pnpm --dir packages/cli typecheck`
- `pnpm --dir packages/assistant-engine typecheck`
- Contract workout-session suite: 7 tests passed.
- Operator response-card suites: 16 tests passed, including V3/V4 routing, canonical-origin fixtures, completed workouts, and skipped sets with and without targets.
- Assistant tracked-workout skill suite: 2 tests passed, including ambiguity-safe coordinate resolution.
- `pnpm docs:drift`
- The coordinated native reader PR passed both repository verification lanes after adding single-flight, failure-safe composer insertion and completed/skipped decoder coverage.
- After integrating `main`'s targeted live-workout commands, the three affected assistant skill suites passed (9 tests), `@murphai/assistant-engine` typechecked, and `pnpm docs:drift` passed.
- Remediation-focused backend verification passed 8 files and 109 tests, including response-card contracts, exact schema bounds, active/skipped rejection, sparse coordinate mapping, existing-set-only mutation, initial routing, and Finish convergence.
- The default CLI workout command lane passed 1 file and 3 tests.

## Parent product-experience revalidation

Product purpose verdict: the smallest complete experience is one ordinary start or resume request that produces the verified workout card, one member-entered set action per pending set, a replay-safe Finish action, and one narrow clarification only when transcript context cannot identify a single workout. The remediated flow meets that purpose without another identifier, authority owner, or setup step. No evidence-backed product-experience finding remains.

Evidence gap: simulator and contract proof cannot establish the real Messages transcript badge, bubble sizing, forwarding, composer insertion, or offline reopening. Those checks remain an explicit physical-device release gate rather than a claim of current proof.

The plan remains active until the native V4 reader is released before broad backend V4 emission.
