# Preserve direct Linq duplicate handoff identity

## Outcome and invariant
An authenticated exact duplicate retains its existing direct chat identity so instant first-turn completion can reconcile accepted context. Existing authority, single-delivery ownership, mailbox dedupe, and legacy workspace-repair signaling remain unchanged.

## Cause and scope
The direct duplicate planner omits linqChatId while ordinary and group planner paths carry it. The completion owner requires the field. Correct that one owner; no new provider-send mechanism, data state, schema, retry, or observer. Production evidence stays outside this plan.

## Ownership
Fresh isolated branch from origin/main. Open PR 3422 changes typing/runtime transport, 3184 removes a retired database column, 3421 adjusts canary observation. Their inspected diffs do not own this planner omission. Preserve all other worktrees.

## Product UX
Effort: Patch. Synthetic direct duplicate replay should retain chat/mailbox identity, reach existing completion, and produce no duplicate message or mailbox append. Suspended/foreign-member and group behavior retain their existing gates. No prompt, tool, prose, or provider-input change; deterministic composition defines success.

## Implementation and proof
- Use the authorized tiny-change exception for the one-field projection and synthetic proof; inspect the pending ReviewGPT implementation response before completion.
- Apply tests first and demonstrate baseline failure, then source and pass.
- Run focused Linq dispatch/completion tests, Web typecheck, complexity, docs and privacy checks.
- Review candidate, scoped commit, draft PR then Ready; final ReviewGPT concurrently with exact-head CI.
- Close plan and leave functional fix ready for human merge. No production replay, message, merge or deployment.

## Progress
- Root cause and source owner established; implementation requested.

- Baseline dispatch/completion:249 tests pass; baseline Web typecheck passes. Parent temporary duplicate-planner assertion fails solely because chat identity is missing; consent neighbor passes. Temporary test restored.
- Changelog archive10 tests, docs drift/gardening and logging privacy guard pass. Existing read-receipt authority consumes the preserved chat after successful handoff; PR evidence explicitly covers this restored path.

- Existing transport fixture reproduced a stale nutrition caption expectation at base. Apply the same isolated one-line proof correction already carried by PR3421 and others; renderer and dedicated layout fixture already agree. No production behavior change; existing remote Frog entry documents the friction, so do not duplicate it.

- Retained composed regression feeds the real duplicate planner handoff into real first-turn completion. Base fails with the exact missing-chat TypeError; consent neighbor passes. Source correction passes all249 focused Linq tests. No canonical writes or new retry/provider contracts are introduced. Existing async implementation request remains owned by its original capture; final ReviewGPT remains required.
- Complexity guard passes: debt257 and maximum89 unchanged. The corrected admission helper adds no branch; the nine existing file hotspots are outside this projection and remain out of scope.

- Web typecheck passes with the documented narrow Prisma test fixture. Transport/card suites103, changelog10, and focused Linq249 tests pass. Candidate review confirms the sole production edit retains an existing request-local field, authority and legacy wake repair; read receipt remains one guarded request with10-second timeout and no SDK retry. Product UX: Ready within synthetic proof.

## Completion evidence
Final ReviewGPT: PASS on immutable first-reviewed head99571f33579c41f3ad6fbc853e06e4340b412478. Verified gpt-6-pro, exact accepted turn and response hash05cb69ea92bbb96d001bc5dd4bb0bc1c80ade59706482208491e2a4fd2a999ec,306 seconds elapsed. Full snapshot/round metadata and archive consistency matched; no qualifying findings. Parent final review: PASS.

PR3434 is Ready; both CLI checks and the hosted Stripe boundary passed on the reviewed head, with release aggregation still pending. This documentation-only closeout requires fresh exact-head CI before completion. Source, tests and changelog remain identical to the reviewed candidate. Fresh main48ee5d3e931794b190fb58d3bf6195cb22c277b2 matched the remote, with clean merge-treeffe90a21ce4d3d970c290530e4e65f5a9a2b5afc. Record later gate receipts in PR/memory; this completed plan is immutable.

The earlier optional implementation request retains its original capture owner; inspect its eventual output before the final report. The authorized tiny correction and independent final review already establish the implementation. Keep the open PR worktree and leave the functional fix for human merge. No production merge, release, replay, message or data/config mutation occurred.
Status: completed
Updated: 2026-09-14
Completed: 2026-09-14
