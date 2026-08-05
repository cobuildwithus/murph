# Hosted smoke session cookie parity

## Goal

Make hosted-local session minting follow the Web process the harness actually
launched, without making a dist-directory selector an auth authority, adding a
test-only authentication path, or weakening the production `__Host-` boundary.

## Proven failure

- The required hosted-local browser journey reaches the real consent-status
  route on a production-built Next artifact and receives `401 AUTH_REQUIRED`.
- The production artifact reads `__Host-murph-session`, while the source-side
  session helper currently derives `murph-session` from `NODE_ENV=test`.
- The stored session and HMAC authenticator are otherwise valid; the route
  cannot observe the differently named cookie.
- Once the cookie mismatch is corrected, the same journey reaches Junction's
  signed connect-link boundary but calls the deleted callback `complete` POST
  route and receives `404`. The production callback now completes directly on
  the exact provider redirect URL with `GET`.
- The production artifact also emits the secure callback-proof cookie name,
  while the dual-mode scenario expected only its development name. The
  scenario must select the callback-proof name from the issued session mode.
- Current private interactive turns advertise `attach_response_card`, but two
  hosted-local assertions retained the older gated-tool expectation after the
  on-demand response-card contract shipped on `main`.
- The first correction treated `NEXT_DIST_DIR_MODE=smoke` as production auth
  mode. A clean E2E source fallback also sets that selector for build-output
  isolation, so it minted `__Host-murph-session` while its development Web
  process emitted `murph-device-sync-junction`. The Junction journey then
  failed before callback completion. The same selector is also used by normal
  hosted-local development worktrees.

## Success criteria

- Production auth keeps `NODE_ENV=production` as its sole secure-cookie
  authority; a build-output selector does not change runtime authentication.
- The test harness records whether it actually selected an existing production
  Web artifact, and that one fact selects both the app-session fixture name and
  expected callback-proof name.
- Source-development, worktree, and ordinary test lanes retain the non-secure
  `murph-session` contract.
- Session validation, HMAC binding, revocation, and route authentication are
  unchanged; no compatibility cookie or bypass is introduced.
- Focused tests prove production, smoke-artifact, and ordinary test behavior,
  and the production-built hosted-local browser flow reaches authenticated
  consent status and completes through the current Junction callback route.

## Implementation

1. Keep the production app-session cookie contract derived only from
   `NODE_ENV=production`.
2. Reuse the hosted-local harness's existing production-start decision and
   expose it as a test-only process-mode fact.
3. Have the source-side session fixture adapt only the cookie name to that fact;
   token signing, storage, expiry, revocation, and route verification remain
   production code.
4. Keep the Junction hosted-local journey on the provider redirect URL emitted
   by production code instead of reconstructing a removed callback route.
5. Make the dual-mode Junction scenario expect the callback-proof cookie name
   from the same explicit process-mode fact, and align affected dynamic-tool
   assertions with the shipped private-interactive response-card contract.
6. Run focused Web and hosted-local proof, then push the coordinated public
   branch so the paired private integration PR can select the exact fix.
7. Complete the required specialist, final ReviewGPT, CI, and parent-review
   gates before closing the plan.

## Verification

- Final focused hosted app-session Vitest coverage passed 17/17 for production
  and ordinary test modes.
- Hosted Web typecheck, Cloudflare typecheck, changed-Web-file ESLint, and the
  hosted-local harness suites passed; the harness suites covered 29/29 tests.
- A fresh no-`BUILD_ID` source fallback first reproduced the mismatched
  callback-proof cookie failure, then passed after the harness-mode correction,
  including authenticated consent, current callback GET, and durable connected
  state against the paired private worker package.
- Public CI passed on corrected reviewed head
  `ddcbc159984b9fbb8c038b9c98a9d7672b0689f0`.
- Paired private production-artifact workflow run `30950657103` passed on the
  prior head, attempt 2. One first-attempt media completion timeout passed
  locally 3/3 and passed on exact-job retry without a code change; the
  aggregate Temporal gate then passed.
- Paired private production-artifact workflow run `30959510194` passed on the
  corrected public head, including every E2E group, the Junction journey, and
  the aggregate Temporal gate.
- Final ReviewGPT round 1 found the dist-selector/auth coupling. The finding
  reproduced in the clean source fallback and the owner-boundary correction
  removed the production auth change. Correction round 2 returned `PASS` with
  no qualifying findings after more than the final-gate trust floor.
- The corrected-head preliminary specialist pass accepted the existing prompt
  expectation and returned one coverage finding: the focused negative harness
  test exited at the profile gate instead of the missing-`BUILD_ID` branch.
  Adding the real `e2e:stub` profile to that test closed the gap; the focused
  29/29 harness tests and Cloudflare typecheck passed again.
- Parent final review found no remaining production, auth, or test-contract
  defect. The final isolated coverage addition does not change runtime behavior
  or require another substantive ReviewGPT round.
Status: completed
Updated: 2026-08-04
Completed: 2026-08-04
