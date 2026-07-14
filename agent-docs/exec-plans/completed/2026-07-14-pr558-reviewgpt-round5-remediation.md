# PR 558 ReviewGPT round 5 remediation

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Keep group leave disabled until the left-at-aware Web fleet is drained, then
  enable both leave entry points through one shared default-off gate.
- Make unresolved-sender leave evidence terminal across provider replay.
- Supersede deferred and already-queued join confirmations after leave or a
  later membership epoch.
- Reconcile current main, verify, push with an exact lease, and finish exact-head
  CI plus ReviewGPT 0.5.106 Pro/current.

## Invariants

- Web remains the sole membership mutation owner; no lifecycle service or new
  persisted state is introduced.
- Exact routed leave remains no-AI and pre-quota only when the shared gate is on.
- Stable provider events cannot change from a terminal no-op into a mutation.
- A queued user-visible effect is delivered only while its membership epoch is
  still active.

## Tasks

1. Add the shared default-off leave gate at both Web entry points with focused
   off/on coverage and document the guarded enablement order.
2. Append and terminally consume leave evidence before identity lookup; bind
   unresolved-result freshness to that evidence and cover replay after linking.
3. Clear deferred join-confirmation fields on leave and authorize queued
   confirmations against membership ID, joined-at epoch, and active state.
4. Run required tests/typechecks/guards, close the plan, guarded-push, and run
   exact-head CI and ReviewGPT concurrently until all accepted findings close.

## Verification

- ReviewGPT round 5 on pushed head `dd45407c245c` ran with published
  `0.5.106`, Pro/current, and returned three accepted findings: shared
  default-off activation, terminal unresolved-sender evidence, and queued
  join-confirmation epoch invalidation. All three are addressed in this plan.
- Focused Web group/leave suites: 233 tests passed.
- Focused Linq terminal-evidence suites: 96 tests passed.
- Focused membership-epoch route suite: 2 tests passed.
- Assistant engine notification/group-tool suites: 49 tests passed; notification
  runtime suite: 25 tests passed.
- Assistant runtime focused suites: 52 tests passed; post-merge turn-input suite:
  16 tests passed.
- Cloudflare runner-platform suite: 121 tests passed.
- Hosted-execution suite: 318 tests passed.
- Package typechecks passed for Web, Cloudflare, assistant engine, assistant
  runtime, and hosted execution. The full workspace typecheck also passed after
  reconciling current main.
- Exact affected-diff verification passed all repository guards and affected
  typechecks. Its parallel package-test phase exposed resource-contention
  failures outside the PR scope (CLI/setup timeouts and temp-directory races).
  Serial reruns passed for every reported assistant surface that intersects
  this PR: assistant input source (5/5), Linq audio ingestion (3/3), and the
  three reported workspace-entrypoint cases (3/3). The unrelated CLI
  intervention file continued to time out serially without touching PR code.
Completed: 2026-07-14
