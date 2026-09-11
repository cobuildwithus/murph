# Consolidate pure experiment edit options

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Place experiment edit option compilation beside the existing onboarding option builders, preserving canonical output and failure ordering.

## Scope and invariants

- Move pure protocol-reference, run-logging, analysis, primary-outcome, and date builders with their validators into `experiment-onboarding-options.ts`.
- Reuse existing text, stable-ID, list, and compaction primitives. Keep measurement-anchor parsing with `option-utils.ts`.
- Preserve public service fields and input types. No new package entrypoint or state owner.
- Keep schedule file reads, patch admission, current frontmatter reads, canonical locks, and updates in `experiment-journal-vault.ts`; retain dates, logging, then schedule evaluation.
- No product behavior, persisted format, permission, prompt, or tool-schema change.

## Tasks

1. Move the closed pure builder cluster and inspect exact source equivalence.
2. Run focused onboarding and CLI edit integration tests, package typechecks, complexity and boundary checks.
3. Review the scoped diff and privacy, close this implementation plan, commit, push, and open a draft PR.

## Verification

- Focused vault-usecases onboarding schedule suite and CLI experiment phase-two integration cases.
- Vault-usecases and CLI typechecks; workspace boundaries, complexity diff, and doc drift.
- Compare moved function ASTs and unchanged orchestration against base `b80bd40f84d1b367c1810e2fe046e3089cc28aa4`.
- Parent owns candidate/final review, Ready admission, ReviewGPT, and required CI.

## Risks and decisions

- Error order is observable: preserve calls in their original positions, including schedule reads after date/logging validation.
- Existing option builder primitives are reused; no general compiler abstraction or callback injection.
- Internal refactor only: no changelog or provider-input measurement applies.

## Results

- Fourteen moved top-level function ASTs and all 100 retained function ASTs match the pinned base. The existing options compaction helper now has the same generic return type and AST as the prior usecase primitive.
- The usecase input interface moved unchanged in field shape, using the equivalent contracts `ExperimentStatus` type; its original export is retained. Shared service field consolidation is intentionally outside this PR.
- Six onboarding schedule tests passed. The first cold run exceeded the existing 60-second deadline during transformation; the unchanged rerun passed without timeout changes.
- Vault-usecases and CLI source typechecks passed; workspace boundaries, complexity diff, doc drift, and whitespace checks passed.
- Complexity recognizes 16 moved frames. Primary-outcome (37) and analysis-plan (23) branch counts are unchanged; unrelated locked update, session, schema, and safety hotspots stay intact.
- Parent candidate source review independently confirmed the 14 moves, 100 retained functions, and absence of a runtime back-edge.
- CLI protocol-backed integration requires local public Health Commons generated artifacts. The package-owned generator prepared them inside this worktree; no graph build or sibling artifact reuse occurred.
- Focused CLI edit mapping, canonical write order/failure cutoffs, and edit/checkpoint/stop lifecycle scenarios all passed (3 selected; 42 unrelated scenarios skipped).
- Frozen dependency installation and Frog list succeeded; no new repository friction entry was needed.
- This plan records implementation proof only; the completion parent owns Ready, final review, CI, and merge decisions.
Completed: 2026-09-10
