# System-mailbox foreground wake repair

Status: active
Created: 2026-07-25
Updated: 2026-07-25

## Goal

- Ensure a newly accepted foreground conversation preempts an already-running system-mailbox invocation and starts default processing instead of waiting for that invocation's idle checkpoint.

## Success criteria

- Default foreground processing can identity-safely abort and replace the exact active `system_mailbox` runtime fence.
- Wrong-user, wrong-attempt, wrong-generation, retention-only, stale-fence, and partial-abort behavior remains fail closed.
- An accepted active-child abort does not release the old fence until the invocation and dirty warm-shell cleanup have settled.
- Focused regression coverage fails on the old mode-mismatch branch and passes on the repaired path.
- Canonical verification, product review, preliminary specialist review, final ReviewGPT, CI, and mergeability gates complete on the exact pushed head.
- The green PR is merged, Cloudflare is deployed from the merged revision, and production status/smoke evidence confirms the rollout.

## Scope

- In scope: Cloudflare runner processing-mode priority, exact in-memory
  invocation ownership and abort settlement, the wake-versus-container-lifecycle
  boundary needed to make that settlement truthful, focused Cloudflare tests,
  and the hosted-runtime protocol contract.
- Out of scope: Temporal workflow command ordering, mailbox persistence, idle checkpoint timing, provider generation, delivery, and new queues or schedulers.

## Constraints

- Preserve foreground priority over system maintenance.
- Reuse the existing exact-child abort-and-replace path and write-fence identity checks; add no persisted state or alternate retry owner.
- Keep inbox-media-retention isolation and preemption behavior unchanged.
- Keep the fix backward compatible with warm containers running the existing bundle.

## Risks and mitigations

1. Risk: coalescing modes could leave foreground work inside a system-only invocation that cannot enter the assistant phase.
   Mitigation: abort the exact system-mailbox child and replace it with default processing instead of waking it in place.
2. Risk: aborting the wrong child or clearing a superseded fence could corrupt runtime ownership.
   Mitigation: reuse the existing attempt, generation, and user identity checks plus compare-and-clear replacement path.
3. Risk: broad priority changes could let system-only work interrupt an active default runtime.
   Mitigation: keep the reverse `system_mailbox`-behind-`default` direction fail closed and cover it explicitly.
4. Risk: signaling abort without waiting for the old child to unwind could race a replacement on another versioned container.
   Mitigation: register exact invocation ownership before lifecycle admission, retain that token throughout abort, and return accepted only after the child abort plus exact invocation cleanup settle; preserve the command-budget retry when cleanup fails or settlement is slow.
5. Risk: transport loss, teardown, or child-admission races could falsely report
   an inactive or accepted child.
   Mitigation: treat health zero as insufficient after uncertain dispatch, use
   stopped-shell or settled exact-abort proof, and recheck the existing
   interaction/destroy/stop generations around pointerless wakes.

## Tasks

1. Add a focused regression test for default foreground work behind an active system-mailbox fence.
2. Generalize the existing background preemption seam and route only the demonstrated system-mailbox-to-default transition through it.
3. Run focused and canonical verification plus a direct state-machine scenario.
4. Complete the explicit independent deep review plus product, preliminary specialist, parent final, and final ReviewGPT gates.
5. Commit, push, open the PR, resolve CI/review findings, and prove mergeability.
6. Merge the green PR, deploy Cloudflare, verify production behavior, and close the plan.

## Decisions

- Treat `system_mailbox` as a restricted import-only mode that cannot service a conversation wake.
- Keep priority asymmetric: foreground replaces the exact system-only child; a system-only request does not wake, broaden, or replace an active default runtime.
- Treat container abort acceptance as a settled-stop contract, not merely acknowledgement that an abort signal was sent.
- Use the existing invocation result as the cleanup join and the in-flight abort result as the exact ownership reservation; add no second settlement promise or lifecycle manager.
- Register exact operations synchronously before lifecycle-lock admission so
  duplicates coalesce and pre-call queued work can be canceled by the same
  owner.
- Keep uncertain transport ownership until stopped-shell proof or a child
  `absent` response has driven the existing exact abort-and-stop path to
  settlement; retry failed cleanup through that same owner.
- Reuse the existing interaction, destroy-request, and observed-stop fields for
  wake-versus-expiry handshakes; add no persisted coordinator or lifecycle state
  machine.
- The user explicitly authorized PR creation, merge after green CI, and production deployment in this task.

## Verification

Completed on the current candidate:

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/user-runner-alarm.test.ts`
  - 277 tests passed.
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm docs:drift`
- `git diff --check`
- Secret and direct-identifier scan of the task diff.
- Exact-hash concurrency, runtime-semantics, operation-ownership, and simplicity
  deep reviews: no findings.

Pending:

- Canonical `pnpm test:diff` and `pnpm verify:acceptance`.
- Preliminary specialist ReviewGPT, final ReviewGPT, required CI, mergeability,
  merge, Cloudflare deployment, and production verification.
