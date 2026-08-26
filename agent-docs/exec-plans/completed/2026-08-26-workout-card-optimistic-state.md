# workout-card-optimistic-state

Status: completed
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Make a direct workout-card submission update the selected expanded Messages
  card immediately while Murph confirms the canonical mutation in the
  background.
- Return the authoritative post-write card in the same terminal member-action
  outcome so a normal save never depends on a second snapshot action.

## Success criteria

- Tapping Send to Murph immediately projects the exact submitted draft into the
  selected in-memory card and clearly labels it as still saving.
- The one existing idempotent member-action request remains the only retry
  identity and the editor remains locked until its terminal outcome.
- A successful apply outcome may carry one ordinary V4/V6 card URL; the native
  reader replaces its optimistic projection with that strictly decoded
  authoritative card.
- A definitive conflict restores the embedded authoritative card while keeping
  the member's draft visible for review. Transient or ambiguous failures keep
  the optimistic projection and exact retry request.
- An older backend result without a card remains a compatible success; the
  projected card stays visible and the existing snapshot read reconciles the
  next pristine open.
- No local database, persisted workout cache, second canonical state owner,
  queue, new dependency, model turn, or extra backend refresh is added.

## Product UX plan

### Requirement boundary

- Entry: an active V6 workout card is selected in expanded Messages and the
  member taps Send to Murph after entering direct set or structural changes.
- Promise: the expanded editor reflects those exact entries immediately while
  truthfully showing that Murph is still saving them.
- Non-goals: mutating an already delivered transcript bubble, offline-first
  workout authoring, general workout storage, concurrent batches, or replacing
  the canonical vault workout.

### Affected people and recovery

1. Warm or cold successful save: see instant local progress, then a canonical
   Saved to Murph result without a second read.
2. Slow or temporarily unavailable runtime: keep the projected entries and the
   exact retry identity, see honest pending/retry copy, and retry the same
   action.
3. Stale or forwarded card: restore the embedded baseline, preserve the typed
   draft, and require review before creating a fresh request.
4. Older backend during rollout or rollback: accept terminal success without a
   result card and reconcile through the existing snapshot path on a later
   pristine open.
5. Messages terminates the extension: no local health/workout values are newly
   persisted; reopening starts from the immutable transcript and canonical
   snapshot read.

### Proof path

- Focused contract tests cover apply results on applied/unchanged outcomes and
  reject illegal result/status combinations.
- Vault-usecase and hosted-runtime tests prove the returned card is built from
  the post-write canonical workout and recorded in the terminal receipt.
- Native unit tests cover projection, immediate session replacement, canonical
  replacement, rollback, missing-result compatibility, and draft preservation.
- Swift formatting, generated-project validation, simulator tests/build, and
  backend package tests/typechecks pass before the pushed candidates.
- Physical Messages proof remains required because Simulator cannot prove
  Apple's transcript/expanded extension lifecycle.

## Architecture

- Extend the existing `workout.live.apply` action with an optional bounded
  presentation used only to render the caller's post-write response card. Old
  clients remain valid.
- Extend the existing member-action result union with a typed apply result and
  permit it only for successful apply outcomes. Old native decoders ignore the
  additional outcome field.
- Build the result while the canonical post-write workout is already available;
  do not issue a second member action or create another persisted projection.
- In native code, keep one mutable selected-message session card. Stage a pure
  projection from the draft before starting network work, then replace it with
  the decoded authoritative result when available.
- Keep `workout.live.snapshot` as best-effort reconciliation for external
  changes and process relaunch, not the critical path for this save.

## Tasks

1. [x] Obtain a ReviewGPT implementation patch against the clean exact
   backend and native baselines; inspect and adapt it rather than applying it
   blindly.
2. [x] Implement and test the backward-compatible backend apply-result
   contract and post-write card construction.
3. [x] Implement and test the native pure card projection and authoritative
   result replacement with no new persistence owner.
4. [x] Update durable backend/native architecture and product contracts.
5. [x] Run focused verification, inspect privacy and deploy skew, and prepare
   both PR candidates.
6. [ ] Complete each repo's required ReviewGPT/CI gates, merge in backend-first
   order, deploy the backend, and leave native release gated on current main CI
   plus physical Messages proof.

## Decisions

- "Local" means the already-owned selected-message in-memory session. Persisting
  workout values would violate the companion's health-data minimization rule
  and add recovery/expiry/account-partition machinery that the requested
  latency improvement does not need.
- One pending batch remains the concurrency ceiling. Faster UI feedback does
  not grant authority for pipelined writes against an unconfirmed binding.
- Server confirmation stays visually distinct from the optimistic projection;
  only a terminal successful outcome may render Saved to Murph.

## Verification

- Backend contracts: 330 tests passed, generated schema artifacts verified,
  and typecheck passed.
- Backend vault use cases: 385 tests passed and typecheck passed after
  generating the repository-owned Health Commons test artifact.
- Backend assistant runtime: 2,513 tests passed, 5 intentional skips, and
  typecheck passed.
- Backend docs drift, dependency policy, and whitespace checks passed.
- Native SwiftFormat, Xcode project generation, pure Foundation typecheck,
  changed-source parse validation, export-plist validation, app-store asset
  validation, native-hosted contract tests, and review-workflow verification
  passed.
- Native simulator tests remain delegated to required GitHub CI because this
  machine has Command Line Tools but not the full Xcode application.
- Physical Messages proof remains a release gate for Apple's transcript and
  expanded-extension lifecycle.

## Review disposition

- ReviewGPT implementation handoffs completed against both exact clean
  baselines. Their patch artifacts were digest-verified, read in full, and
  parent-inspected before integration.
- Normal preliminary-specialist and final exact-head ReviewGPT gates remain
  pending on the pushed PR candidates.
Completed: 2026-08-26
