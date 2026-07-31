# Late Child Result Rechecks

Status: active
Branch: `agent/late-child-result-rechecks`

## Outcome

Hosted Murph may reply without waiting for an optional child subagent, while
every later parent turn checks again for that child's completion and
incorporates a newly completed result when it is still relevant.

## Scope

- Hosted Codex multi-agent usage and mode guidance.
- Assistant prompt guidance shared by direct and group conversations.
- Durable hosted runtime delegation documentation.
- Focused prompt/config tests and direct Codex-path regression proof.

## Constraints

- Do not make foreground replies wait for unfinished children.
- Do not add a queue, scheduler, wake, or automatic follow-up owner.
- Keep reply delivery, safety, authority, and user-facing voice in the root.
- Preserve the existing bounded one-shot child and checkpoint contracts.
- Keep private incident evidence and direct identifiers out of repository
  artifacts.

## Plan

1. Use Codex's native parent-thread completion context for children that
   outlive the spawning reply.
2. Require each later turn to check again and incorporate completed relevant
   results without waiting for unfinished children.
3. Align the hosted runtime contract docs with that nonblocking behavior.
4. Add focused prompt/config tests and prove the pinned Codex path preserves
   late completion for a later root turn.
5. Run focused verification, inspect the final diff, and complete the required
   prompt-specialist PR review path.

## Verification

- Focused assistant-engine prompt tests.
- Focused assistant-runtime Codex config tests.
- Real pinned Codex scripted/integration proof for late completion visibility,
  or the narrowest existing direct protocol proof if the fixture cannot express
  the scenario.
- Typechecks for changed packages.
- Exact-head CI and preliminary ReviewGPT prompt/product/coverage lenses.

## Verification log

- Focused assistant-engine prompt suite: 70 tests passed.
- Focused assistant-runtime Codex config suite: 42 tests passed and 2 opt-in
  tests skipped.
- `@murphai/assistant-engine` and `@murphai/assistant-runtime` typechecks
  passed.
- Exact pinned Codex 0.145.0 source inspection confirmed its
  `subagent_notification_is_included_without_wait` contract test carries a
  completed child notification into a later parent turn without
  `wait_agent`; its MultiAgent V2 completion test delivers the child payload
  as a parent-thread `FINAL_ANSWER` agent message.
- A temporary, removed real Codex App Server capture measured complete first
  provider-visible `input`, tools, tool choice, parallel-tool flag, and text
  configuration for identical synthetic direct and group fixtures. With
  `gpt-5.6-terra`, low reasoning, MultiAgent V2, and `gpt-tokenizer` 3.4.0
  `o200k_harmony`, direct input changed from 23,556 tokens / 108,437 bytes to
  23,682 / 109,006 (+126, +0.535%; +569 bytes); group input changed from
  19,290 / 88,866 to 19,416 / 89,435 (+126, +0.653%; +569 bytes). Local paths
  were normalized; transport-only model, stream, reasoning, storage, service
  tier, and client metadata were excluded identically. The delta is entirely
  the new assembled late-child instruction and Codex-generated multi-agent
  usage guidance; tool definitions and schemas are unchanged.
