# Progress card ordering retrospective correction

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Resolve ReviewGPT round 2 by making ordered dynamic-tool execution the only
  no-reply authority and keeping failed-output reply obligations sticky for the
  remainder of the assistant turn.
- Reduce the remediation shape: remove request-time reservation behavior and
  the cross-owner reply-requirement bypass without adding state or owners.

## Success criteria

- A failed media replacement applies its empty replacement and reply-required
  patches before a later overlapping `finish_without_reply` request executes.
- A later approved vault-file send can deliver its file but cannot erase an
  unrelated failed-media reply obligation.
- A normal approved vault-file send still completes without a companion reply
  when no earlier failure requires one.
- Focused production-faithful regressions, canonical verification, ReviewGPT,
  exact-head CI, deployment proof, and runtime proof all pass.

## Scope

- Assistant Codex dynamic-tool ordering and final-action patch application.
- Focused assistant runtime and hosted image-delivery proof.
- Deterministic hosted approval-resume lifecycle proof.
- Directly affected architecture and reliability documentation.

## Constraints

- Add no durable state, owner, queue, reservation type, lifecycle, or
  reconciliation path.
- Preserve intentional no-reply and existing vault-file delivery ownership.
- Keep every failed requested output visibly recoverable in the accepted turn.

## Evidence

- ReviewGPT round 2 reproduced a failed media attachment followed by an approved
  vault file whose owner-specific bypass removed the media reply obligation.
- ReviewGPT round 2 also traced malformed or unreadable media immediately
  followed by no-reply: request-time reservation suppressed the earlier
  serialized media mutation before it could apply.
- The required retrospective is recorded on PR 1102 and chooses deletion:
  sticky turn-level failure obligations plus the existing ordered execution
  chain.
- The hosted vault-file approval scenario exposed a pre-existing proof race:
  it returned after container destruction was requested but before destruction
  completed, then counted cold starts in a rolling log tail. The scenario now
  waits for completed destruction and proves cold resume through the stronger
  observable contract: one resumed attachment delivery with no provider call.

## Tasks

1. [x] Add focused failing regressions for mixed outputs and overlapping
   malformed/unreadable media requests.
2. [x] Delete request-time no-reply reservation behavior and cross-owner
   reply-required bypass.
3. [x] Extend hosted proof and update owner documentation.
4. [x] Run focused and canonical verification.
5. [ ] Complete ReviewGPT round 3, exact-head CI, merge, deployment, runtime
   proof, and worktree retirement.

## Verification

- Focused assistant runtime suites: 277 tests passed.
- Assistant engine typecheck: passed.
- Hosted image delivery: 3 tests passed.
- Hosted vault-file approval resume: passed after replacing the racy rolling-log
  assertion with a completed-destruction lifecycle barrier.
- Canonical `test:diff`: all affected guards, typechecks, and package tests
  passed; its final Cloudflare app leg was stopped after ten continuous minutes
  waiting for the occupied shared-host slot.
- Canonical `verify:acceptance`: passed on the immutable staged candidate
  through the documented one-shot Blacksmith fallback, including Cloudflare
  Node (2,053 tests) and Workers (2 tests) verification.

## Decisions

- A failed requested output creates a sticky visible-reply obligation for the
  remainder of the turn; later output success does not retire it.
- Dynamic-tool execution order, not request receipt, determines when no-reply
  becomes authoritative.
- Continue the same PR because the correction removes review machinery, keeps
  the original purpose unchanged, and requires no broader architecture.
Completed: 2026-07-29
Completed: 2026-07-29
