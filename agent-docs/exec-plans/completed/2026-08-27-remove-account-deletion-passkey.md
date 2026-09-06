# Remove passkey requirement from account deletion

Status: completed
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
- The current deletion client and server have no sensitive-action dependency;
  a legacy challenge kind remains only so already-loaded Settings clients can
  finish during rollout. Vault export and Assistant approvals retain
  passkey-protected authorization.
- Focused deletion, settings UI, challenge, and sensitive-action tests pass;
  the Web typecheck passes.
- The member-visible improvement has an accurate public changelog fragment and
  all required exact-head review and CI gates resolve without accepted findings.

## Scope

- In scope:
  - Account deletion client submission and server route authorization.
  - The settings sensitive-action compatibility boundary and focused tests.
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
3. Risk: A Settings page already open during deployment cannot delete because
   it still requests the old challenge before submitting.
   Mitigation: Keep the legacy challenge kind admitted for rollout compatibility
   while proving the deletion route does not consume its authorization and the
   current client sends none.
4. Risk: Auth/backend and Web deploy skew causes interruption.
   Mitigation: The new client and route ship in the same Next.js deployment,
   while the new route accepts the old client's extra authorization payload.
   No Cloudflare contract changes or independently deployed services apply.

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
- `account.delete` remains a legacy-only challenge kind for already-loaded Web
  clients; it is no longer deletion authority and can be removed after old
  clients have drained.

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

- Deleted the deletion client's wallet-signature call and the server's
  verification path. Retained the legacy challenge kind only for already-loaded
  Settings clients; the deletion route ignores that authorization.
- Preserved authenticated session resolution, browser mutation-origin
  admission, exact typed confirmation, cleanup ordering, retry guidance, and
  session invalidation.
- Focused pre-fix proof ran 47 tests with the expected seven deletion-path
  failures; after implementation and rollout proof, the focused suite passes
  47 tests.
- Web typecheck passes after the implementation and changelog fragment.
- Changelog archive proof passes 9 tests after its generated registry is
  prepared.
- The Product UX walkthrough and parent candidate review are complete: the
  confirmation, recovery, and responsive presentation are unchanged, with one
  unrelated setup action removed.
- Final ReviewGPT round 1 passed with no findings on candidate `2d0c847788`.
- Preliminary specialist review found that the old shared secure-approval
  fallback still disabled deletion, the recovery study described stale retry
  authorization, and rollout proof mocked the real parser. All three findings
  were accepted and corrected without adding an authority or state owner.
- Secure-approval-unavailable component and both Settings entry points now
  prove export stays disabled while deletion submits without authorization.
  The real request parser directly proves legacy authorization is ignored.
- The corrected focused suite passes 248 tests and Web typecheck passes.
  Repository-owned production-component studies were inspected at desktop and
  390px with truthful copy, enabled deletion, disabled export, and no visible
  containment issue.
- PR #2435 exact-head GitHub Actions and Vercel checks are green. Parent final
  review found no additional concerns across the source, test, documentation,
  changelog, and rollout-compatibility diff.
- Corrected-head final ReviewGPT round 2 passed with no findings. The review
  confirmed the no-passkey deletion boundary, secure-approval-unavailable
  journey, real-parser proof, cleanup invariants, and bounded rollout
  compatibility. Its rendered-evidence caveat is covered by the separately
  inspected desktop and 390px production-component studies.
- Plan closure remains.
Completed: 2026-08-27
