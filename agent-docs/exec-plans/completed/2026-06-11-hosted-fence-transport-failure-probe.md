# Hosted Fence Transport-Failure Liveness Probe

## Problem

Prod incident 2026-06-11 ~02:47–02:51 UTC: the UserRunner DO's transport call
for a healthy, running accepted invocation failed (`runner.accepted_attempt_failed`,
~6×/day baseline). `invokePreparedWithFence` treated that transport failure as
invocation death and cleared the runtime write fence. The container invocation
kept running as an orphan: it held the exclusive runner slot, no wake could be
routed to it (no fence), and its eventual idle-shutdown snapshot failed 401
stale-authority. A user message arriving during that window waited ~96s for the
orphan's 3-minute idle timer before a new invocation could start cold
(2m03s reply latency vs the normal 2–8s warm / 13–18s cold).

Root cause: the control plane inferred process death from a single failed RPC
instead of checking the one component that knows — the RunnerContainer DO's
active-operation record. This also violated the documented invariant that
mailbox processing must not wait behind container lifecycle locks.

## Change

1. `apps/cloudflare/src/worker-contracts.ts` + `runner-container.ts`:
   `readActiveRuntimeUserFence()` active result now carries `attemptId` and
   `leaseGeneration` alongside `userId` (additive; existing egress-intercept
   caller reads only `userId`).
2. `apps/cloudflare/src/user-runner/runtime-invocation.ts`: on invoke transport
   failure, probe the RunnerContainer for the exact fence identity before
   `clearWriteFenceAfterTransportFailure`. Still-active matching attempt →
   keep the fence (wakes keep routing to the live invocation; existing
   replacement path reconciles after it exits). Missing/mismatched/unreachable →
   clear exactly as before (probe fails toward today's behavior).
3. Enrich the persisted `runner.accepted_attempt_failed` row with
   `attemptId`/`leaseGeneration` and metadata-only `redactedJson`
   (safe error diagnostics + `attemptStillActive`/`fenceCleared`) via a typed
   `buildHostedRunnerRedactedErrorJson` helper in `user-runner/diagnostics.ts`.
4. Durable doc: `agent-docs/references/hosted-runtime-protocol.md` write-fence
   and accepted-failure paragraphs updated.

## Invariants Preserved

- Fail-closed authority: fence clears remain CAS-guarded; probe errors clear.
- Web route already passes `attemptId`/`leaseGeneration`/`redactedJson` through
  generically — no web change, no deploy-order coupling.
- `runtime_recheck_requested` still fires on the event; with a kept fence the
  recheck wakes the live invocation (beneficial reconcile).

## Verification

- `pnpm --dir apps/cloudflare typecheck` green.
- New `apps/cloudflare/test/runtime-invocation-transport-failure.test.ts`:
  keep-fence (active match), clear (inactive), clear (attempt mismatch),
  clear (probe failure).
- Updated `user-runner-alarm.test.ts` exact-shape assertion for the enriched
  log row; narrowed the `runtime-write-` leak guard to error fields.
- `pnpm test:diff` over touched paths before handoff.

## Audit Findings

- security-privacy-review (accepted, fixed): bare `errorMessage` key in
  `redactedJson` is rejected by the web parser's redacted-key gate
  (`assertAllowedRedactedKey` forbids the `message` substring; only
  `safeErrorMessage` is allowlisted), which would have 4xxed the whole log POST
  and silently dropped the row plus the existing `runtime_recheck_requested`
  liveness signal. Fixed by emitting the sanitized summary under
  `safeErrorMessage`; add a round-trip test through
  `parseHostedRuntimeLogRequest` pinning the exact recorder body.

- deep-review (resolved): F2 accepted — probe RPC now bounded by a 5s timeout
  failing toward clear; F3 accepted — probe compares `token.generation` (the
  value actually sent in the container job request); F6 accepted — probe
  error/timeout now emits a metadata-only warn log so double-failures are
  observable. F1 accepted as documented residual: the probe reads the
  RunnerContainer DO's in-memory active-op record, so a DO restart (vs an
  RPC-layer failure) still looks dead and clears the fence — incident evidence
  (96s of startup-confirmation attempts blocked on the lifecycle lock held by
  the still-running DO-side invoke) indicates the incident was the RPC-layer
  mode this change fixes; revisit persisted active-op state only if a recurrence
  shows the DO-restart mode. F4 rejected for this change (recheck-cooldown
  sharing between keep-fence and real-death rows is bounded delay, web-side
  scope) — optional follow-up: prefer `fenceCleared: true` rows as cooldown
  owner.

- task-finish-review (resolved): medium accepted — `errorCodeDetail` is now
  kept only when it matches a conservative code-token pattern so one odd raw
  `.code` value can never make the web parser reject the whole runtime-log
  request; low rejected with reason — asserting the console-only
  unconfirmed-probe warn log would need module-mock plumbing in an
  integration-style test file, disproportionate to a diagnostics-only log.
  Timer hygiene, keep-fence rethrow compatibility, and the
  generation-field comparison were all verified clean.

## Status

Complete: implementation, tests, docs, and all required completion audits
(security-privacy-review, coverage-write, deep-review, task-finish-review)
resolved.
Status: completed
Updated: 2026-06-11
Completed: 2026-06-11
