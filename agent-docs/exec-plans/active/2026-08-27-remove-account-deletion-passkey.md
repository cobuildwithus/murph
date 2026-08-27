# Remove passkey requirement from account deletion

Status: active
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Let a signed-in member delete their Murph account without creating or using a
  passkey, embedded wallet, or passkey-only MFA enrollment.
- Preserve the authenticated-session, same-origin, exact typed-confirmation,
  cleanup, retry, and post-deletion session invalidation boundaries.

## Success criteria

- Account deletion sends no sensitive-action challenge or wallet signature and
  succeeds for a valid authenticated same-origin request with the exact
  confirmation phrase.
- Wrong phrases, missing sessions, cross-origin mutations, oversized bodies,
  and downstream cleanup failures retain their existing behavior.
- `account.delete` is removed from the settings sensitive-action union; vault
  export and Assistant approvals retain passkey-protected authorization.
- Focused deletion, settings UI, challenge, and sensitive-action tests pass;
  the Web typecheck passes.
- The member-visible improvement has an accurate public changelog fragment and
  all required exact-head review and CI gates resolve without accepted findings.

## Scope

- In scope:
  - Account deletion client submission and server route authorization.
  - The closed settings sensitive-action kind union and focused tests.
  - A narrow member-facing changelog entry.
- Out of scope:
  - Vault export and Assistant approval authentication.
  - Passkey Settings, embedded-wallet setup, and Privy login methods.
  - Account cleanup ordering, provider cleanup, persistence, and retry owners.
  - Visual restyling of Settings or the deletion dialog.

## Constraints

- Technical constraints:
  - Keep deletion bound to the authenticated app-session member.
  - Keep CSRF/origin admission and the exact destructive confirmation phrase.
  - Do not add a replacement identity system, challenge, state owner, or
    dependency.
- Product/process constraints:
  - Treat this as a Product UX Patch affecting signed-in members with and
    without an existing passkey or wallet.
  - Preserve the deliberate two-step reason/confirmation journey and truthful
    downstream recovery states.
  - Use the worktree/PR lane, preliminary Product UX/frontend/coverage review,
    the auth-triggered final ReviewGPT gate, and exact-head CI.

## Risks and mitigations

1. Risk: Removing the passkey call accidentally removes all deletion admission.
   Mitigation: Keep and directly test session resolution, same-origin admission,
   request-size parsing, and the exact confirmation phrase before cleanup.
2. Risk: Broad edits weaken vault export or Assistant approval authorization.
   Mitigation: Delete only the `account.delete` branch and retain focused
   sensitive-action tests for the remaining kinds.
3. Risk: Client and server drift leaves an unused challenge surface or an
   authorization payload dependency.
   Mitigation: Remove the kind from the closed settings union and assert the
   challenge route rejects it while the deletion request omits authorization.
4. Risk: Auth/backend and Web deploy skew causes interruption.
   Mitigation: The new client request is accepted only by the new Web route in
   the same Next.js deployment; no Cloudflare contract changes and no
   independently deployed compatibility window are introduced.

## Tasks

1. Pin the current client, route, shared-kind, and focused-test behavior.
2. Remove account deletion from the sensitive-action client and server paths.
3. Update focused tests and the public changelog fragment.
4. Run focused Vitest coverage, the Web typecheck, and the Product UX
   walkthrough; inspect the diff and privacy boundary.
5. Commit and push the candidate, run preliminary and final ReviewGPT gates
   concurrently with exact-head CI, resolve accepted findings, and finish the
   plan with the final scoped commit.

## Decisions

- The authenticated app session is the member identity boundary for deletion.
  The exact typed phrase remains the explicit irreversible-action confirmation.
- No fresh-auth substitute is added: the current passkey-wallet signature is
  the product restriction being removed, and no current durable contract proves
  another step-up challenge is required.
- Vault export remains passkey-protected because this request is limited to
  account deletion.

## Verification

- Commands to run:
  - Focused Vitest files for hosted data-privacy Settings, the privacy delete
    route, sensitive-action challenges, and sensitive-action service.
  - `pnpm --dir apps/web typecheck`.
  - Repository changelog fragment validation through its focused Web tests.
  - Preliminary `completion-specialists` ReviewGPT and final PR ReviewGPT gate
    on the exact pushed candidate head, concurrent with required GitHub checks.
- Expected outcomes:
  - No deletion path calls Privy passkey or wallet authorization.
  - Existing deliberate confirmation, failure recovery, export protection, and
    approval protection remain intact.
  - All focused checks and required exact-head gates pass.

## Progress

- Removed `account.delete` from the closed settings sensitive-action union and
  deleted its client wallet-signature and server verification paths.
- Preserved authenticated session resolution, browser mutation-origin
  admission, exact typed confirmation, cleanup ordering, retry guidance, and
  session invalidation.
- Focused pre-fix proof ran 47 tests with the expected seven deletion-path
  failures; after implementation, the focused suite passes 46 tests.
- Web typecheck passes after the implementation and changelog fragment.
- Changelog archive proof passes 9 tests after its generated registry is
  prepared.
- Draft PR #2435 is open; preliminary specialist review, final ReviewGPT, exact
  PR CI, Product UX walkthrough, parent final review, and plan closure remain.
