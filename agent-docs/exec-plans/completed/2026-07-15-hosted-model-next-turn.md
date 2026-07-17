# Apply Hosted Model Changes On The Next Turn

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

Make a confirmed hosted model or reasoning-effort change apply to the next
provider turn, including a follow-up serviced by the same active hosted
invocation, while the reply already executing keeps its starting target.

## Success criteria

- Web/Postgres remains the sole durable owner of member model intent.
- A successful conversational configuration update changes the next separately
  accepted assistant turn without waiting for the 180-second idle checkpoint.
- The provider turn already executing is never interrupted, replayed, or
  restarted to simulate a mid-turn model switch.
- Returning to Terra or default reasoning removes any stale invocation-local
  Sol or non-default reasoning override.
- Murph starts the next Codex turn with the refreshed resolved target through
  the existing session-resolution and thread-start boundary.
- Focused tests prove both model directions, unchanged/unavailable failures,
  same-invocation behavior, and current-turn immutability.

## Scope

- In scope: hosted invocation-local target projection, request-order
  serialization for configuration updates, focused runtime/assistant-engine
  tests, and durable architecture/runtime documentation whose activation claim
  changes.
- Out of scope: changing the model during an already-running provider turn,
  new wakes or queues, new persisted state, billing eligibility changes,
  settings UI redesign, and provider rollout/deployment controls.

## Constraints

- Preserve foreground reply priority, write-fence authority, checkpoint/restore
  semantics, and web-owned entitlement decisions.
- Keep the confirmed post-write tool response as the only invocation-local
  update source; do not poll web or create another durable preference owner.
- Reuse the exact Codex App Server protocol supported by the pinned sibling
  Codex source.
- Work only in the isolated `codex/hosted-model-next-turn` worktree and preserve
  the active broad runtime lanes recorded in the coordination ledger.

## Risks and mitigations

1. Risk: the current provider turn observes the new target too early.
   Mitigation: update only the invocation-local target used by later assistant
   phases; retain current-turn values in the configuration tool result.
2. Risk: Terra/default changes leave stale environment keys behind.
   Mitigation: project the full confirmed target on every later pass and test
   Sol-to-Terra plus non-default-to-default reasoning transitions.
3. Risk: overlapping configuration writes complete out of order.
   Mitigation: reuse the existing request-order dynamic-tool execution chain so
   the last confirmed response matches the web-owned preference.
4. Risk: old and new runner bundles coexist during Cloudflare rollout.
   Mitigation: keep web and protocol contracts unchanged; old runners retain
   next-invocation behavior while new runners gain next-turn activation.

## Tasks

1. Trace the exact pinned Codex `/model`, thread settings, and `turn/start`
   behavior alongside Murph's current target hydration and resume path.
2. Implement the smallest invocation-local confirmed-target projection and
   serialize configuration updates through the existing dynamic-tool chain.
3. Add focused direct scenario tests for same-invocation next-turn activation
   and request ordering, including default reset and failure cases.
4. Update the durable activation contract, run scoped verification and required
   audits, then complete the parent final review.
5. Close the plan with a scoped commit, open the PR, and run CI plus ReviewGPT
   concurrently on the exact pushed head.

## Verification

- Iteration: focused assistant-engine and assistant-runtime tests covering the
  changed seams.
- Completion: truthful `pnpm test:diff` for every touched production/test/doc
  path, `git diff --check`, required `coverage-write`, direct same-invocation
  scenario proof, parent final review, PR CI, and exact-head ReviewGPT.

## Deployment

- The change is backward compatible across web/Worker and Worker/container
  skew because no wire or persistence contract changes. Warm old runners keep
  the prior next-invocation behavior until replaced; new runners apply confirmed
  updates on the next provider turn.
Completed: 2026-07-15
