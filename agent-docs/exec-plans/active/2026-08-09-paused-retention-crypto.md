# Paused-member retention crypto access

Status: active
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Let signed hosted retention runs obtain the workspace crypto they need for
  paused members while keeping ordinary inactive-member assistant work blocked
  by the existing mode-aware reconciliation and Temporal admission owner.

## Success criteria

- The current and historical-root crypto callbacks no longer duplicate active
  member entitlement checks after signed callback authentication.
- Both callbacks still require the callback-bound user, a provisioned hosted
  workspace, and the existing signed/encrypted crypto-envelope authority.
- Focused route tests prove paused members with workspaces succeed, missing
  workspaces remain forbidden, and requests cannot reach crypto reads before
  callback authentication succeeds.
- Existing inactive-member orchestration proof continues to confine execution
  to `inbox_media_retention`, never default processing.
- Focused tests, typecheck, preliminary coverage review, final ReviewGPT,
  exact-head CI, mergeability proof, and parent final review complete without
  unresolved accepted findings.

## Scope

- In scope: the two hosted runtime crypto-context routes, their focused Web
  tests, and any minimal durable contract clarification required by the trust
  boundary.
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

1. Risk: removing the route-local entitlement gate could appear to authorize
   ordinary paused-member execution.
   Mitigation: retain callback/workspace/crypto authority at the routes and
   directly re-run the existing orchestration test proving inactive members
   receive retention-only processing.
2. Risk: the historical-root route remains blocked and fails only when older
   ciphertext is encountered.
   Mitigation: make and test the same owner-bound correction on both crypto
   routes.
3. Risk: a malformed or unsigned request reaches sensitive reads.
   Mitigation: keep auth as the first awaited operation and add focused proof
   that an auth failure prevents workspace and crypto access.

## Tasks

1. Remove the redundant active-member query from both signed crypto callbacks.
2. Replace entitlement-specific fixtures with paused-member, workspace, and
   auth-boundary route regressions.
3. Run focused Web tests, the existing inactive-retention orchestration proof,
   hosted Web typecheck, diff hygiene, and parent diff review.
4. Commit and push the exact candidate, open the PR, run the preliminary
   coverage pass plus final ReviewGPT with CI, resolve accepted findings, and
   close this plan through the repository finish path.

## Decisions

- Use deletion at the two incorrect ownership points. Do not add a retention
  flag to the crypto request or a new authorization mechanism because the
  mode-aware runtime owner already authorizes the only work inactive members
  may execute.
- Preserve the provisioned-workspace check as the route-local resource boundary.

## Verification

- Focused route tests for current and historical crypto context.
- Existing inactive workspace retention reconciliation/orchestration test.
- Hosted Web typecheck and `git diff --check`.
- Exact-head CI plus preliminary coverage and final ReviewGPT trust-boundary
  review.

## Verification log

- Focused Web Vitest run passed: five files and 90 tests covering both crypto
  callbacks plus inactive-workspace retention facts, cleanup signaling, and
  runtime signaling.
- Hosted Web typecheck passed.
- Agent-doc drift, diff whitespace, and direct-identifier guards passed.
