# PR 840 ReviewGPT Round 10 Remediation

## Goal

Resolve the accepted round-ten finding by keeping the pass-wide Assistant Ask
target restriction on every workspace-runner mailbox import, including the
pre-auto-reply system catch-up.

## Constraints

- Preserve joined-group pre-checkpoint admission and consented-member
  checkpoint gating.
- Inherit only the target-kind authority field; do not widen signal, callback,
  or latency lifetimes.
- Keep call-specific context authoritative when it supplies the field.
- Add no state, queue, scheduler, lifecycle, or owner.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`

## Verification Plan

- First prove the existing pre-auto-reply catch-up imports a deferred
  consented-member Ask without the pass restriction.
- Prove both the active-turn and pre-auto-reply attempts remain guarded before
  the idle checkpoint, while the existing joined-group positive proof remains.
- Run the focused entrypoint suite, Assistant Runtime typecheck, canonical
  `pnpm test:diff`, full acceptance verification as required, exact-head CI, and
  the next ReviewGPT remediation round.

## Round Ten Finding And Decision

Round 10 validly found that the accepted pass-context correction covered the
active conversation and system imports but not the pre-auto-reply system
catch-up. The shared importer builds context only from the call-specific value,
so the same deferred consented-member row can be accepted before the idle
checkpoint. The finding reproduces statically and is accepted. Enforce only the
target-kind field at the shared import boundary and delete the active-loop
duplication.

## Verification Evidence

- The focused regression failed before the runtime correction: the
  pre-auto-reply catch-up imported the deferred Ask with the unrestricted
  target and prepared it before the idle snapshot.
- The corrected workspace entrypoint suite passed: 235 tests.
- Assistant Runtime typecheck passed.
- The local canonical diff run reached three diagnostics tests that read an
  older shared `/tmp/murph-vault` forward-schema artifact created before this
  remediation. The artifact was left untouched because its ownership was not
  proven.
- A pristine Blacksmith Testbox canonical diff run passed: Assistant Runtime
  1,798 passed and 2 skipped; Cloudflare 1,856 passed.
- Full pristine acceptance verification passed with exit code 0, including web
  6,126 passed and 150 skipped, Assistant Engine 2,600 passed and 5 skipped,
  Cloudflare 1,856 passed, worker verification, package checks, and production
  builds.
- `git diff --check` passed.

Status: completed
Updated: 2026-07-22
Completed: 2026-07-22
