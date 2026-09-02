# Narrow mailbox default wake publication

Status: completed
Created: 2026-09-02
Updated: 2026-09-02

## Goal

- Stop a later default-owned mailbox row from publishing an assistant wake
  ahead of the durable model-free frontier, without changing the execution
  projection that lets unrelated work and post-checkpoint owners finish.

## Success criteria

- The synthetic device-sync then notification state publishes only the
  device-sync owner until that frontier advances.
- Approved foreground continuations retain their existing priority.
- The five platform regressions on PR #2710 pass unchanged.
- Focused assistant-runtime tests, typecheck, complexity, and exact-head CI pass.
- The already-running ReviewGPT audit is left intact and its result is recorded;
  no replacement audit is launched after the remediation push.

## Scope

- In scope: the assistant-runtime default-wake projection, focused mailbox
  regression coverage, matching durable runtime docs, and PR #2710 evidence.
- Out of scope: mailbox execution ordering, provider sync behavior, Temporal
  scheduling, Cloudflare routing, production mutation, and new state owners.

## Constraints

- Technical constraints: keep `projectHostedSystemMailboxWakeOwnerFrontier`
  independently eligible for default-owned execution; narrow only the
  `defaultOwned` publication derived by the wake-candidate resolver.
- Product/process constraints: preserve fresh foreground priority, keep
  production evidence private, and leave the current exact-head ReviewGPT run
  attached until it completes.

## Risks and mitigations

1. Risk: filtering the shared execution projection blocks unrelated
   maintenance and post-checkpoint finalization.
   Mitigation: restore the execution projection and add the five existing
   platform cases to the focused verification set.
2. Risk: suppressing all default work also blocks an explicitly approved
   foreground continuation.
   Mitigation: preserve that narrow exception in the publication-only
   projection and keep its regression assertion.

## Tasks

1. Completed: confirmed the live no-progress state and all five platform
   failures.
2. Completed: reproduced the failures locally and separated execution
   projection from wake publication.
3. Completed: implemented the publication-only correction; all 2,649 active
   assistant-runtime tests and the package typecheck pass.
4. Completed: validated the narrow correction, updated the PR evidence, and
   prepared the scoped remediation commit for push and exact-head CI. Per the
   user's explicit instruction, the existing ReviewGPT audit remains the sole
   review run even though it started before this remediation commit.

## Decisions

- The current PR head is unsafe because it changes the shared execution
  projection. The correction will retain that projection and narrow only the
  independently published default assistant wake.

## Verification

- Commands to run: focused mailbox-state and notification suites; focused
  entrypoint scheduling suites; assistant-runtime typecheck;
  `pnpm complexity:diff --base <merge-base>`; changelog checks when touched;
  exact-head GitHub CI, plus completion of the already-running ReviewGPT audit.
- Expected outcomes: all focused tests pass without changing the five existing
  expectations; the device-sync/notification regression publishes no later
  default wake; typecheck, complexity, CI, and final review pass.
- Current local evidence: the unsafe head reproduced 5 failures in the
  61-test notification file. The narrow correction passes that file, 239
  surrounding scheduling tests, 4 dirty-ack variants, all 2,649 active package
  tests, package typecheck, diff check, and the complexity guard.
Completed: 2026-09-02
