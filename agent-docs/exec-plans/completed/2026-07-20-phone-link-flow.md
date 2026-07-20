# Fix phone linking authorization and empty-state UX

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- Let an authenticated member link or replace a phone number from Settings without a false signup-completion error, while keeping the fresh Privy proof bound to the current Murph app session.
- Open the phone-link dialog directly on a focused phone input without repeating the Settings account-status card inside the modal.

## Success criteria

- A fresh Privy session for the exact Privy user named by the current app session can sync a newly linked identity before that identity has been persisted in Murph.
- A fresh Privy session for another Privy user or an identity that resolves to another hosted member remains rejected.
- Auto-opened phone settings render the link form without the redundant heading/status card and opt the phone input into autofocus for both first-link and change-number flows.
- Focused regression tests, diff-aware verification, required frontend and coverage audits, and parent review pass; any unavailable runtime proof is reported explicitly.

## Scope

- In scope: hosted app-session/fresh-Privy binding for identity sync; phone settings modal hierarchy and focus; focused auth and component tests.
- Out of scope: changes to Privy authentication itself, signup, persisted identity schema, messaging delivery, the outer Settings account-status card, or other Settings layouts.

## Constraints

- Technical constraints: preserve the app-session and fresh-Privy dual proof; bind by exact Privy user ID; reject cross-member resolution; add no new state or dependency.
- Product/process constraints: preserve product-critical signup and phone messaging flows; retain the existing warm editorial Settings design; use the PR lane and required auth/frontend verification gates.

## Risks and mitigations

1. Risk: trusting the app session alone could weaken identity-link authorization.
   Mitigation: continue verifying the fresh Privy session and require its exact Privy user ID to match the current app session before deriving the hosted member from that session.
2. Risk: a linked identity could already belong to another hosted member.
   Mitigation: reject any fresh Privy principal lookup that resolves to a member other than the app-session member and retain the transactional identity uniqueness checks.
3. Risk: autofocus or modal simplification could alter the ordinary Settings card.
   Mitigation: scope both behaviors to the existing `autoOpen` dialog mode and keep the standalone Settings rendering unchanged.

## Tasks

1. Add focused failing coverage for the unpersisted same-Privy identity and modal entry state.
2. Correct the dual-session binding and simplify the auto-open phone form.
3. Run focused tests and diff-aware verification.
4. Run full acceptance, attempt desktop/mobile browser proof, and complete the required specialist audits.
5. Finish the plan and commit; then push, open the PR, and complete ReviewGPT, CI, and mergeability proof.

## Decisions

- Keep the outer Settings “Not connected / Link phone” card; only remove its duplicate from the modal.
- Treat the app session as the hosted-member authority only after a fresh verified Privy session proves the exact same Privy user ID.
- Keep the correction inside the existing request-auth and dialog-mode owners: add no state, service, dependency, compatibility path, or parallel authentication flow.
- Skip the optional second-model UI review at the user's direction after its local authentication was unavailable.

## Verification

- Focused hosted-web regression suites passed: 3 files, 37 tests.
- `pnpm test:diff` passed, including hosted-web tests, typecheck, lint, development smoke, and the production build.
- `pnpm verify:acceptance` passed every completed gate but the assistant-engine coverage worker exceeded Node's default 4 GB heap. Its exact failed target passed when rerun with an 8 GB heap: 169 files and 2,514 tests.
- Required `frontend-review` and `coverage-write` audits returned no findings. Parent review confirmed the correction uses existing owners and introduces no new architectural concepts.
- Browser proof was attempted through the required in-app browser lane, but no browser backend was available. Static component tracing and regression coverage confirm the dialog passes autofocus through to the phone input and omits the duplicate card for blank and existing phone states.
- PR CI, ReviewGPT, and mergeability proof run after the scoped commit is pushed.
Completed: 2026-07-20
