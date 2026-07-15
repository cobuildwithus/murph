# Replace PR 592 with canonical email sync fix

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Replace PR #592 with the smallest durable fix for the observed Settings email
  incident: never report a linked or verified email until the canonical server
  sync succeeds, and never substitute a stale initial display value for the
  email returned by Privy's link callback.

## Success criteria

- A phone-only/stale Privy callback still syncs the exact email account returned
  by the link callback instead of reusing the initial unverified display hint.
- Missing callback email data remains an error and cannot become terminal
  success or trigger addressless server-side credential selection.
- A failed canonical sync returns no success message.
- A failed first-link canonical sync can retry the same exact callback address
  without reopening Privy's already-completed link flow.
- A successful sync updates presentation state only from the server response.
- Focused tests, the routed acceptance suite, required specialist audits, CI,
  and ReviewGPT complete for the replacement PR head.

## Scope

- In scope: the hosted Settings email controller, its sync presentation helper,
  the email-to-Privy handoff, and focused Settings email regression coverage.
- Out of scope: generalized onboarding auth intents, link-intent cookies,
  provider credential baselines, phone/Telegram/passkey flows, deploy-skew
  compatibility, non-email authentication promotion, and unrelated principal
  mutation hardening.

## Constraints

- Technical constraints: preserve `/api/settings/email/sync` as the sole
  canonical persistence boundary; treat the callback address only as an exact
  selector; fail closed when it is unavailable; add no persisted state,
  endpoint, cookie, dependency, queue, or compatibility layer.
- Product/process constraints: preserve unrelated work, keep sensitive identity
  values out of artifacts, use the isolated PR lane, and do not close PR #592
  without explicit user direction.

## Risks and mitigations

1. Risk: Privy's callback user snapshot can lag the newly linked account.
   Mitigation: ignore that snapshot and consume the callback's explicit linked
   email address, which is guaranteed by the pinned SDK contract.
2. Risk: an unexpected addressless runtime callback could tempt a broad
   server-side credential-selection protocol.
   Mitigation: surface a retryable error and keep the state nonterminal.
3. Risk: valid but separate auth hardening findings could re-expand the patch.
   Mitigation: document them as follow-up scope and keep this PR tied to the
   reproduced incident invariant.

## Tasks

1. Add a focused regression for the observed stale phone-only callback shape.
2. Delete stale callback-user/initial-email fallback from the link flow while
   preserving the existing OTP update recovery state.
3. Preserve the callback address only as retryable, non-authoritative state so
   canonical saving can retry without reopening the provider flow.
4. Make all terminal success and successful address state derive from canonical
   sync results.
5. Run focused verification, specialist audits, full acceptance, CI, and
   ReviewGPT, then open the replacement PR.

## Decisions

- Use the exact callback email rather than addressless server resolution. The
  pinned Privy SDK types require an email link callback to include an email
  account with an address; an absent address therefore fails closed.
- Keep exact-principal pre-mutation gating and non-email secondary-email
  promotion as separate security follow-ups because neither caused the
  reproduced Settings false-success incident.

## Verification

- Focused rebased Vitest: 33 tests passed across the Settings controller and
  canonical sync route suites.
- Exact final-scope `pnpm test:diff`: 5,107 tests passed and 139 skipped;
  dependency/security guards, TypeScript, dev smoke, lint, and production build
  passed. Lint reported 12 existing warnings and zero errors.
- Required `frontend-review` and `coverage-write` passes found no unresolved
  issue. Live Privy/browser behavior remains mocked.
- `pnpm verify:acceptance` cleared all email-relevant checks, package typechecks,
  app builds, lint, dev smoke, and package coverage, but current main's unrelated
  CLI release-tarball test exceeded its hardcoded 120-second timeout. A serial
  rerun also timed out with 35 of 36 tests passing. A separate Health Commons
  generated-file race from the parallel run passed 18 of 18 when rerun serially.
- Replacement PR CI and ReviewGPT remain required on the exact pushed head.
Completed: 2026-07-15
