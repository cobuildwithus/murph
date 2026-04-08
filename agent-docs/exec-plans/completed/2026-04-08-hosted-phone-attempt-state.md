# Simplify hosted phone auth attempt state and +1 parsing

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Fix the hosted homepage phone flow so correcting a bad phone input cannot leave verify/resend bound to a stale number, and reject incomplete North American numbers before Privy send-code requests.

## Success criteria

- The hosted phone flow keeps an explicit active SMS attempt separate from the editable draft phone input.
- `Use a different number` clears the active attempt and returns the user to clean phone entry.
- North American input accepts pasted `+1` numbers plus 10-digit national numbers, but rejects shorter incomplete `+1` numbers.
- Focused tests cover the short-number regression and the new active-attempt behavior.
- Required hosted-web verification runs, plus a direct scenario proof is captured.

## Scope

- In scope:
- `apps/web/src/components/hosted-onboarding/{hosted-phone-auth.tsx,hosted-phone-auth-views.tsx}`
- `apps/web/src/lib/hosted-onboarding/phone.ts`
- `apps/web/test/{hosted-phone-auth.test.ts,hosted-onboarding-shared.test.ts}`
- Out of scope:
- broader hosted onboarding server behavior
- invite persistence semantics beyond the client attempt-state fix

## Constraints

- Preserve unrelated in-progress hosted auth edits already present in the worktree.
- Keep the change small and explicit rather than layering another implicit state heuristic onto the current flow.
- Follow the repo completion workflow for a user-visible auth change, including required verification and audit review.

## Risks and mitigations

1. Risk: A state refactor in a dirty file could regress invite-mode behavior.
   Mitigation: keep invite/public branches intact, change only the attempt-tracking seam, and add focused regression tests.
2. Risk: Stricter `+1` parsing could reject valid pasted numbers with country code.
   Mitigation: explicitly support both pasted `+1XXXXXXXXXX` and plain 10-digit national input in tests.

## Tasks

1. Tighten `normalizePhoneNumberForCountry` for `+1` countries so incomplete NANP input returns `null` while pasted `+1` numbers still normalize.
2. Refactor hosted phone auth to track a submitted SMS attempt separately from draft phone input and render the code step from that attempt.
3. Add focused regression tests, run required verification, collect direct scenario evidence, and complete audit/commit flow.

## Decisions

- Use a dedicated execution plan because the fix touches a user-visible auth flow across multiple dirty hosted-web files and needs explicit completion-workflow handling.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:coverage`
- `pnpm --dir apps/web lint`
- direct scenario proof via focused normalization/attempt-state checks
- Expected outcomes:
- Required commands pass, or any failure is clearly attributable to an unrelated pre-existing issue.
- Results:
- `pnpm --dir apps/web lint` passed with 20 pre-existing warnings and no new errors.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm test:coverage` passed.
- `pnpm typecheck` is still red for the unrelated pre-existing `packages/inboxd` typecheck failures (`@murphai/contracts` resolution plus implicit-`any` parameters in `persist*.ts`).
- Focused follow-up after the resend-path repair:
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/hosted-phone-auth.test.ts test/hosted-onboarding-shared.test.ts --no-coverage` passed.
- Direct scenario proof confirmed:
- incomplete `404409252` and `+1404409252` now normalize to `null`
- pasted `+1 (404) 409-2523` normalizes to `+14044092523`
- submitted form data wins over stale draft state
- active attempt masking shows `*** 2523`

## Audit notes

- A final review pass surfaced one invite-mode resend regression in the first refactor: once an invite shortcut created an active attempt, resend would bypass the server-backed invite `send-code` prepare/confirm path.
- Fixed by centralizing resend-target selection so invite shortcut resend keeps using the invite endpoint, while manual-entry resend stays pinned to the active attempt phone number.
- Results:
- `pnpm --dir apps/web lint` passed with 20 pre-existing warnings and no errors.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm test:coverage` passed.
- `pnpm typecheck` failed in the pre-existing `packages/inboxd` lane (`Cannot find module '@murphai/contracts'` plus existing implicit-`any` errors in `packages/inboxd/src/indexing/persist*.ts`), unrelated to the hosted-web diff.
- Direct scenario proof passed:
  - `normalizePhoneNumberForCountry("404409252", "+1")` returns `null`
  - `normalizePhoneNumberForCountry("+1404409252", "+1")` returns `null`
  - `normalizePhoneNumberForCountry("+1 (404) 409-2523", "+1")` returns `+14044092523`
  - `resolveHostedPhoneSubmission(...)` prefers the just-submitted corrected phone input over the stale draft value
Completed: 2026-04-08
