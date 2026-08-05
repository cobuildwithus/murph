# Group join activation recovery

Status: completed
Created: 2026-08-05
Updated: 2026-08-05

## Goal

- After a successful authenticated group join or sharing update, continue the member through Murph's existing activation gate instead of leaving an inactive account stranded on a misleading success screen.
- Keep group sharing truth exact: an existing grant remains granted when the member is temporarily ineligible to supply health data, while no protected snapshot is decrypted or returned.

## Success criteria

- The group join client navigates through the existing post-join destination immediately after a successful save, retaining the current success surface as a fallback if navigation does not complete.
- The existing dashboard page-auth decision remains the sole owner of whether an authenticated member still requires `/join`; the group page reuses that decision instead of deriving billing state.
- `read_shared` distinguishes an active grant with unavailable data from a missing grant without exposing snapshots for inactive or health-consent-revoked members.
- Focused tests cover successful navigation, granted-but-unavailable projection behavior, real missing grants, and data-authorized reads.
- Required exact-head CI and ReviewGPT gates finish green with no unresolved accepted findings.

## Scope

- In scope: hosted Web group join success navigation, Web-owned shared-data read classification, directly affected assistant-facing contract/tests, and durable architecture wording if the result contract changes.
- Out of scope: a second onboarding or billing state owner, new account states, automatic device connection, retroactive grant repair, database schema changes, and changes to health-data withdrawal authority.

## Constraints

- Technical constraints: preserve Web ownership of membership/grants, preserve dashboard page-auth as the setup decision owner, and never decrypt or return health projections without current member access and health-data consent.
- Product/process constraints: keep explicit group consent intact, avoid telling members to re-grant a permission they already granted, and add no new persistent state, service, queue, retry, dependency, or design component.

## Risks and mitigations

1. Risk: broadening the grant query could leak protected snapshot contents for an inactive or consent-revoked member.
   Mitigation: read authorization metadata separately from eligible snapshot rows, and decrypt only the already access-and-consent-filtered result.
2. Risk: duplicating billing/setup rules on the group page would drift from canonical onboarding.
   Mitigation: expose and reuse the existing dashboard page-auth decision, then continue first-checkout members directly to its `/join` destination.
3. Risk: a new response state could break older hosted runtime consumers during deployment skew.
   Mitigation: inspect the current signed contract and consumer parsing first; prefer an additive or already-supported status and document any required deployment order.

## Tasks

1. Trace the exact group join client and `read_shared` response/parser contracts on current `main`.
2. Add failing focused tests for post-save continuation and granted-but-unavailable data.
3. Implement the smallest owner-bound changes and update any directly owned contract documentation.
4. Run focused Web/package tests, typecheck/lint as scoped, diff/privacy inspection, and rendered proof if the final diff changes visible UI.
5. Close the plan through `scripts/finish-task`, push, open the PR, and complete preliminary/final ReviewGPT plus exact-head CI.

## Decisions

- Recovery reuses the existing dashboard page-auth checkout decision and continues first-checkout members directly to `/join`; the group feature derives no billing or setup state itself.
- Grant authorization metadata and data readability are separate facts; absence after an access filter must not be labeled as absence of consent.
- The device-status projection follows the same readability boundary as encrypted projections. An inactive member's exact grant remains visible as `granted` with `missing` data, but the reader does not synthesize an empty available-device record for a grant excluded from the readable snapshot.
- The accept form owns its pre-submit secondary destination and replaces that entire state with the success presentation after save. This keeps one truthful `/join` recovery action before save and one fallback action after save without parallel page-level copy or duplicate controls.
- Parent corrected-head product-purpose verdict: the smallest complete experience is one explicit sharing save, success acknowledgement only after persistence, immediate continuation to canonical setup, and one recovery action if navigation stalls. The corrected `204bac7e` head delivers that journey with no extra concept, screen, state owner, or material evidence gap; no product-experience finding remains.

## Review remediation

- Preliminary specialist review and final ReviewGPT round 1 both identified the device-status synthetic-record exception. A failing inactive-member regression reproduced it; the correction now requires the exact grant ID to be present in the access-authorized snapshot before synthesizing device status, while an active empty-device grant remains available.
- Preliminary specialist review also identified stale `Go home` copy for an existing first-checkout member and insufficient rendered proof of the post-save state. The secondary action moved into the real client form, the real success presentation is shared with the design study, and a browser interaction test proved save completion precedes setup navigation across desktop and mobile captures.

## Verification

- Local evidence: 77 focused Vitest cases pass across group join client/page, page auth, and shared reads; `pnpm --dir apps/web typecheck`, `pnpm docs:drift`, design-proof checker tests, and the scoped Web lint pass (with one unchanged pre-existing warning in `group-store.ts`). The direct Playwright proof intercepts the real accept request, proves it resolves before `/join` is requested, verifies one setup action after save, and captures the real new-member and existing-member success states at desktop and mobile viewports. Diff/privacy inspection found no identifier or sensitive-evidence leakage.
- Claude Code UI double-check: attempted with Fable after the rendered evidence stabilized; explicit usage-credit exhaustion prevented a second-model review, which the completion workflow records as non-blocking without a substitute.
- Exact-head evidence: all required GitHub Actions passed at `204bac7e`; the valid preliminary `completion-specialists` retry returned `SPECIALIST_OUTCOME: PASS` with no findings and no patch artifact; final ReviewGPT round 2 returned `ROUND_OUTCOME: PASS` with no findings. Both responses were verified as the requested Pro model against the exact pushed head.
- Verified outcomes: no unauthorized projection bytes are decrypted; successful first-checkout saves replace the route with `/join` exactly once; CI and both required review gates pass.
Completed: 2026-08-05
