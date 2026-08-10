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
- Accepted from exact-head CI: the pinned App Server removes `propertyNames`, so nutrition V2 macro names disappeared from its supported schema projection even though the raw schema remained valid. Every macro is now an explicit property, while one inline `patternProperties` rule keeps the repeated macro constraints strict and the complete schema below both 5,000-byte ceilings.
- Accepted from exact-head CI: generated Incur configuration and type artifacts did not include `requireExistingSet`. They are regenerated from the prepared built CLI entrypoint and covered by package-shape verification.
- Accepted from exact-head CI and local assembly: the intentional workout contract and command growth exceeded the runner's measured output ratchets. The total and static-closure baselines use the larger exact Ubuntu/macOS measurements; the entry baseline and all tolerances remain unchanged.
- Accepted from final ReviewGPT round 2: persisted V4 cards establish a Worker-and-runner rollback floor after either the local outbox or hosted side-effect owner accepts them. The product spec now requires coordinated reader-first deployment, forward recovery or explicit quarantine restoration, and exact persisted-owner round-trip tests for both paths.
- Accepted from final ReviewGPT round 2: workout cards duplicated progress in generic table rows and the structured workout payload. The runtime contract now has two closed variants; workout cards author only `workout.exercises`, and renderers derive all workout progress from that single presentation source.
- Final ReviewGPT round 3 passed with no qualifying finding. Parent triage accepted its App Server evidence discrepancy and added one structured-workout call to the real boundary test; the compact authoring schema remains intentionally smaller than the authoritative strict runtime schema, and optional subtitle copy is not a second structured state projection.
- Accepted from exact-head CI: Ubuntu's full assistant coverage lane measured the resident route layer at 57,050 characters after applying current main's named-diet guidance, while the pre-merge focused lane measured 56,973. A same-head rerun reproduced the Ubuntu result. The existing live-workout route hint is shortened without changing its two-skill instruction; after merging current main the focused layer is 56,973 and the 57,000 ratchet remains unchanged.
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
- CLI package-shape verification passed with regenerated config schema, Incur types, and skill hash.
- The pinned real App Server boundary preserved both response-card shapes after schema projection (1 focused test passed).
- Response-card authoring and workout contract suites passed 21 focused tests after the projection fix; the runner bundle budget policy suite passed 42 tests.
- Full Cloudflare runner assembly passed at 9,969,877 total bytes, 7,994,746 static-closure bytes, and 1,659,589 entry bytes under the reviewed baselines and unchanged tolerances.
- The two closed compact-table runtime variants passed 17 contract tests and 16 operator response-card tests; both the raw and App Server-projected authoring schemas remained below 5,000 bytes.
- Local outbox save/list/read and hosted side-effect JSON round trips preserved the V4 workout payload; their focused suites passed 1 selected outbox test and 24 hosted side-effect tests.
- The final four affected packages typechecked, and the workout skill suites passed 10 tests after removing duplicate model-authored table progress.
- The real App Server boundary passed after submitting generic compact-table, structured-workout, and nutrition authoring calls.
- The focused resident-prompt ratchet passed at 56,896 characters before the current-main merge and 56,973 after it, under the unchanged 57,000 ratchet.
- The current-main runner-budget conflict was resolved from a combined assembly: 9,994,210 total bytes, 8,019,079 static-closure bytes, and 1,659,616 entry bytes. The total and static baselines use those measurements; the entry baseline and every tolerance remain unchanged.

## Parent product-experience revalidation

Product purpose verdict: the smallest complete experience is one ordinary start or resume request that produces the verified workout card, one member-entered set action per pending set, a replay-safe Finish action, and one narrow clarification only when transcript context cannot identify a single workout. The remediated flow meets that purpose without another identifier, authority owner, or setup step. No evidence-backed product-experience finding remains.

Evidence gap: simulator and contract proof cannot establish the real Messages transcript badge, bubble sizing, forwarding, composer insertion, or offline reopening. Those checks remain an explicit physical-device release gate rather than a claim of current proof.

The plan remains active until the native V4 reader is released before broad backend V4 emission.
