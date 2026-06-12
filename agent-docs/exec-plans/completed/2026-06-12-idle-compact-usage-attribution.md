# Idle compact usage attribution

Status: completed

## Goal

Fix PR #130's idle-stop compaction usage attribution regression so
`automation_idle_compact` usage rows never record a successful compact as
0/0/0 when the compact resent a large thread.

Success criteria:

- `compactWarmCodexThread` records real compact provider usage when Codex emits
  it.
- Codex 0.135's post-compact recomputed context-size update with zero
  input/output buckets does not overwrite or masquerade as provider usage.
- When Codex emits no real compact provider usage, Murph records the
  pre-compact thread context tokens as an explicit lower-bound input/total
  estimate.
- Regression tests cover provider usage capture, zero-recompute filtering, and
  hosted idle-maintenance forwarding.

## Root Cause

Pinned Codex 0.135 `thread/compact/start` runs `compact_remote_v2`.
`collect_compaction_output` consumes the compact response without surfacing
`ResponseEvent::Completed.token_usage`; after replacing history, Codex calls
`recompute_token_usage`, which emits `thread/tokenUsage/updated` with
`last.inputTokens = 0`, `last.outputTokens = 0`, and `last.totalTokens` equal to
the estimated post-compact context size. Murph was summing `last` buckets and
coercing missing fields to zero, so the only production compact so far wrote a
zero usage row.

## Implementation

- Parse compact provider usage only from nonzero request input/output buckets
  on the active thread.
- Ignore zero-bucket recompute telemetry from context compaction.
- Return a lower-bound usage estimate from `threadContextTokensBefore` when no
  provider usage notification appears.
- Keep cached input and output nullable for fallback estimates because Codex
  does not expose those buckets in 0.135.
- Bind the warm process to the parent thread as soon as `thread/start` or
  `thread/resume` resolves, so child-thread usage cannot overwrite idle
  compaction vitals before turn cleanup.
- Accept compact completion only after `thread/compact/start` succeeds, and
  reject completion notifications that name a different thread.

## Verification

- `pnpm install --frozen-lockfile`
- `pnpm build:workspace:incremental`
- `pnpm --dir packages/assistant-engine test -- assistant-codex-runtime.test.ts -t "attributes idle compaction"`
- `pnpm --dir packages/assistant-engine test -- assistant-codex-runtime.test.ts -t "idle compaction|child-thread usage|stale compaction"`
- `pnpm --dir packages/assistant-engine test -- assistant-codex-scripted-runtime.test.ts -t "compacts the warm thread off-turn"`
- `pnpm --dir packages/assistant-runtime test -- hosted-runtime-idle-maintenance.test.ts -t "records compaction usage"`
- `pnpm typecheck`
- `pnpm test:diff`
Updated: 2026-06-12
Completed: 2026-06-12
