# Restore Telegram Signup Outreach

Status: completed
Created: 2026-07-13
Updated: 2026-07-13

## Goal

- Restore the established Telegram-only signup experience: verified members proceed without a redundant messaging setup step and Murph can send the activation welcome immediately.
- Preserve the distinction between a provider-verified Telegram identity and an inbound-observed Telegram conversation when later behavior truly requires conversation evidence.

## Success criteria

- A fresh Privy Telegram-only verification is treated as ready for direct Telegram messaging when the verified account grants the configured bot write access.
- Activation builds the Telegram signup-welcome route from that provider-authorized identity without requiring a prior `/start` message.
- Persisted Telegram identity and inbound thread fields remain explicit rather than being silently collapsed in storage.
- Focused regression coverage proves onboarding state, provider-authorized activation welcome routing, absent Telegram verification behavior, and existing inbound-thread behavior.
- Required verification, security/privacy review, frontend review, coverage review, PR CI, and ReviewGPT complete with no unresolved accepted findings.

## Scope

- In scope: hosted Telegram routing state, signup activation welcome routing, onboarding readiness projection, focused tests, and any minimal durable contract clarification required by the fix.
- Out of scope: unrelated Telegram reminder/group routing, generic provider retry machinery, new persisted state, and broad reversal of PR #454.

## Constraints

- Keep one routing owner and derive readiness from existing verified/provider facts.
- Do not treat an arbitrary Telegram user id as delivery authority; prove that every production writer originates from a provider-authorized or inbound-observed flow and fail closed when the verified identity is absent.
- Do not add a queue, reconciliation loop, compatibility manager, or duplicate route store.
- Preserve unrelated working-tree and coordination-ledger work.

## Risks and mitigations

1. Risk: restoring the user-id fallback could target an account that did not authorize bot messages.
   Mitigation: trace the exact Privy Telegram login contract and every production writer; keep absent Telegram verification fail-closed.
2. Risk: conflating identity and inbound thread state recreates the PR #454 notification-routing bug.
   Mitigation: keep stored fields separate and restore only the provider-authorized signup route at the owning resolver.
3. Risk: activation and onboarding readiness drift again.
   Mitigation: exercise both through shared production routing logic and owner-level regression tests.

## Tasks

1. Inspect current Privy payload types, provider documentation, and all Telegram routing consumers.
2. Add a failing production-path regression for provider-authorized Telegram signup outreach.
3. Implement the smallest owner-boundary correction and focused negative coverage.
4. Run required verification and completion audits; resolve accepted findings.
5. Close the plan, commit, push, open the PR, run CI and ReviewGPT to completion.

## Decisions

- Use a dedicated worktree and branch from current `origin/main`.
- Treat PR #454's identity/thread separation as a valid storage invariant; restore the product-critical signup success path without broadly reverting it.
- Privy's web login and link flows request bot write access, and the only other production writers observe an inbound direct message. Derive a delivery target as `telegramThreadId ?? telegramUserId` while preserving both stored fields separately.

## Verification

- Focused onboarding regression: 44 tests passed across Privy verification and member activation.
- Coverage-bearing onboarding/UI regression: 57 tests passed; `messaging-state.ts` reached 96.55% statement / 93.75% branch coverage and `member-activation.ts` reached 91.13% statement / 94.11% branch coverage.
- `pnpm verify:acceptance` prepared run: workspace guards and typechecks passed; the `apps/web` verify lane passed 4,743 tests, lint with no errors, dev smoke, and the production build. Two unrelated concurrent-lane timing failures passed when rerun in isolation.
- Security/privacy review: zero medium-or-higher findings.
- Frontend review: zero findings; live provider-popup replay remains a human verification gap.
- Coverage-write review: existing proof was sufficient; no additional edits.
- PR CI and the pushed-head ReviewGPT loop remain required until zero accepted findings.
Completed: 2026-07-13
