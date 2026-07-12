# Clinical Records PR1 Pre-Persistence Validation

## Goal

Ensure invalid FHIR pages cannot be committed to a member vault before the
clinical importer rejects their patient, resource-family, base, or pagination
semantics.

## Scope

- Expose one importer-owned in-memory clinical planning path.
- Keep the existing disk-backed importer as a delegate to the same validation
  and planning implementation.
- Validate the prepared snapshot before the vault use case persists its raw
  pages and manifest, then apply only the validated plan.
- Add focused vault-usecase regressions proving rejected raw input leaves no
  clinical page or manifest behind.

## Constraints

- Keep patient, resource-family, FHIR-base, and pagination rules owned once in
  `packages/importers`.
- Preserve raw replay idempotency, conflicting replay rejection, review-only
  evidence handling, and the one-way public package dependency graph.
- Do not add a second persistence system, compatibility layer, or duplicated
  validator.
- Do not spawn another helper, launch a browser, or invoke ReviewGPT. The
  released controller grant authorizes parent review, scoped finish-task
  commit, current-base reconciliation, push, and draft PR publication.

## Verification Plan

- Focused clinical-records, importers, and vault-usecases tests.
- Typechecks for every affected package.
- Workspace dependency-cycle, boundary, and dependency-policy guards when the
  final diff still touches package boundaries.
- Frozen lockfile validation when manifests or the lockfile change.
- `git diff --check` plus privacy, secret, unsafe-logging, prohibited-cast, and
  personal-identifier scans.

## Coverage-Write Handoff

- Prompt: `agent-docs/prompts/coverage-write.md`.
- Worker routing after a controller grant: one local Codex worker at xhigh
  reasoning because this proof spans persisted health data and two package
  owners.
- Branch: `agent/clinical-records-pr1`.
- Committed head: `d3e7d03c5368f92c6812242df316167e75dc6285`.
- Original PR1 base: `b1d7ebd8fe5904b9a7591fb918a024a5d690bc18`.
- Goal: prove at the highest stable package boundary that patient,
  resource-family, FHIR-base, and pagination validation completes before any
  raw page or manifest is persisted, without duplicating importer rules.
- Exact coverage commands, to run before any worker edit:

  ```sh
  pnpm --dir packages/importers exec vitest run --config vitest.config.ts test/clinical-records.test.ts --coverage --coverage.include=src/clinical-records/index.ts
  pnpm --dir packages/vault-usecases exec vitest run --config vitest.config.ts test/clinical-records-execution.test.ts --coverage --coverage.include=src/clinical-records.ts
  ```

- Write scope is limited to
  `packages/importers/test/clinical-records.test.ts` and
  `packages/vault-usecases/test/clinical-records-execution.test.ts`; production
  files, this plan, and the coordination ledger are read-only to the worker.
- Existing proof: 66 focused importer tests and 8 focused vault-usecase tests
  pass. The latter include rejection-without-persistence cases for wrong
  patient, wrong resource family, foreign FHIR base, and invalid pagination,
  plus valid import, replay idempotency, and conflicting replay coverage.
- The completed security/privacy re-audit is clean and independently confirms
  that validation precedes the only write batch in the changed path.
- Preserve current production and coordination edits. Do not commit, push,
  spawn descendants, run a browser or ReviewGPT, or widen into production
  changes. Stop without edits when the existing tests already provide
  truthful boundary proof; otherwise add only the smallest missing test proof.
- The controller-granted worker completed with no edits or findings. Parent
  inspection confirmed the call ordering and absence assertions, then repeated
  both exact coverage commands successfully.

## Status

- Accepted medium security/privacy finding reproduced and source-traced.
- Importer-owned in-memory planning now validates the prepared snapshot before
  any member-vault persistence; the disk-backed importer delegates to it.
- Four focused no-persistence regressions cover wrong-patient,
  wrong-resource-family, foreign-base, and invalid-pagination input.
- Focused tests, affected package typechecks, workspace dependency/boundary
  guards, dependency policy, and unsafe-log guard pass.
- Resumed verification on 2026-07-12 passed again: 66 importer tests, 8
  vault-usecase tests, both affected typechecks, and all listed static guards.
- Local `origin/main` advanced through unrelated application changes and merged
  PR #557. Reconcile the scoped commit onto that base, resolve only the
  lockfile overlap, and run the frozen install before push.
- The coverage-write worker found no worthwhile missing proof and changed no
  files. Importer coverage passed at 91.01% statements, 85.26% branches,
  98.36% functions, and 91.09% lines; vault-usecase coverage passed at 81.63%
  statements, 68.57% branches, 100% functions, and 81.63% lines.
- Parent reruns reproduced 66 of 66 importer tests and 8 of 8 vault-usecase
  tests with the same coverage. The only uncovered vault-usecase branches are
  unrelated alternate page-count input shapes.
- Final parent verification passed six focused files and 123 tests: 8 clinical
  contract, 41 hosted-execution, 66 importer, and 8 vault-usecase tests. All
  four affected package typechecks, cycle and public-boundary guards,
  dependency policy, health-log guard, diff check, and five-file privacy,
  secret, unsafe-logging, prohibited-cast, and identifier inspection passed.
- Parent final review and five-file privacy inspection found no unresolved
  issue. Scoped finish-task commit, base reconciliation, push, and draft PR are
  authorized; browser work and ReviewGPT remain held.

Status: completed
Updated: 2026-07-12
Completed: 2026-07-12
