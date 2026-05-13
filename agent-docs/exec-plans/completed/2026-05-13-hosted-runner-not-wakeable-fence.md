# Hosted runner not-wakeable fence recovery

Status: completed
Created: 2026-05-13
Updated: 2026-05-13

## Goal

- Stop hosted runner retry loops where a Durable Object rehydrate loses
  in-memory RunnerContainer active-operation state while the native container
  shell may still be serving the previous workspace invocation.

## Success criteria

- Production log evidence is explained without exposing user identifiers or
  message payloads.
- Unexpired persisted write fences are not cleared just because
  `wakeRuntime()` reports `not-wakeable`.
- Focused Cloudflare runner tests cover the rehydrate/lost-active-state path.
- Required Cloudflare verification and completion audits pass or have a
  documented unrelated blocker.

## Scope

- In scope:
  - `apps/cloudflare` per-user runner scheduling around persisted write
    fences, runtime wake results, retry alarms, and metadata-only logs.
  - Focused `HostedUserRunner` tests for `not-wakeable` recovery behavior.
- Out of scope:
  - Changing hosted assistant model policy.
  - Changing Cloudflare container platform lifecycle behavior.
  - Reworking RunnerContainer outbound interception or legacy hard-cut work.

## Constraints

- Technical constraints:
  - Do not add new long-lived product state.
  - Preserve write-fence authority and fail-closed runtime callbacks.
  - Do not destroy a warm shell that may still be serving an older invocation
    unless the persisted lease has expired or an explicit deletion/timeout path
    owns that action.
- Product/process constraints:
  - Preserve unrelated dirty work and overlapping active hosted-runner plans.
  - Redact direct identifiers, raw prompts, mailbox payloads, and secrets.

## Risks and mitigations

1. Risk: Delaying preemption can leave a genuinely dead invocation waiting
   until lease expiry.
   Mitigation: Keep a short retry alarm while the unexpired fence remains, then
   let the existing expiry path clear and retry when the lease deadline passes.
2. Risk: Retry scheduling changes could alter nudge/status semantics.
   Mitigation: Update focused user-runner tests around nudge results, alarms,
   and state rows.

## Tasks

1. Confirm production failure identity and same-Durable-Object overlap. Done.
2. Patch the `not-wakeable` persisted write-fence branch. Done.
3. Update focused runner tests. Done.
4. Run Cloudflare scoped verification and required audits. In progress.
5. Close or report blocked commit path with deployment concerns. Pending.

## Decisions

- Treat `not-wakeable:no-active-child` against an unexpired persisted write
  fence as ambiguous after rehydrate, not proof that the fence is stale.
- Keep expired fences on the existing preempt-and-reinvoke path so genuinely
  stale leases still recover after the hard deadline.

## Verification

- Commands to run:
  - Focused `apps/cloudflare` user-runner test(s).
  - `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts`
- Expected outcomes:
  - Focused tests pass.
  - Diff-aware Cloudflare verification passes or reports only unrelated
    pre-existing failures.

Completed:

- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/user-runner-alarm.test.ts -t "write fence when no active runtime child is wakeable"` passed.
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/user-runner-alarm.test.ts` passed.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts` passed.
- `git diff --check -- apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts agent-docs/exec-plans/active/2026-05-13-hosted-runner-not-wakeable-fence.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- Security/privacy review found no findings.
- Coverage-write review found no findings and made no edits.
Completed: 2026-05-13
