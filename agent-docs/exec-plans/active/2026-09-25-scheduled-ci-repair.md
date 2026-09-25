# Repair scheduled CI canaries

Status: active
Created: 2026-09-25
Updated: 2026-09-25

## Outcome and invariants

Remove the scheduled real-model lane at the user's request. Restore truthful
scheduled proof for Android, Garmin, Frog, and iOS.
Preserve exact-source admission, dedicated test credentials, non-destructive
native identities, canonical provider proof, and private diagnostic boundaries.
Linq is explicitly out of scope. Stripe is healthy and needs no changes.

## Owners and evidence

- The real-model workflow receives an empty dedicated sandbox key and fails
  before any journey. The user subsequently requested deleting this CI lane;
  keep the complete local live suite and its subscription runner.
- The pinned Android executor fails SDK setup while requesting the obsolete
  tools package. Its reviewed source tag and public controller pin must move
  together after focused validation.
- The Garmin browser reports an input-value timeout during a transition to
  provider consent. Investigate locator lifetime and route sequencing before
  editing the existing browser owner.
- Frog reconciliation reaches its job timeout. Inspect the action and installed
  CLI before choosing a correction; do not hide unfinished reconciliation.
- iOS failures report initial OTP admission, while the latest scheduled run
  passes. Inspect the pinned test and failure distribution before changing
  authentication or adding retries.

## Architecture and failure handling

Use existing workflow, browser, and native test owners. No new state store,
scheduler, token source, or provider bypass. Prefer removal of obsolete setup
and corrected sequencing over added retries. Failure must remain a failed proof.
Never change production secrets or weaken production authentication for CI.
Native source rotations use new immutable tags, never moved historical tags.

## Tasks

1. Remove the real-model CI lane and finish cause analysis for the other lanes.
2. Apply minimal corrections and synthetic regression proof in isolated changes.
3. Run affected tests, typechecks, workflow checks, and parent diff review.
4. Commit scoped changes; prepare reviewed delivery and exact-head CI as needed.
5. Validate admitted hosted runs after landing, or name the precise credential,
   source-admission, or external-service blocker.

## Verification

Use local live-runner and Frog workflow tests, wearable browser and controller
tests, and native executor contract tests. Run the relevant TypeScript or native
compile checks after code changes. Hosted proof is separate from hermetic proof.
Required final review applies to protected credential and cross-repository
execution boundaries. Track each lane's result and remaining external step.

## Progress

- Audit complete; five repair lanes identified. No Linq changes.
- Real-model workflow disabled in GitHub; its workflow, dedicated gate, and
  gate tests removed. No credentials provisioned. Local live journeys retained.
- Real-model removal verified: 11 local runner/selector tests passed, tools
  typecheck passed, and docs drift check passed. Only CI-specific code was
  deleted; no authored JavaScript/TypeScript remains in this removal commit,
  so complexity metrics are not applicable. Internal CI cleanup needs no
  member-facing changelog entry. Other repairs remain in progress.
