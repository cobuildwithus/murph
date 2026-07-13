# Group Thread Workspace Isolation

## Goal

Make group-thread workspace isolation a fail-closed invariant: a live Linq/iMessage or group-email conversation must execute in its synthetic group/thread container, never in a personal member workspace, and must never receive personal onboarding guidance.

## Root-cause evidence

- Two production iMessage group turns shared one Linq chat identity and were appended to the same mature personal workspace.
- Linq's v3 webhook supplied `chat.is_group: false` for the real group; the old planner trusted that value and continued into personal-member routing.
- Both incident turns matched a persisted phone identity. Independently, the old home-chat fallback could also substitute the personal owner for an unknown sender when the same group chat identity was stale-bound as a personal home chat.
- The remove/re-add preserved the Linq chat identity, so the stale personal home binding remained authoritative unless group classification happened first.
- A group route and a personal home/pending route can currently claim the same Linq chat in different tables. Canonical group repair must clear that stale personal chat tuple while preserving its assigned line, and direct-route writers must refuse to recreate it after a group route exists.
- Group email already routes to a synthetic runtime member, but mailbox import currently projects the conversation as direct and can therefore activate personal onboarding behavior inside the group runtime.

## Constraints

- Preserve current direct-message onboarding, current-inbound replies, and fail-closed Linq retry semantics.
- Prefer existing thread-container and group-runtime ownership primitives; add no new persisted state.
- Treat provider webhook directness as untrusted for inbound Linq traffic unless canonical chat classification or an established thread route confirms it.
- Never inspect or emit raw message bodies, phone numbers, email addresses, credentials, or private vault contents during verification.
- Do not depend on Fable/frontend work.

## Plan

1. Finish the production event/state reconstruction and Nemesis ownership audit for identity matches, unknown senders, stale home bindings, remove/re-add, and group email.
2. Add a production-faithful hosted-local Linq scenario that seeds a personal home binding, reuses that chat as a provider-canonical group while the webhook falsely reports direct, sends enrolled and unknown participants, and proves the personal mailbox/workspace/vault remain untouched while a thread container handles the turns.
3. Atomically demote stale personal home/pending bindings for canonical groups, preserve the assigned home line as phone-only authority, and reject later personal binds whenever a Linq thread route owns that chat.
4. Add narrow invariant checks at the group-route-to-mailbox boundary so non-direct external thread traffic cannot target a personal member ID.
5. Project signed group-email thread targets as non-direct and cover onboarding suppression in runtime tests.
6. Run focused tests, full required typechecks/tests, completion audits, and publish a follow-up draft PR for exact-head review.

## Verification

- Focused web Linq routing and thread-container tests.
- Focused assistant-runtime group email/directness and assistant onboarding-planning tests.
- Full hosted-local Linq workspace-isolation scenario.
- Required package/repo typechecks and `pnpm test:diff`.
- Security/privacy, coverage-write, simplify/task-finish, and exact-head deep review required by the completion workflow.

## State

Complete pending publication. Production root cause and the remove/re-add timeline are proven. The cross-table race and group-email directness gap are fixed, and the production-faithful group-isolation regression is implemented. Security/privacy, coverage-write, simplify, task-finish, and parent final reviews completed with no outstanding findings. On the reconciled base, repository guards, ten affected package typechecks and test suites, web typecheck plus 4,283 tests, zero-error lint, production build, and Cloudflare typecheck plus 1,737 tests are green. The process-backed hosted-local e2e and web dev-smoke remain unrun because their teardown sends process signals, which the recovery controller explicitly forbids. Exact-head ReviewGPT awaits the post-CI controller slot.
Status: completed
Updated: 2026-07-12
Completed: 2026-07-12
