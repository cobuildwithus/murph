# Hosted Greenfield Cutover

## Goal

Land the hosted greenfield cutover in the sibling repo clone by running Batch 1 in parallel, integrating locally, running Batch 2 in parallel on the merged Batch 1 tree, then running the final integration/proof pass and repo completion workflow.

## Success Criteria

- Batch 1 workers land the new owner seams and narrowed contracts in parallel.
- The parent agent integrates Batch 1 into one coherent tree and reaches at least a truthful stable `pnpm typecheck` checkpoint before Batch 2.
- Batch 2 workers migrate the remaining consumers and operational seams onto the new owners.
- The final integration pass removes dead seams, updates durable docs, and proves the whole-repo target architecture.
- Required repo verification, required audit passes, scoped commit, push, and merge-back into the live repo are completed or any blocker is reported concretely.

## Constraints

- Work in the sibling repo clone on `main`, not the live dirty checkout.
- Preserve unrelated active rows already present in the coordination ledger.
- No compatibility shims, no rollout-era bridge readers/writers, no TODO-based ownership ambiguity.
- Parent agent owns merge resolution, high-risk verification, completion audits, commit, push, and merge-back.

## Planned Steps

1. Register the parent lane and Batch 1 worker lanes, then launch Batch 1 via the prepared `codex-workers` pack.
2. Review each Batch 1 worker result, integrate locally, resolve conflicts, and run truthful stabilization checks until the merged Batch 1 tree is ready for Batch 2.
3. Replace Batch 1 worker rows with Batch 2 worker rows and launch Batch 2.
4. Review each Batch 2 worker result, integrate locally, resolve conflicts, and run truthful stabilization checks until the merged Batch 2 tree is ready for the final integration pass.
5. Replace Batch 2 worker rows with the final integration row and launch the final repo-wide cleanup/proof worker.
6. Run final verification, direct scenario/proof checks, required audit passes, fix findings, rerun checks, then commit/push the scoped landing.
7. Merge the finished sibling-repo landing back into the live repo deliberately and report any overlap or blockers.

## Verification Intent

- Between batches: prefer truthful focused checks needed to stabilize the merged tree, with `pnpm typecheck` as the minimum gate before advancing.
- Final merged landing: run `pnpm typecheck` and `pnpm verify:acceptance` unless blocked for a concrete unrelated reason.
- Capture direct proof checks for the required deleted seams and owner-boundary assertions before handoff.

## Audit Intent

- This is a high-risk cross-cutting change.
- Expect `simplify` if the merged diff size warrants it.
- Expect `frontend-review` because the scope includes user-facing hosted share pages under `apps/web/app/share/**`.
- Expect `task-finish-review` before commit.
- `coverage-write` is only required if the final verification lane relies on owner-level or truthful diff coverage instead of the full acceptance lane.

Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
