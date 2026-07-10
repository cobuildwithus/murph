# PR 454 ReviewGPT Round 5 Fixes

Status: completed
Created: 2026-07-08
Updated: 2026-07-07

## Goal

- Fix the accepted Mountain ReviewGPT round-5 findings for PR 454: stale Telegram identity-only route projection and group-newsletter email-needed mailbox deploy skew.

## Success criteria

- Old Telegram identity-only private payloads do not project as executable Telegram direct routes.
- Identity-only Telegram upserts clear unproven same-user thread targets instead of preserving them.
- Group-newsletter email-needed imports that lack a direct route remain retryable, so old/no-route consumers cannot permanently consume the once-ever nudge.
- Group-newsletter nudge deployment order and rollback floor are documented.
- Focused tests, required verification, commit, push, and ReviewGPT rerun complete or any remaining finding is explicitly triaged.

## Scope

- In scope:
  - Hosted member Telegram routing private codec and upsert behavior.
  - Group-newsletter email-needed mailbox import no-route outcome.
  - Focused regression tests around stale Telegram private payloads and no-route mailbox import.
- Out of scope:
  - New routing tables, schedulers, fleet state, or broad rollout machinery.
  - Unrelated hosted mailbox import behavior.

## Constraints

- Preserve Telegram user lookup identity separately from executable direct-thread delivery.
- Preserve the provider-contract invariant that executable notifications carry a concrete deliverable target.
- Preserve mailbox ordering while making missing direct route retryable instead of terminal.
- Keep the fix small and composable; no new persisted state unless a failing test proves it is necessary.

## Risks and mitigations

1. Risk: fail-closing old Telegram payloads could temporarily remove Telegram-only route readiness until a proven direct Telegram route is seen.
   Mitigation: keep Telegram user id readable for lookup and let only direct thread proof project as notification-ready routing.
2. Risk: retrying no-route newsletter items could block later mailbox items on that lane.
   Mitigation: this is intentional for a one-shot private nudge with a missing deploy/runtime prerequisite; focused tests should prove the outcome is retryable.

## Tasks

1. Add Telegram route provenance parsing/building and stale-payload regression coverage.
2. Clear stale same-user Telegram thread targets on identity-only upserts.
3. Change group-newsletter no-route mailbox import from terminal skip to retryable defer/block.
4. Document the cross-deploy order for the nudge producer/consumer.
5. Run focused and required verification, then commit, push, and rerun Mountain ReviewGPT.

## Decisions

- Accept both Mountain round-5 findings based on code-path evidence.
- Prefer fail-closed route projection and retryable mailbox import over new deployment-state machinery.
- Use the existing deploy compatibility invariant for rollout: deploy the compatible runner first with immediate container rollout, then enable the web producer.

## Verification

- Commands to run:
  - Focused hosted onboarding/group-newsletter tests.
  - Focused assistant-runtime group-newsletter mailbox tests.
  - `pnpm test:diff`.
  - `pnpm typecheck`.
- Expected outcomes:
  - New regressions fail before the fixes and pass after.
  - Required repo verification passes or any unrelated pre-existing failure is documented.
Completed: 2026-07-07
