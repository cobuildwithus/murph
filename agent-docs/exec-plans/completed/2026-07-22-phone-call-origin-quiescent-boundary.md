# Move phone-call origin durability to the quiescent provider boundary

Status: completed
Created: 2026-07-22
Updated: 2026-07-23

## Goal

- Persist a newly created direct assistant session before its first provider
  request can start, so a later phone-call result always has a restorable exact
  origin.
- Use the existing runner-owned quiescent workspace snapshot lifecycle and
  delete the unsafe mid-tool checkpoint introduced after ReviewGPT round 3.

## Round-4 retrospective

ReviewGPT round 4 proved that the pre-call hook runs too late and bypasses the
production boundary owner. The foreground conversation watcher is tracked for
the whole assistant phase, so draining local mutations from inside
`create_phone_call` waits for a watcher that the runner stops only after that
tool returns. The production snapshot bridge also waits for warm Codex to be
idle and accepts only the existing quiescent `idle_shutdown` reason; an active
tool call satisfies neither condition. The focused regression omitted the
runtime wake signal and supplied a custom snapshot builder, so it did not
exercise those owners.

Decision: identify a new direct session at the existing initial provider-plan
hook, before provider execution starts. Let the workspace runner stop and drain
its foreground watcher around a one-time full snapshot, and let the outer
runtime pause and resume detached work around the production-supported
quiescent boundary. Resume the watcher in `finally`, fail closed if the
checkpoint is unavailable or rejected, and then continue the same provider
turn. Do not add another snapshot reason, queue, route, recovery session, or
persisted lifecycle.

## Success criteria

- A new direct session is durably checkpointed before the first provider
  request starts; existing sessions do not pay the extra snapshot.
- The foreground watcher and detached assistant work resume after checkpoint
  success and failure.
- Checkpoint failure prevents provider and phone-port execution without a hang.
- A real runtime wake signal plus the production snapshot bridge/transport
  proves the boundary reason, ordering, and crash restoration.
- The round-3 mid-tool hook, invocation-local phone checkpoint tail/set, and
  unsupported `assistant_runtime_commit` snapshot widening are deleted.
- Canonical verification, exact-head ReviewGPT, and all PR checks pass.

## Scope

- Assistant Engine initial provider-plan lifecycle metadata.
- Assistant Runtime phase forwarding, runner quiescence, and outer snapshot
  checkpoint ownership.
- Production-faithful Engine/Runtime/bridge regressions and current protocol
  and security documentation.
- The accepted product-experience finding in Web's existing bounded phone-call
  result context and its focused maximum-multibyte regression.

## Tasks

1. Extend the initial provider accepted-input hook with the authoritative new
   direct session identity.
2. Stop/drain the foreground watcher around an outer-runtime quiescent
   checkpoint and resume watcher/detached work in `finally`.
3. Delete the phone-port wrapper and unsupported mid-turn snapshot path.
4. Add failure, resume, wake-signal, production bridge, provider ordering, and
   synthetic crash/restore coverage.
5. Preserve the required `needs_user` follow-up when bounded context must
   truncate lower-priority summary text.
6. Limit the marker to newly created direct user-action turns that can expose
   the phone tool; output-only notification turns add no snapshot boundary.
7. Run focused and canonical verification, finish the plan commit, push, and
   complete the next ReviewGPT round with green CI.
8. Close the preliminary coverage finding by proving an active detached ask is
   absent during the new boundary and restarts after both snapshot completion
   and rejection.

## Evidence

- `startHostedForegroundConversationMailboxImportLoop().completion` is tracked
  before `runAssistantPhase` and stopped only after the phase returns.
- The round-4 checkpoint calls the tracker drain from inside the phone tool,
  creating a cycle with the active watcher.
- Production snapshot creation waits for warm Codex background work; the
  active tool call keeps Codex in `running` state.
- The production snapshot bridge and Cloudflare start/complete handlers reject
  reasons other than `idle_shutdown`.
- `executeCodexTurnWithRecovery` calls the provider-planned hook after session
  resolution and local plan construction but before provider execution.
- The first product-experience review proved the prior overflow fallback kept
  only outcome and summary, silently dropping a required `needs_user`
  follow-up; the corrected fitter keeps the follow-up and truncates summary
  first.
- The second product-experience review proved output-only notification turns
  cannot expose `create_phone_call`; the marker now uses the same accepted
  user-action eligibility as that tool, avoiding an unnecessary snapshot and
  fail-closed dependency for welcomes and scheduled notices.

## Verification

- Focused Assistant Engine typecheck and direct-message/output-only notification
  lifecycle tests pass.
- Focused Assistant Runtime typecheck, runner watcher success/failure tests, and
  production-bridge crash/restore plus fail-closed tests pass.
- Focused Web phone-call result tests pass (47/47), including full multibyte
  `needs_user` follow-up retention with explicit summary truncation.
- Production runner bundle assembly passes at 9,428,615 bytes under the
  ratcheted 9,460,376-byte cap.
- Required product-experience review reran after both accepted corrections and
  returned `NO FINDINGS`; it recorded only non-blocking latency and full
  tool-to-user roundtrip evidence gaps.
- Canonical `pnpm test:diff` passed all touched Assistant Engine and Assistant
  Runtime suites (1,804 Runtime tests, two expected skips); the broader CLI
  expansion tail reproduced widespread unrelated exact 60-second subprocess
  timeouts and was stopped after the pattern was conclusive rather than spend
  further Testbox time on untouched CLI paths.
- Current-head CI exposed one compile-only integration gap in Cloudflare's
  deliberate unsupported-reason boundary test. The production bridge remains
  narrowly typed; the test now documents its intentional legacy-wire type
  violation and still proves rejection before snapshot side effects. Cloudflare
  typecheck and all 37 focused bridge tests pass after that correction.
- Preliminary completion specialists returned one accepted medium coverage
  finding: the controller primitive was covered, but the new pre-provider call
  site had no active detached-ask proof. The entrypoint integration now covers
  both snapshot completion and rejection, asserts no ask runs during the
  snapshot, and observes the retained ask restart afterward. Assistant Runtime
  typecheck and both focused cases pass.
- Final canonical `MURPH_VERIFY_EXECUTOR=crabbox pnpm verify:acceptance` passed
  on 16-vCPU Testbox `tbx_01ky6jwk212b9ev4nrbd5mgjc6`, including all workspace
  typechecks, package coverage, Web verification/build, and Cloudflare
  Node/Workers verification. Evidence:
  `https://github.com/cobuildwithus/murph/actions/runs/29979039332`.
- Parent final review found no remaining correctness, ownership, security,
  reliability, or unnecessary-complexity issue in the remediation delta.
Completed: 2026-07-23
