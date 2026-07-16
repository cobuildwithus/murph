# PR 746 all-resident checkpoint proof

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Correct the ReviewGPT round-2 checkpoint race by proving every detached child
  admitted across independent root sessions is terminal before a hosted workspace
  snapshot can publish.

## Retrospective decision

- Codex MultiAgent V2 enforces root-plus-one residency per root session, not per
  App Server process. Replace the false singular-child assumption with an exact
  process-owned map from each touched root to its current resident child.
- Keep the existing warm App Server and checkpoint boundary as the only transient
  lifecycle owner. Do not add a queue, admission manager, durable child registry,
  state machine, lease, or reconciliation path.
- Preserve nonblocking foreground replies and valid optional enrichment. Routine
  checkpoint interruption retains the full boundary; timeout, protocol failure,
  or explicit invocation abort still stops the exact process.

## Success criteria

- Two independent roots can each retain one native one-shot leaf without either
  child replacing the other in checkpoint evidence.
- A checkpoint retry remains blocked when child B completes before child A and
  clears the boundary only after every admitted child is terminal.
- Background-terminal scans cover every touched root and admitted child.
- The actual snapshot bridge performs no archive, upload, or checkpoint
  publication before the retained background boundary resolves.
- Durable contracts describe the native per-root cap and process-wide
  all-resident checkpoint proof truthfully.
- Focused tests, package typechecks, required completion audits, CI, and
  ReviewGPT round 3 pass on the final pushed head.

## Scope

- In scope: assistant-engine resident-child evidence, focused engine and snapshot
  bridge regression tests, matching architecture/invariant/protocol docs, PR
  retrospective metadata, and final base reconciliation.
- Out of scope: PR #748, provider-auth lifecycle changes, new process admission
  policy, a durable job owner, deployment, or unrelated hosted-runtime work.

## Tasks

1. Add a failing two-root interrupted-checkpoint regression and actual
   snapshot-publication proof.
2. Replace singular child evidence with exact all-resident evidence at the
   existing warm App Server owner.
3. Align durable contracts and PR intent with the per-root native cap.
4. Run focused verification, required audits, commit/push, and start ReviewGPT
   round 3 concurrently with CI.
5. Reconcile latest main after a passing review, prove final CI and mergeability,
   merge PR #746, and retire the isolated worktree.

## Verification

- Focused assistant-engine background-boundary tests and typecheck.
- Focused assistant-runtime snapshot-bridge tests and typecheck.
- Prompt/planning tests only if prompt text changes.
- Required affected-change gate, diff/privacy checks, PR CI, and ReviewGPT.
Completed: 2026-07-16
