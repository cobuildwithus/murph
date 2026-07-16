# PR 746 background-child checkpoint repair

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Preserve nonblocking one-shot Codex child work across ordinary replies while
  preventing a hosted workspace snapshot or replacement invocation from racing
  unfinished child writes.

## Success criteria

- The root reply can finish without waiting for an admitted one-shot child.
- Before optional enrichment detaches, the parent persists the smallest
  truthful canonical fact or raw source. No promised operation is owned only by
  process memory.
- Before snapshotting, the runtime waits for the exact resident child to become
  terminal and rejects unsupported interaction, reuse, nesting, or background
  terminals. A failed optional enrichment remains a truthful durable minimum,
  not lost accepted work.
- Ordinary checkpoint wake interruption preserves the warm App Server and child.
- Explicit invocation preemption stops the exact warm App Server before the
  container runner slot can be reused.
- The implementation uses the existing warm-process owner and native Codex
  lifecycle events; it adds no job service, credential bridge, or durable state.
- Focused tests, owner typechecks, prompt review, PR CI, and ReviewGPT pass.

## Scope

- In scope: the assistant-engine warm Codex lifecycle boundary, hosted snapshot
  handoff, explicit invocation-abort teardown, narrow prompt constraints, tests,
  and matching durable architecture/invariant documentation.
- Out of scope: a replacement CLI bridge, dynamic mega-tool, new queue, new
  persisted child state, deployment, or unrelated hosted-runtime changes.

## Tasks

1. Reduce child tracking to the exact current native resident and terminal
   receipt, and fail closed on unsupported behavior.
2. Link invocation abort into checkpoint work and synchronously stop the exact
   App Server before releasing the container job slot.
3. Add focused success, failure, interruption, and sequential-child tests.
4. Align prompt and durable docs with parent-owned durable minimums and bounded
   optional one-shot enrichment.
5. Verify, commit, push, complete ReviewGPT remediation, and obtain green CI.

## Verification

- Assistant-engine lifecycle/runtime focused tests and typecheck.
- Assistant-runtime snapshot/invocation focused tests and typecheck.
- Cloudflare container abort/workspace tests and typecheck.
- Prompt review, diff/privacy checks, repository-required verification, PR CI,
  and ReviewGPT remediation pass.
Completed: 2026-07-16
