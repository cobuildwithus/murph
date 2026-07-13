# Codex app-server lifecycle attribution

Status: completed
Created: 2026-07-10
Updated: 2026-07-10

## Goal

Attribute each fresh Codex App Server initialization to the smallest bounded
lifecycle reason so production cold-start latency can be separated into first
use after a Node/container boot versus an in-process warm-slot restart.

Success criteria:

- Fresh initialization timing records include one metadata-only reason from a
  fixed allowlist.
- A first App Server in a Node process is distinct from launch-identity change,
  unexpected process exit, turn failure/abort cleanup, and explicit shutdown.
- No environment values, process identifiers, thread identifiers, prompts,
  stderr, or user data enter the new diagnostic.
- Warm reuse behavior and process termination behavior do not change.

## Production evidence

- Seven-day runtime-log aggregates: 287 fresh initializations at 1,361 ms p50
  and 2,766 ms p95; process spawn readiness was 1 ms p50 and 7 ms p95. Warm
  reuse was 0-1 ms.
- Seven-day ingress trace correlation: 26 of 38 traced fresh initializations
  coincided with a cold Node boot. Twelve occurred after Node was warm or after
  the one-shot Node cold marker had already been consumed.
- The same window had one Codex turn failure and no recorded abort-poison
  completion. Existing evidence therefore rejects poisoning as the dominant
  cause but cannot attribute the residual in-process fresh starts.
- Existing Worker lifecycle logs contain container start/stop/error metadata
  and explicit warm-stop results, but the App Server timing event does not
  explain why a fresh slot was needed.

## Scope

- `packages/assistant-engine/src/assistant-codex.ts`
- `packages/assistant-engine/test/assistant-codex-runtime.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/provider-trace-log.ts`
- `packages/assistant-runtime/test/hosted-runtime-events.test.ts`
- This plan and its coordination-ledger row.

## Constraints

- Diagnostic only: do not add a watchdog, timeout, scheduler, process manager,
  retry owner, or persisted state.
- Do not weaken current-turn error cleanup without evidence that a specific
  cleanup path is causing production restarts.
- Record only a fixed reason enum. Never log raw stop reasons, launch keys,
  environment values, command arguments, paths, or process identifiers.
- Preserve all unrelated working-tree and active-plan work.

## Tasks

1. Snapshot the bounded reason when a warm slot is created.
2. Preserve the prior slot's bounded end reason until the next fresh process.
3. Add the reason only to the existing `initialized` timing trace.
4. Redact/allowlist the field at the hosted provider-trace boundary.
5. Add focused engine and runtime logging proof.
6. Run required verification, security/privacy review, coverage-write review,
   parent final review, scoped finish commit, PR ReviewGPT, CI, and merge.

## Verification

- Focused App Server lifecycle matrix: 18 passed. It covers all eight bounded
  reasons, constructor-failure retention, first-reason preservation,
  exit-over-identity precedence, the exact-instance teardown/replacement race,
  managed-account cleanup handoff, and AbortSignal versus live-interrupt
  timeout attribution.
- Focused hosted timing redaction test: 1 passed.
- `packages/assistant-engine` typecheck: passed.
- `packages/assistant-runtime` typecheck: passed.
- Final `pnpm test:diff` policy, boundary, hosted guard, log guard, and all
  affected-owner typecheck phases passed. The package phase was blocked by
  unrelated timing-sensitive workspace-runner and outbox tests on the loaded
  local machine; neither file nor its production owner is changed here. The
  same lane passed the full `assistant-runtime` suite earlier in this worktree,
  and final PR CI remains the clean-machine gate.
- Fresh security/privacy re-audit after the lifecycle fixes: no
  evidence-backed medium-or-higher findings.
- Fresh coverage/proof re-audit: all bounded branches and queued lifecycle
  edge cases have direct proof; no unresolved proof gaps remain.
- `git diff --check` and the identifier/path privacy scan: passed.

## Decisions

- Production evidence supports cause attribution, not speculative deletion of
  current-turn failure cleanup.
- The first-use reason is inferred from module lifetime. No new container ID or
  global lifecycle manager is needed.
- A pending reason is consumed only after the replacement constructor
  succeeds; a constructor throw therefore cannot erase attribution.
- End attribution is first-writer-wins, and process exit takes precedence over
  a simultaneous launch-identity mismatch because exit independently requires
  replacement.
- Warm-slot retirement is exact-instance-only and hands off a reason with
  `??=` before clearing the slot, so a stale outer finalizer cannot erase a
  replacement or overwrite earlier attribution.
- Managed-account cleanup uses the same retirement primitive. AbortSignal
  cleanup failures remain abort-attributed, while an explicit live-turn
  interrupt timeout remains failure-attributed.
Completed: 2026-07-10
