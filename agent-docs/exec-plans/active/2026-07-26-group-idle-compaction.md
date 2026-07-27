# Group-specific idle compaction

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Compact warm group-container Codex threads at 60,000 input tokens during the
  existing idle checkpoint while keeping personal threads at 100,000.
- Suppress only Codex's synthetic context-compaction progress message in group
  conversations. Personal conversations retain it because the sender may be
  waiting through an in-turn compaction.

## Classification

- Repo runtime/code change with a product-owned messaging dimension.
- Isolated worktree and PR lane.
- Coverage lens and local product-experience review apply.
- Prompt and frontend lenses do not apply.
- Hosted execution changes require the final ReviewGPT gate.

## Scope

- Carry the authenticated conversation scope into the Codex provider turn and
  warm-thread vitals.
- Select the idle threshold from those warm-thread vitals at the existing
  compaction owner.
- Gate the existing synthetic compaction progress delivery on group scope.
- Add focused engine/provider/runtime regression coverage.

## Invariants

- Personal in-turn compaction still sends at most one required system progress
  message through the current delivery channel.
- Group compaction remains invisible but does not suppress model-authored
  progress, the progress tool, the final answer, errors, or usage accounting.
- Group classification comes from the authenticated route plan, never model
  text or participant content.
- Idle compaction remains off the reply path, abortable on wake, fail-open, and
  below the 164,000-token automatic ceiling.
- No new persisted state, schema, dependency, environment variable, or deploy
  contract.

## Tasks

1. Thread group conversation scope through provider and Codex app-server turn
   inputs.
2. Retain that scope with warm-thread token vitals and select 60k versus 100k
   in `compactWarmCodexThread`.
3. Suppress synthetic compaction progress delivery only when the active turn is
   a group conversation.
4. Add focused tests for threshold selection, provider plumbing, and both
   personal/group progress behavior.
5. Run focused checks, canonical diff verification, direct scenario proof,
   product-experience review, preliminary coverage specialist review, parent
   final review, acceptance, CI, and final ReviewGPT.

## Verification

- Focused Assistant Engine and Assistant Runtime tests for changed owners.
- `pnpm test:diff packages/assistant-engine packages/assistant-runtime`
- `pnpm verify:acceptance`
- `git diff --check`
- Direct scripted Codex event scenarios proving personal sends and group
  suppresses the synthetic compaction progress update while both return the
  final reply.
