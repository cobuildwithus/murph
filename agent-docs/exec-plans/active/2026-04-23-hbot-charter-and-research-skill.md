# Run the HBOT charter, upgrade Murph to the fixed review-gpt export, and update the repo-local Health Commons research skill

Status: in_progress
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Align the repo-local Health Commons research skill with the hardened research-runner behavior, upgrade Murph to the fixed `@cobuild/review-gpt` export release, then run and recover the HBOT charter so the resulting scope is safe to continue.

## Success criteria

- `.agents/skills/health-commons-research/SKILL.md` documents the current self-contained research config, `workflow.json` artifact contracts, and fail-closed wake/download behavior accurately.
- Murph depends on the fixed `@cobuild/review-gpt` patch release and carries the narrow version-scoped maturity exception required to install it immediately.
- A dedicated HBOT research lane is registered in the coordination ledger without clobbering unrelated active work.
- The charter run completes into the existing `output-packages/research/hyperbaric-oxygen-therapy-20260423-093246Z` workspace.
- The charter output clearly separates supervised clinical hyperbaric oxygen therapy from home mild-HBOT / soft-chamber variants.
- The upgraded Murph `thread export` path preserves the full inline charter text without the old 20k truncation.
- Verification covers the touched repo docs/process files, dependency metadata, and the charter recovery result.

## Scope

- In scope:
  - `.agents/skills/health-commons-research/SKILL.md`
  - `package.json`
  - `pnpm-lock.yaml`
  - `pnpm-workspace.yaml`
  - `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  - This active plan
  - The existing HBOT research workspace under `output-packages/research/hyperbaric-oxygen-therapy-20260423-093246Z`
- Out of scope:
  - Materializing post-charter HBOT seams
  - Landing Health Commons family, protocol, source, or generated artifacts
  - Broader research-runner code changes beyond the dependency upgrade and skill documentation pass

## Constraints

- Preserve unrelated dirty-tree work, especially the shared coordination ledger.
- Keep the research guidance consistent with the shipped runner behavior and canonical artifact filenames.
- Keep the maturity-policy exception version-scoped to the exact `@cobuild/review-gpt` hotfix release needed for this repo update.
- Do not continue beyond charter if the scope stays clinically unsafe or modality-confused.

## Tasks

1. [ ] Register the HBOT lane in the coordination ledger.
2. [ ] Update the repo-local Health Commons research skill to document the hardened runner/export behavior.
3. [ ] Upgrade Murph to the fixed `@cobuild/review-gpt` release with the narrow maturity exception needed to install it immediately.
4. [ ] Run or recover the HBOT charter from the existing workspace.
5. [ ] Inspect the charter output for correct clinical-vs-mild HBOT separation.
6. [ ] Run scoped verification for the touched repo docs/process files and dependency metadata, then report the result.

## Verification

- Pending
