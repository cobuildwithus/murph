# iMessage App Store handoff

## Goal

Let Messages offer Murph's canonical iPhone App Store listing when a response
card reaches someone without the extension, while keeping the homepage fallback
compact and consistent with Murph's normal dialogs.

## Scope

- Add the canonical App Store ID to the shared Linq `imessage_app` identity.
- Prove the exact provider request shape with focused coverage.
- Simplify the existing shared-card homepage dialog and its design study.
- Align the owning delivery, reliability, design, Web, and changelog contracts.

## Constraints

- Keep the opaque card fragment private: do not decode, display, log, store, or
  transmit it from the homepage.
- Preserve the existing interactive-extension identity, static image, fallback
  text, idempotency, and delivery ownership.
- Reuse the shared dialog and button conventions; add no dependency or state
  owner.
- Preserve unrelated worktree changes and update the existing PR.

## Verification

- Focused operator-config request test and package typecheck.
- Focused Web dialog and changelog tests plus Web typecheck.
- Desktop and mobile browser proof for the live fragment handoff and catalog.
- Exact-head specialist/review gates and CI required by the completion workflow.

## Tasks

- [x] Add and test the Linq App Store identity field.
- [x] Simplify and test the homepage dialog.
- [x] Update durable contracts and changelog copy.
- [x] Run focused verification and browser proof.
- [ ] Commit, push, review, and update PR #1630.
