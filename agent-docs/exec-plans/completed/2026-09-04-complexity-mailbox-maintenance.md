# Mailbox maintenance complexity cleanup

## Outcome

Reduce repeated control flow in the hosted mailbox maintenance owner while
preserving foreground progress, causal completion priority, retries, and
checkpoint-before-effect ordering. Keep selection policy in its existing owner.

## Scope and ownership

- Own `workspace-assistant-phase.ts` mailbox maintenance and focused proof only.
- Isolated branch: `refactor/complexity-mailbox-maintenance`.
- Existing automation-inspection PRs touch different spans; do not edit them.
- Do not change prompts, tools, schemas, ports, deployment contracts, or policy.

## Invariants and Product UX

Implementation-only cleanup: no product-owned behavior change is intended.
Replay current conversation input alongside maintenance, causal completion,
non-idempotent delivery, and retry recovery through existing composed tests.
Selection remains exclusive, then causal, then eligible earlier Assistant Ask,
then external completion only with no pending input. Read invocation inputs at
each preparation attempt, including after awaits. Preserve cutoff omission vs
explicit null, foreground/background clock differences, and dynamic yielding.
Durable checkpoints retain their existing effect and retry owners.

## Steps

- [x] Inspect source, existing PR overlap, workflow, and Frog entries.
- [x] Collapse repeated preparation and diagnostic branches without new owners.
- [x] Run focused deterministic proof, package typecheck, and complexity guard.
- [x] Inspect composed evidence and final diff; close with a scoped commit.
- [ ] Open draft PR; obtain parent candidate review; run ReviewGPT with exact-head CI.

## Evidence

- `MURPH_VITEST_MAX_WORKERS=2 pnpm --dir packages/assistant-runtime test
  test/hosted-runtime-workspace-assistant-phase-foreground.test.ts
  test/hosted-runtime-workspace-assistant-phase-delivery.test.ts
  test/hosted-runtime-workspace-assistant-phase-device-sync.test.ts
  test/hosted-runtime-workspace-assistant-phase-scheduling.test.ts
  test/hosted-runtime-workspace-assistant-phase-diagnostics.test.ts`: 291 tests
  passed across five files. Existing real-mailbox scenarios prove exact approval
  selection ahead of older wakes, durable recording, completion delivery replay,
  notification-validation retry diagnostics, and wake preservation.
- `pnpm --dir packages/assistant-runtime typecheck`: passed. No imports, exports,
  or package-boundary changes require a separate emitted build.
- `pnpm complexity:diff --base 603ea873bf4d0652805d0577081c43d64d6e0f61
  -- packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`:
  passed; file debt 421 to 404, maintenance 190 to 176, post-checkpoint 46 to 43.
- Source-derived foreground guard parity: all 16 Boolean combinations retained
  identical return decisions and yield-callback counts.
- `git diff --check`: passed. No new qualifying Frog friction occurred.

The parent inspected the production diff and accepted the deterministic-only
real-Codex disposition: this mechanical refactor changes no prompt, tool
availability, context, silence policy, or output semantics. Existing composed
proof is the appropriate execution boundary; stochastic prose proof would not
exercise the altered syntax. No new test mirrors the implementation.

## Shape and preserved boundaries

Four foreground preparations reuse one invocation-local wrapper that reads the
clock, abort signal, execution context and roots on every call. Explicit filters
and cutoff omission remain at each call site. The background call retains its
separate clock, log context and yield hook. One discriminated diagnostic object
replaces repeated status tests. The local cron cache still invalidates at the
two original device-sync sites. The post-checkpoint tail's earlier null return
proves its removed conditional fallback unreachable. No persisted state,
provider/database call, awaited operation, or dependency was added or moved.

Product UX walkthrough: Ready for the unchanged foreground, causal-completion,
background and retry journeys through the five suites. Changelog is not
applicable: internal behavior-preserving refactor. Deployment concerns are not
applicable: no protocol, schema, configuration or mixed-version contract changes.
Remaining above-threshold owners stay cohesive; further broad restructuring
would exceed this bounded cleanup and overlap independent active PRs.

## Review and completion

No merge requested. Retain the clean worktree while its PR is open.
Status: completed
Updated: 2026-09-04
Completed: 2026-09-04
