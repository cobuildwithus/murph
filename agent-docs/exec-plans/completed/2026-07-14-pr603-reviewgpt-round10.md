# PR 603 ReviewGPT Round 10 Remediation

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Publish the existing `member.channels.updated` mailbox event whenever family-invite Telegram ingress changes an active member's authoritative route.
- Cover both accepted invites and expected post-routing acceptance misses without adding a second route owner or reconciliation mechanism.
- Preserve activation ordering for members who are not active before family acceptance.

## Accepted finding

1. Family-invite Telegram ingress calls the shared routing upsert but discards `telegramThreadIdChanged`; accepted and expected-rejection exits can therefore commit a new authoritative route without publishing the event that reconciles the managed onboarding automation.

## Constraints

- Reuse `enqueueHostedMemberChannelsUpdatedForActiveMemberTx` and the existing webhook wake-handoff mechanism.
- Keep the routing update and event append in the same webhook transaction, including expected invite misses caught by the planner.
- Emit no channel update for a member who is not active before acceptance; the activation wake already carries the newly persisted route.
- Add no shadow routing state, family-specific queue, or new runtime reconciliation owner.

## Tasks

1. Add a focused failing family-invite route-change regression for accepted and expected-rejection paths.
2. Thread the shared routing-upsert result through a narrow transaction-local callback and reuse the active-member channel-update primitive.
3. Run focused owner tests/typechecks, affected completion audits, scoped verification, finish-task, push, CI, and exact-head ReviewGPT until clean.

## Verification log

- ReviewGPT round 10 on `7200634c05`: one High finding received with valid exact-head snapshot, completion marker, and model evidence.
- Failing reproduction: an active trial member accepted a Telegram family invite that promoted `123:bot:123456` to `123`; the family notification was appended, but no `member.channels.updated` event existed for managed-route reconciliation.
- Fix: the family transaction reports a changed Telegram route through a narrow transaction-local callback. The planner reuses `enqueueHostedMemberChannelsUpdatedForActiveMemberTx`, and accepted/rejected exits reuse the existing wake-handoff mechanism.
- Focused accepted/rejected regression pair passed; full Telegram dispatch suite passed 23/23.
- Family-plan plus Telegram dispatch owner suites passed 115/115; coverage audit's expanded family-plan/member-activation/member-channel-sync/Telegram set passed 142/142.
- Hosted-web typecheck passed.
- Scoped `pnpm test:diff` passed dependency, workspace-boundary, hosted-runtime, Temporal, crypto, and raw-health-log guards; web dev smoke; lint with zero errors; 4,969 tests across 411 passing files; and the Next.js production build/typecheck.
- Coverage-write audit: no unresolved material gap; consolidated the active-family transaction fixture, preserving explicit accepted-route and expected-rejection handoff assertions while relying on existing inactive/activation owner tests.
- Security/privacy audit: no validated Medium+ finding; confirmed transactional append/rollback behavior, active-access gating, deterministic dedupe, member-bound wake handoff, exact-route fail-closed egress, and no sensitive logging.
- Final focused ESLint and `git diff --check` passed.
Completed: 2026-07-14
