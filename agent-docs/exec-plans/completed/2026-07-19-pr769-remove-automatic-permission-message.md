# PR 769 remove automatic permission message

## Goal

Remove the separate server-generated permission message from group-challenge
kickoff and scheduled standings. Murph should explain missing sharing access in
ordinary language inside its normal reply, without adding another outbound
message or any pre-model work.

Add a durable invariant that a change may introduce a new automatic
member-facing message only when it is necessary to the requested outcome and
the task has explicit user approval for that additional message.

## Invariants

- A scheduled group-challenge turn has read-only shared-group tooling and can
  produce only its normal scheduled response.
- Challenge kickoff and standings never post a permission card as a side
  effect; Murph explains the exact missing share naturally and lets an affected
  participant explicitly request the existing permission flow later.
- Explicit user-requested permission offers outside the challenge automation
  remain owned by the existing interactive group tool.
- Shared diagnostics remain model-triggered after provider start; no roster,
  grant, device, or permission work moves before the model turn.
- No new state, dependency, compatibility layer, retry path, or delivery owner
  is introduced.

## Work plan

1. Delete the scheduled permission-offer capability and its operation-local
   evidence/attempt machinery while preserving the lazy shared read.
2. Update challenge and system guidance to use one natural-language response
   and require an explicit later request before opening a permission offer.
3. Update the product spec, runtime protocol language, invariant contract, and
   focused tests to match the narrower behavior.
4. Run focused verification, the required completion audits, final review,
   commit, push, and re-run the PR gates for the new behavior-bearing head.

## Verification

- `pnpm typecheck` passed in `packages/assistant-engine` and
  `packages/assistant-runtime`.
- The full Assistant Runtime suite passed: 76 files and 1,736 tests.
- Focused Assistant Engine prompt/skill tests passed: 3 files and 45 tests.
- Focused group-tool, planning, cron, notification, local-service, and service
  tests passed for the changed scheduled read-only boundaries. The full group
  tool file passed 45 tests and the full planning file passed 53 tests.
- The coverage-write audit found the existing stable-boundary proof sufficient
  and made no edits.
- The prompt-review audit found two instruction conflicts and one duplicate
  rule. All were resolved by deletion or wording alignment; the closure pass
  returned zero findings and no new mechanism was added.
- `pnpm test:diff` passed repository static checks, affected typechecks, and the
  full Assistant Runtime suite. The aggregate Assistant Engine test worker hit
  its 4 GB heap limit after 168 files and more than 2,500 passing tests; focused
  changed-path tests pass. The same command also exposed an unrelated local CLI
  ReviewGPT model-picker audit failure in an untouched package.
- `git diff --check` passed.

Status: completed
Updated: 2026-07-19
Completed: 2026-07-19
