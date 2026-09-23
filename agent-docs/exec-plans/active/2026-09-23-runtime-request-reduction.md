# Reduce unnecessary runtime HTTP requests

Status: active
Created: 2026-09-23
Updated: 2026-09-23

## Outcome and scope

Reduce avoidable startup reconciliation, recovery callbacks and telemetry HTTP
requests. Preserve reminder timers, foreground replies, exact runtime authority,
and diagnostic persistence. The user selected the simpler option: keep ordinary
reminder checks instead of adding a health-update-to-scheduling handoff.

## Implementation and ownership

- Retry a preserved starting owner at its existing 30-second deadline. An earlier
  independent wake still reaches a ready child; elapsed time never proves stoppedness.
- Recover an exact completed receipt through the existing settled `complete`
  command. This combines retirement and release in one Web owner command instead
  of two, preserving the same inactive-fence and stale-attempt checks.
- Coalesce the three simultaneous checkpoint-source milestones into the existing
  bounded latency envelope. Timestamps, per-event persistence, attempt fencing
  and best-effort failures remain with their existing owners. A platform without
  the batch port retains singleton behavior.
- Keep existing log batching and effect-authority checks. No new service,
  persistent state, scheduler, cache, dependency, queue or buffering lifetime.
  The final production patch has five files and a net deletion of two lines.

## Product UX and failure behavior

Useful deliveries and reminder recovery retain their existing behavior. Earlier
ready-child wakes remain responsive; stale completion cannot release a new owner.
Telemetry remains best-effort. The final patch does not change prompts, model
input, tools, cron scheduling or delivery policy. Changelog: not applicable for
this internal transport/reconciliation change.

## Review decisions

Round 1 reviewed `1054993a6bb8c82c27bb23e0639cd053f1ac4801` with verified
gpt-6-pro. Accepted High: optional reminder-policy lookups could hold up incoming
messages. The next candidate connected them to existing foreground preemption;
engine, hosted timer-preflight and actual concurrent mailbox-import regressions
passed. CI passed with 36 successful checks and three skipped checks.

Round 2 reviewed `cddc763c4725988e57405b7de3b0e605bc04107d` with verified
gpt-6-pro and confirmed the first correction. Accepted High: service inventory
can restore SMS/RCS eligibility without inbound engagement, so removing a paused
reminder's timer can strand it. Provider health and opt-out also recover outside
inbound. The user explicitly chose ordinary reminder timers and the simpler
three reductions. Removed the entire optional wake-suppression path, its added
policy reads, resolver extraction, cancellation integration and isolated proofs.
No health-to-runtime handoff was added. All scheduler and assistant-phase files
now exactly match the original base. Both accepted findings lose their causing
change; final round 3 will verify the reduced candidate.

Review thread: https://chatgpt.com/c/6ab40108-016c-83ea-b658-942e9ae07df3
Artifacts: `audit-packages/pr-3669-round-1.md` and `pr-3669-round-2.md`.
PR: https://github.com/cobuildwithus/murph/pull/3669

## Verification

Retained proof covers the existing startup deadline, earlier ready wakes, lost
completion recovery, stale authority, batch request counts, timestamps and
whole-envelope attempt validation. Earlier focused suites passed: Worker 33,
latency batch 14, shared protocol 43, and Web callbacks 122. All 212 retained
cases passed again after narrowing scope. Hosted-execution, assistant-runtime,
Cloudflare and Web typechecks passed, along with complexity, docs, whitespace
and added-content privacy checks. Byte comparison confirms scheduler and
assistant-phase source exactly matches the original base. Final exact-head CI
and round 3 remain pending.

The earlier, broader candidate also passed the real-Codex canonical reminder
create/fire/cancel journey with gpt-6-sol after building the CLI dependency
closure and assembling its surface. That journey's suppression additions were
removed with the feature; it is historical evidence, not a claim about the final
patch. No model-facing change remains. Missing CLI preflight friction is retained
in `.agents/friction-log/20260923093310-canonical-live-assistant/friction.md`.
No credentials or private production rows were copied into artifacts.

## Rollout and completion

Deploy the additive Web milestone parser before the runtime producer. Old
singleton/assistant-batch producers remain supported; retain the new reader
until batching producers retire. Reverse skew can drop best-effort telemetry,
but does not alter checkpoint persistence or authority. Completion reuses the
already-shipped settled command. No migration or production mutation here.

Finish focused proof, parent review, the final external review, required CI,
and plan closure through the normal scoped completion workflow. Compare endpoint
request counts, startup retry reasons, completion retries and latency coverage
after deployment. Paused reminder checks intentionally remain; this change does
not claim to eliminate all periodic requests. Deployment is outside this task.
