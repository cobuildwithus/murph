# Make phone-call origin restart-stable

Status: completed
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Make the exact initiating direct-session identity durable before a hosted
  phone call crosses the irreversible provider boundary.
- Preserve the existing no-automatic-delivery, no-reroute, causal-ordering,
  and terminal-invalid-origin behavior.

## Round-3 retrospective

ReviewGPT round 3 found that a new direct session is saved only in the live
workspace before `create_phone_call` delegates to Web and Retell. The ordinary
workspace checkpoint waits for the idle or shutdown boundary, so container
loss after provider start can restore a workspace without that session. The
durable call result then names a missing origin, is correctly settled as a
fail-closed no-op, and never reaches the next conversation turn.

The immutable first-reviewed patch had 553 authored-source lines of churn; the
current patch has 877. Earlier review growth added exact-session persistence,
causal-frontier handling, byte bounds, and terminal invalid-origin progress,
but did not make the origin durable before the external effect. The previous
retrospective addressed causal-owner coupling and mailbox progress only.

Decision: keep the exact session as the identity and use the existing hosted
workspace snapshot/checkpoint owner immediately before the phone-call port
delegates. The checkpoint must succeed before Web or Retell is called. Do not
add a queue, alternate route, recovery session, compatibility path, or new
persisted lifecycle. Coalesce repeated preparation for the same session only
in invocation-local memory.

## Success criteria

- A hosted phone-call start cannot reach the Web/Retell port until the current
  workspace snapshot containing its origin session is durably accepted.
- Checkpoint failure fails closed and the phone-call port is not invoked.
- A crash/restore regression proves a newly written origin session is present
  in the committed snapshot before the external start event.
- Existing preference/phone causal independence, invalid-A/valid-B progress,
  transient retry, exact-session replay, and no-delivery tests remain green.
- Canonical verification, exact-head ReviewGPT, and PR CI pass.

## Scope

- Hosted runtime pre-call checkpoint coordination and the hosted assistant
  phase phone-call port wrapper.
- Focused runtime/phase tests, current runtime protocol and security docs, and
  the PR change-shape/review handoff.

## Tasks

1. Add a phase-owned pre-phone-call hook that runs before port delegation.
2. Back the hook with the existing hosted workspace snapshot/checkpoint owner,
   preserving the committed workspace version and leaving the continuing turn
   dirty for its ordinary final checkpoint.
3. Add order, fail-closed, coalescing, and crash/restore proof.
4. Run focused and canonical verification, commit, push, and complete
   ReviewGPT round 4 with green CI.

## Evidence

- `resolveAssistantSession` creates and saves a random session only under the
  live vault root.
- The universal hosted pre-tool callback drains live steered inputs but does
  not checkpoint the workspace.
- Web persists `originSessionId` and can start the external call before the
  hosted runtime's idle/shutdown checkpoint.
- Missing-session result replay is terminal by design, so a lost-but-valid
  origin cannot recover through the result mailbox path.

## Verification

- Assistant Engine and Assistant Runtime package typechecks passed.
- Focused runtime/phase coverage passed: 594 tests across the workspace phase,
  entrypoint, phone-result context, and runner suites; 177 related Engine and
  Runtime tests also passed.
- The crash/restore regression proves the committed snapshot contains the exact
  new direct session before the external start event, and phase tests prove
  ordering plus fail-closed behavior.
- `pnpm hosted-local e2e retell-call-result-roundtrip` passed after assembling
  the production runner bundle.
- The production runner measured 9,427,608 bytes on local macOS; its fixed total
  cap was ratcheted to 9,460,376 bytes to retain the documented 32 KB margin.
- Local `pnpm test:diff` passed global guards and affected typechecks, then hit
  three pre-existing diagnostics-test failures because that test uses a shared
  fixed `/tmp/murph-vault` path containing another suite's state. No task-owned
  assertion failed.
- Clean canonical `pnpm verify:acceptance` passed on the one-shot 16-vCPU
  Testbox `tbx_01ky6c7gepcj8q8z919zjt83ja`, including 1,804 Assistant Runtime
  tests, all Cloudflare tests, Web build/lint/tests, and repo-wide coverage:
  <https://github.com/cobuildwithus/murph/actions/runs/29974034071>.
Completed: 2026-07-22
Completed: 2026-07-22
