# Paused-member retention crypto access

Status: active
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Let signed workspace-bound callers obtain the crypto they are independently
  authorized to use, including paused-member retention and Settings vault
  export, while keeping ordinary inactive-member assistant work blocked by its
  existing admission owners.

## Success criteria

- The current and historical-root crypto callbacks no longer duplicate active
  member entitlement checks after signed callback authentication.
- Both callbacks still require the callback-bound user, a provisioned hosted
  workspace, and the existing signed/encrypted crypto-envelope authority.
- Focused route tests prove signed workspace-bound reads succeed without
  duplicate caller admission, missing workspaces remain forbidden, and requests
  cannot reach crypto reads before callback authentication succeeds.
- Existing inactive-member orchestration proof continues to confine execution
  to `inbox_media_retention`, never default processing.
- A full-stack regression covers the paused-member Temporal-to-Cloudflare
  retention handoff and asserts that it emits no assistant-provider request.
- Focused tests, typecheck, preliminary coverage review, final ReviewGPT,
  exact-head CI, mergeability proof, and parent final review complete without
  unresolved accepted findings.

## Scope

- In scope: the two hosted runtime crypto-context routes, their focused Web
  tests, one existing full-stack Temporal regression, its narrow test support,
  and the durable contract clarification required by the trust boundary.
- Out of scope: changing runtime admission, Temporal scheduling, billing state,
  crypto formats, keys, envelopes, workspace provisioning, or Cloudflare code.

## Constraints

- Technical: preserve signed callback auth, replay defense, user binding,
  workspace existence, envelope signature/recipient checks, and historical-key
  lookup semantics.
- Architecture: Web/Temporal remain the mode-aware admission owners; crypto
  retrieval is not a second billing-entitlement owner.
- Product/process: privacy retention must not be disabled or weakened, and the
  unrelated primary-checkout changes stay untouched.

## Risks and mitigations

1. Risk: removing the route-local entitlement gate could be mistaken for
   operation admission.
   Mitigation: retain callback/workspace/crypto resource authority at the
   routes, document each caller's independent admission owner, and prove
   inactive runtime work receives retention-only processing.
2. Risk: the historical-root route remains blocked and fails only when older
   ciphertext is encountered.
   Mitigation: make and test the same owner-bound correction on both crypto
   routes.
3. Risk: a malformed or unsigned request reaches sensitive reads.
   Mitigation: keep auth as the first awaited operation and add focused proof
   that an auth failure prevents workspace and crypto access.

## Tasks

1. Remove the redundant active-member query from both signed crypto callbacks.
2. Replace entitlement-specific fixtures with workspace and auth-boundary route
   regressions; add a paused-member full-stack Temporal regression.
3. Run focused Web tests, inactive-retention owner proof, Web and Cloudflare
   typechecks, diff hygiene, and parent diff review.
4. Commit and push the exact candidate, open the PR, run the preliminary
   coverage pass plus final ReviewGPT with CI, resolve accepted findings, and
   close this plan through the repository finish path.

## Decisions

- Use deletion at the two incorrect ownership points. Do not add a purpose flag
  or a new authorization mechanism because runtime mode, Settings
  session/MFA/consent, and ordinary active-access owners already admit their
  respective operations.
- Preserve the provisioned-workspace check as the route-local resource boundary.

## Verification

- Focused route tests for current and historical crypto context.
- Existing inactive workspace retention reconciliation/orchestration test.
- Full-stack paused-member Temporal-to-Cloudflare retention scenario.
- Hosted Web and Cloudflare typechecks and `git diff --check`.
- Exact-head CI plus preliminary coverage and final ReviewGPT trust-boundary
  review.

## Verification log

- Focused Web Vitest run passed: five files and 90 tests covering both crypto
  callbacks plus inactive-workspace retention facts, cleanup signaling, and
  runtime signaling.
- Hosted Web typecheck passed.
- Agent-doc drift, diff whitespace, and direct-identifier guards passed.
- ReviewGPT round 1 identified the shared Settings-export resource boundary;
  the durable contract and route-test language now state caller-owned admission.
- Preliminary coverage review requested a real paused-member owner-handoff
  regression; the existing hosted-local Temporal scenario now seeds an active
  workspace, pauses the member, makes retention due, and asserts successful
  completion without an assistant-provider request.
- Hosted Web and Cloudflare typechecks passed after that regression.
- Private Temporal owner suite passed 16 files and 122 tests, including due
  retention for an inactive member. Signed Cloudflare crypto transport passed
  two tests, and focused assistant-runtime retention-only processing passed two
  tests.
- The full-stack scenario could not start locally: the first setup exhausted
  its existing hook timeout; after producing missing build artifacts through
  supported scripts, runner-bundle validation failed on the unrelated existing
  entrypoint byte budget (9,934,039 bytes versus 9,920,209). No scenario test
  executed, and this change does not alter the runner bundle.
- Final ReviewGPT round 2 passed the production correction and authorization
  contract. Its non-qualifying body check exposed two E2E proof errors, which
  were corrected: the scenario now uses the retention-specific signal that
  bypasses active-member admission and waits only for an execution timestamp at
  or after that signal. The production signal-owner suite passed all 30 tests,
  and Cloudflare typecheck passed again.
