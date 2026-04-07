# Add one-tap hosted onboarding send-code flow without exposing phone numbers in public invite state

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Let hosted onboarding users tap one button to start the Privy SMS code flow from the invite page, while keeping raw phone numbers out of URLs and public invite payloads.

## Success criteria

- The join flow offers a primary one-tap `Send me a code` path plus a manual fallback instead of starting with a blank phone field.
- The backend exposes an invite-bound `send-code` route that never uses query params to carry the phone number.
- Raw signup phone numbers live only in encrypted hosted member private state, not in Prisma invite/member public fields or browser-visible invite status payloads.
- The route enforces invite validity, same-origin mutation checks, and a durable cooldown before returning the stored signup phone to the browser.
- Hosted onboarding clears the temporary stored signup phone once Privy verification succeeds.
- Focused tests cover the private-state contract, route behavior, and invite UI flow.

## Scope

- In scope:
- Extend hosted member private state with temporary signup-phone / cooldown fields.
- Populate those fields when a hosted member is created or refreshed from an inbound phone-number source.
- Clear the temporary signup phone after successful Privy verification.
- Add a hosted onboarding `send-code` route and update the join UI.
- Add focused tests in `apps/web`, `packages/hosted-execution`, and any directly affected hosted private-state tests.
- Out of scope:
- Replacing Privy SMS auth with a custom OTP provider.
- Broader hosted onboarding lifecycle or billing behavior changes.
- Changing the public invite/status payload to expose the raw phone number.

## Constraints

- Technical constraints:
- Keep the current server-side phone match enforcement unchanged after Privy verification.
- Keep raw phone numbers out of URLs, invite payloads, and public Prisma state.
- Preserve the existing custom hosted onboarding UI instead of switching to the Privy modal.
- Product/process constraints:
- Preserve unrelated dirty hosted and package edits already present in the worktree.
- This touches auth/privacy behavior, so it follows the high-risk verification and audit path.

## Risks and mitigations

1. Risk: Persisting a raw phone number widens the hosted privacy surface.
   Mitigation: Store it only in encrypted hosted member private state, use it only for the explicit send-code step, and clear it after successful Privy verification.
2. Risk: A send-code route could be abused for repeated OTP sends.
   Mitigation: Require explicit click, same-origin POST, invite validity, and a durable cooldown; Privy SMS limits and CAPTCHA remain the downstream OTP controls.
3. Risk: Existing hosted onboarding tests may assume the blank-phone flow.
   Mitigation: Keep the manual fallback path and update only the narrow invite UI assertions that depend on the initial state.

## Tasks

1. Register the lane in the coordination ledger and keep the write scope narrow.
2. Extend hosted member private state and its tests.
3. Populate and clear temporary signup-phone state in hosted onboarding identity flows.
4. Add the invite-bound send-code route.
5. Update the hosted onboarding invite UI to use one-tap send-code with manual fallback.
6. Run required verification, perform the required final audit pass, and finish with a scoped commit.

## Decisions

- Use encrypted hosted member private state as the only raw-phone persistence seam for this flow.
- Keep the route as a phone-reveal helper only; Privy still sends the OTP from the browser SDK.
- Use neutral UI copy (`Send me a code`) rather than showing masked phone hints in the button text.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:coverage`
- `pnpm --dir apps/web lint`
- Expected outcomes:
- Hosted onboarding, hosted private-state, and package tests pass with the one-tap send-code flow covered and no change to post-Privy phone-match enforcement.
- Outcomes:
- `pnpm --dir apps/web lint` passed with only pre-existing warnings outside this change.
- Focused web tests passed:
  - `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --project hosted-web-onboarding-core hosted-onboarding-routes.test.ts hosted-onboarding-member-service.test.ts hosted-onboarding-member-store.test.ts`
  - `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --project hosted-web-onboarding-integrations hosted-phone-auth.test.ts hosted-onboarding-privy-service.test.ts`
  - `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --project hosted-web-sync-settings join-invite-client.test.ts`
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts member-private-state-store.test.ts --no-coverage`
- `pnpm typecheck` and `pnpm test:coverage` remain blocked by unrelated pre-existing workspace failures in `packages/hosted-execution/**`, `packages/assistant-runtime/src/hosted-device-sync-runtime.ts`, and a workspace lockfile/deps mismatch.
Completed: 2026-04-07
