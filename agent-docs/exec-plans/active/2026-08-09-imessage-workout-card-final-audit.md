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
- macOS and iPhones without the extension receive a compact static workout or
  generic-table image whose captions retain every presentation value.
- Focused typechecks, contract tests, skill tests, and documentation drift checks pass.

## Scope

- In: workout response-card contracts and encoding, assistant authoring schema,
  tracked-workout skill guidance, cross-platform fixture, compact-table static
  image fallback, focused tests, and card documentation.
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
8. Reuse the nutrition image route for strict V3/V4 envelopes, render the native
   compact-table presentation, and preserve complete provider captions.
9. Correct the merged static fallback in a follow-up PR: preserve labeled
   completed-set target/actual semantics, keep continuation copy
   channel-neutral, derive `Next` from the first pending set, and size wrapped
   rasters from the same deterministic layout calculation.

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
- Accepted from final ReviewGPT round 5: the object-keyed V4 wire exceeded 2,048 characters for a realistic six-exercise, four-set workout late in the session. Only the immutable native serialization now uses positional exercise and set tuples; the readable authoring/runtime contract, canonical event, delivery owners, and mutation path remain unchanged. Production-faithful initial, 18-of-24 active, and completed fixtures pin the capacity boundary, and the coordinated Swift reader strictly decodes the same tuple shape.
- Accepted from the static-fallback extension: the prior provider layout reduced
  workout and generic tables to a short caption. V3/V4 now reuse the stateless
  image route and native visual language, while complete captions retain every
  cell and workout-set semantic independently of raster availability. V3
  tracking remains transcript-only and V4 remains authority-free.
- Accepted from exact combined assembly: current main independently measured a
  9,014,016-byte CLI bundle against the stale 9,000,000-byte ceiling. The merged
  candidate measured 9,027,632 bytes after the reported largest inputs were
  inspected. The total budget is narrowly ratcheted to 9,030,000; the 20,000-byte
  entry budget and all runner entry, static-closure, and total tolerances remain
  unchanged.
- Accepted from final ReviewGPT round 7: completed-set captions retained only
  the actual value, losing the completed status and distinct planned target in
  both provider and definitive text fallbacks. The existing semantic projection
  now labels status, actual, and target without adding a second formatter.
- Accepted from final ReviewGPT round 7 and the preliminary specialist pass:
  shared workout footer copy promised native-only taps, and the image renderer
  could skip a targetless first pending set to show a later target as `Next`.
  Workout authoring now requires channel-neutral reply guidance, and the static
  summary derives `Next` from the first pending set in order.
- Accepted from the preliminary specialist pass: contract-valid long table
  values could overlap or clip because raster height depended only on row count.
  One deterministic wrapping calculation now owns both visible line breaks and
  image height while retaining the ordinary compact layout for short content.
- External rollout event: PR #1502 merged before round 7 and the specialist pass
  completed. Their accepted behavior findings therefore land in a separate
  follow-up PR; round 8 is not started on the merged PR.
- Rejected: exposing a native correlation token or canonical event id. The extension remains an immutable reader and visible composer-command source; transcript context and exact reconciliation fail closed when an old card is ambiguous.
- Deferred release proof: transcript badge, bubble sizing, forwarding, composer insertion, and offline reopening require a physical Messages device and remain a release gate. PR #1502 merged externally before that gate closed; the follow-up must stay draft until the missing evidence is captured.

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
- ReviewGPT round 4 passed the pre-merge remediation head. Round 5 on the merged head found the realistic V4 wire-capacity failure described above. Its tuple-wire remediation passed 7 contract tests, 9 operator encoder/fixture tests, 2 focused assistant boundary/tool tests, all 3 affected package typechecks, documentation drift, and the 42-test runner bundle budget policy suite. Full runner assembly passed at 9,994,191 total bytes, 8,019,060 static-closure bytes, and 1,659,616 entry bytes under the reviewed baselines and unchanged tolerances. Final backend ReviewGPT round 6 passed the exact product head `caac73f092ef68c3c3272e7ea8e38733987f8f57`, and all exact-head GitHub Actions passed. The coordinated native decoder passed SwiftFormat and all 45 Messages-extension tests; native ReviewGPT round 4 and both exact-head verification lanes passed `399d90b5eba89a826ecb8d0cef6f3c7e29169ef4`. At that checkpoint physical-device Messages proof was the only open release gate and both coordinated PRs remained draft; PR #1502 later merged externally before that gate closed.
- The shared response-card route rendered a real 1200×580 active-workout PNG and
  a real 1200×670 generic-table PNG from their exact V4 and V3 envelopes.
  Focused Web route/render tests passed for nutrition, generic-table, workout,
  malformed, oversized, tracked, and query-bearing inputs. The in-app browser
  exposed no usable tab, so hosted desktop/mobile catalog screenshots remain an
  explicit evidence gap rather than a claimed proof.
- The exact merged Cloudflare assembly passed at 9,027,632 CLI bytes with a
  793-byte CLI entry, plus a 1,672,620-byte runner entry, 8,047,715-byte static
  boot closure, and 10,025,716 total runner bytes. The 50 CLI and runner bundle
  policy tests passed before assembly.
- On the exact merged candidate, contracts, operator-config, and Web typechecks
  passed; the focused contract, operator, and Web suites passed 19, 27, and 66
  tests respectively; documentation drift passed. The expanded operator sweep
  also corrected its retained boundary fixture to prove the tighter static-image
  URL and native-fragment limits together.
- Follow-up remediation passed the touched Web, contracts, operator-config, and
  assistant-engine typechecks; 12 Web route/render tests, 23 contract tests, the
  complete 293-test operator-config suite, and 83 assistant card, skill, and
  model-behavior tests; focused Web lint; documentation drift; and diff hygiene.
  The exact
  route rendered a 1200×580 targetless-next workout card and a 1200×1442 dense
  eight-row, four-column boundary card with measured wrapping and no visible
  overlap or clipping. These direct rasters do not replace the open hosted
  catalog and physical Messages evidence.

## Parent product-experience revalidation

Product purpose verdict: the smallest complete experience is one ordinary start or resume request that produces the verified workout card, one member-entered set action per pending set, a replay-safe Finish action, and one narrow clarification only when transcript context cannot identify a single workout. The remediated flow meets that purpose without another identifier, authority owner, or setup step. No evidence-backed product-experience finding remains.

Evidence gap: simulator, route-render, and contract proof cannot establish the
real Messages transcript badge, bubble sizing, forwarding, composer insertion,
offline reopening, static-image failure behavior, accessibility behavior, or
App Store affordance on macOS and an iPhone without the extension. Those checks
remain an explicit physical-device release gate rather than a claim of current
proof. Hosted desktop/mobile catalog screenshots also remain open while the
in-app browser has no usable tab.

The plan remains active until the native V4 reader is released before broad backend V4 emission.
