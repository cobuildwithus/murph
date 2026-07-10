# Foreground Reply Hot-Path Audit And Reduction

Status: completed
Updated: 2026-07-10

## Goal

Find every confirmed violation of Murph's foreground-reply priority from
durable ingress through provider start and reply delivery, deduplicate the work
against open pull requests, and land the smallest deletion or reordering fixes
for the remaining avoidable latency as a follow-up stacked on PR #519.

Success means:

- each claimed blocker has an exact awaited call path or unbounded dependency;
- work already owned by another live PR is not duplicated;
- fresh accepted conversation input does not wait on unrelated history,
  maintenance, projection, diagnostics, device sync, browser refresh, routine
  checkpointing, or post-reply cleanup;
- fixes add no scheduler, queue, index, persisted state, configuration, or
  Codex lifecycle supervision unless direct evidence proves it unavoidable;
- accepted-input durability, authority, replay, delivery idempotency, and
  background continuation remain intact; and
- focused proof, required audits, PR CI, and the ReviewGPT loop pass on the
  final pushed head before merge.

## Constraints

- Start from the current PR #519 implementation and current `main`, but do not
  push unrelated follow-up work onto PR #519's owned branch.
- Preserve unrelated working-tree and coordination-ledger work.
- Treat active ledger rows as ownership boundaries. In particular, do not edit
  mailbox consume-authority symbols owned by the active Part 1a plan unless the
  overlap audit proves that work is already merged or the owner is no longer
  active.
- Prefer deletion, lazy evaluation, early return, bounded selection, and
  off-path best-effort work over new abstractions or state.
- Keep observability content-free and nonblocking.

## Work

1. Compare the pre/post invariant contract and classify any genuinely lost
   cross-cutting technical rule.
2. Inventory open PRs and branches that own reply-latency work, including PR
   #519, and produce an exact overlap/dedupe map.
3. Trace ingress, orchestration, restore/import, admission, provider start, and
   delivery on the current code and prove each remaining violation.
4. Implement only non-overlapping, evidence-backed reductions with focused
   regression tests and any required owner-doc update.
5. Run scoped coverage/typechecks, direct scenario proof, completion audits,
   parent final review, and privacy/diff checks.
6. Close this plan, commit the scoped follow-up, reconcile it with the latest
   PR #519 head by ordinary Git history, and push a stacked PR. Run ReviewGPT
   alongside final-head CI, resolve findings, then merge #519 and the follow-up
   in dependency order when both are green.

## Confirmed Scope

- Restored three compact cross-cutting rules lost during the invariant rewrite:
  causal-anchor precedence, typed durable suppression/pending outcomes, and
  exact accepted-provider-payload decision coverage.
- Deleted synchronous pre-provider plan/start diagnostics and pre-turn
  maintenance. Kept durable receipt evidence and terminal outcome counters;
  froze the obsolete v1 start counters instead of adding replacement plumbing.
- Run automation maintenance only after a no-reply scan, and never when a
  caller reports foreground work waiting.
- Deleted a hosted post-pass automation-state reread and its log-only summary.
- Left mailbox consume authority, channel-authority reconciliation, provider
  cleanup ordering, ingress wake repair, and PR #519 history-scan ownership to
  their existing active lanes rather than duplicating them.

## Deployment

The follow-up changes assistant engine/runtime internals and compatibility-only
diagnostic parsing. It introduces no protocol, schema, persisted-state, or
cross-deploy contract change, so it needs no tandem web/Worker deployment.

## Verification And Audits

- Workspace package build passed after bootstrapping ignored package outputs in
  the isolated worktree.
- The affected workspace graph passed with package tests serialized: dependency
  and architecture guards, 18 package typechecks and test suites, web verify,
  Cloudflare verify, and both application builds.
- The final owner-focused suite passed 435 tests across six files; assistant
  engine, assistant runtime, operator config, and health metrics typechecks
  passed on the final source.
- Coverage-write and security/privacy completion audits found no unresolved
  findings. The parent review deleted inconsistent legacy-counter plumbing and
  froze those compatibility fields instead.
- Focused Feynman review proved the member-channel barrier cannot simply be
  deleted without replacing its current-authority semantics; that owned fix is
  intentionally outside this non-overlapping patch.
Completed: 2026-07-10
